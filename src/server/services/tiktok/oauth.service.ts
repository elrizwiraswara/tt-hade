import { createHash, randomBytes } from 'node:crypto';

import type { AppConfig } from '../../config.js';
import { AppError } from '../../errors.js';
import type { AccountStore, StoredAccount } from './account.store.js';
import { callOAuth, callOpenApi } from './api-client.js';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const PENDING_TTL_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 5 * 60_000;

interface PendingAuthorization {
  verifier: string;
  returnTo: string;
  createdAt: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
}

interface UserInfoResponse {
  user?: {
    open_id?: string;
    display_name?: string;
    avatar_url?: string;
  };
}

export interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

export interface CompletedAuthorization {
  returnTo: string;
  account: StoredAccount | null;
  error: string | null;
}

function expiresAt(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export class TikTokOAuthService {
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly refreshing = new Map<string, Promise<StoredAccount>>();

  constructor(
    private readonly config: AppConfig['tiktok'],
    private readonly accounts: AccountStore,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.clientKey && this.config.clientSecret);
  }

  authorizationUrl(returnTo: string): string {
    this.requireConfigured();
    this.dropExpired();

    const state = randomBytes(16).toString('hex');
    const verifier = randomBytes(48).toString('base64url');

    this.pending.set(state, { verifier, returnTo, createdAt: Date.now() });

    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_key: this.config.clientKey,
      scope: this.config.scopes.join(','),
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('hex'),
      code_challenge_method: 'S256',
    }).toString();

    return url.toString();
  }

  async completeAuthorization(query: CallbackQuery): Promise<CompletedAuthorization> {
    const pending = query.state ? this.pending.get(query.state) : undefined;

    if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
      throw new AppError(400, 'invalid_state', 'The sign-in link expired or was already used. Start the connection again.');
    }

    this.pending.delete(query.state!);

    if (query.error || !query.code) {
      return {
        returnTo: pending.returnTo,
        account: null,
        error: query.error_description || query.error || 'TikTok did not return an authorization code.',
      };
    }

    try {
      const account = await this.exchangeCode(query.code, pending.verifier);

      return { returnTo: pending.returnTo, account, error: null };
    } catch (error) {
      return { returnTo: pending.returnTo, account: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async exchangeCode(code: string, verifier: string): Promise<StoredAccount> {
    const tokens = await callOAuth<TokenResponse>('/v2/oauth/token/', {
      client_key: this.config.clientKey,
      client_secret: this.config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
    });
    const profile = await this.fetchProfile(tokens.access_token);
    const account: StoredAccount = {
      ...this.tokenFields(tokens),
      displayName: profile.user?.display_name || tokens.open_id,
      avatarUrl: profile.user?.avatar_url ?? null,
      connectedAt: new Date().toISOString(),
    };

    await this.accounts.save(account);

    return account;
  }

  async accessToken(openId: string): Promise<string> {
    const account = this.accounts.require(openId);

    if (Date.parse(account.accessExpiresAt) - Date.now() > REFRESH_MARGIN_MS) {
      return account.accessToken;
    }

    let refresh = this.refreshing.get(openId);

    if (!refresh) {
      refresh = this.refresh(account).finally(() => this.refreshing.delete(openId));
      this.refreshing.set(openId, refresh);
    }

    return (await refresh).accessToken;
  }

  async disconnect(openId: string): Promise<void> {
    const account = this.accounts.require(openId);

    if (this.configured) {
      await callOAuth('/v2/oauth/revoke/', {
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        token: account.accessToken,
      }).catch(() => undefined);
    }

    await this.accounts.remove(openId);
  }

  private async refresh(account: StoredAccount): Promise<StoredAccount> {
    this.requireConfigured();

    if (Date.parse(account.refreshExpiresAt) <= Date.now()) {
      throw new AppError(401, 'reconnect_required', `The TikTok connection for ${account.displayName} expired. Connect the account again.`);
    }

    const tokens = await callOAuth<TokenResponse>('/v2/oauth/token/', {
      client_key: this.config.clientKey,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
    });
    const refreshed: StoredAccount = { ...account, ...this.tokenFields(tokens) };

    await this.accounts.save(refreshed);

    return refreshed;
  }

  private tokenFields(tokens: TokenResponse): Pick<
    StoredAccount,
    'openId' | 'scopes' | 'accessToken' | 'accessExpiresAt' | 'refreshToken' | 'refreshExpiresAt'
  > {
    return {
      openId: tokens.open_id,
      scopes: tokens.scope.split(',').map((scope) => scope.trim()).filter(Boolean),
      accessToken: tokens.access_token,
      accessExpiresAt: expiresAt(tokens.expires_in),
      refreshToken: tokens.refresh_token,
      refreshExpiresAt: expiresAt(tokens.refresh_expires_in),
    };
  }

  private fetchProfile(accessToken: string): Promise<UserInfoResponse> {
    return callOpenApi<UserInfoResponse>('/v2/user/info/', {
      method: 'GET',
      accessToken,
      query: { fields: 'open_id,display_name,avatar_url' },
    }).catch(() => ({}));
  }

  private requireConfigured(): void {
    if (!this.configured) {
      throw new AppError(503, 'tiktok_not_configured', 'Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env first.');
    }
  }

  private dropExpired(): void {
    const now = Date.now();

    for (const [state, pending] of this.pending) {
      if (now - pending.createdAt > PENDING_TTL_MS) {
        this.pending.delete(state);
      }
    }
  }
}
