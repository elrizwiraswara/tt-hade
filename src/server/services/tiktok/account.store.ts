import type { AccountSummary } from '../../../shared/api.js';
import { notFound } from '../../errors.js';
import { readJsonFile, SerialQueue, writeJsonFile } from '../json-file.js';

export interface StoredAccount {
  openId: string;
  displayName: string;
  avatarUrl: string | null;
  scopes: string[];
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  connectedAt: string;
}

export class AccountStore {
  private readonly accounts = new Map<string, StoredAccount>();
  private readonly queue = new SerialQueue();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    for (const account of await readJsonFile<StoredAccount[]>(this.path, [])) {
      this.accounts.set(account.openId, account);
    }
  }

  list(): StoredAccount[] {
    return [...this.accounts.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  require(openId: string): StoredAccount {
    const account = this.accounts.get(openId);

    if (!account) {
      throw notFound('TikTok account');
    }

    return account;
  }

  async save(account: StoredAccount): Promise<void> {
    this.accounts.set(account.openId, account);
    await this.persist();
  }

  async remove(openId: string): Promise<void> {
    this.accounts.delete(openId);
    await this.persist();
  }

  private persist(): Promise<void> {
    return this.queue.run(() => writeJsonFile(this.path, [...this.accounts.values()]));
  }
}

export function toAccountSummary(account: StoredAccount): AccountSummary {
  return {
    openId: account.openId,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    scopes: account.scopes,
    connectedAt: account.connectedAt,
    accessExpiresAt: account.accessExpiresAt,
    refreshExpiresAt: account.refreshExpiresAt,
  };
}
