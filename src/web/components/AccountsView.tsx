import { useState } from 'react';

import type { AccountSummary, HealthResponse } from '../../shared/api.js';
import { api, errorMessage } from '../api.js';
import { formatDate } from '../format.js';
import { SectionTitle } from './SectionTitle.js';

interface AccountsViewProps {
  health: HealthResponse;
  accounts: AccountSummary[];
  onChanged: () => Promise<void>;
}

function SetupGuide({ redirectUri }: { redirectUri: string }) {
  return (
    <div className="card stack-sm">
      <h3>Connect your TikTok developer app</h3>
      <ol className="stack-sm" style={{ margin: 0, paddingLeft: 20 }}>
        <li>
          Create an app at <a href="https://developers.tiktok.com/apps" target="_blank" rel="noreferrer">developers.tiktok.com</a>{' '}
          and choose the <strong>Desktop</strong> platform.
        </li>
        <li>
          Add the <strong>Login Kit</strong> and <strong>Content Posting API</strong> products.
        </li>
        <li>
          Request the scopes <code>user.info.basic</code> and <code>video.upload</code>. Sandbox apps can't get{' '}
          <code>video.publish</code>, so posting goes through the TikTok inbox.
        </li>
        <li>
          Register this redirect URI exactly: <code>{redirectUri}</code>
        </li>
        <li>In the app's Sandbox, add the TikTok accounts you will post from as target users.</li>
        <li>
          Put <code>TIKTOK_CLIENT_KEY</code> and <code>TIKTOK_CLIENT_SECRET</code> in <code>.env</code>, then restart the server.
        </li>
      </ol>
    </div>
  );
}

export function AccountsView({ health, accounts, onChanged }: AccountsViewProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disconnect = async (account: AccountSummary) => {
    if (!window.confirm(`Disconnect ${account.displayName}? The app's access token will be revoked.`)) {
      return;
    }

    setBusyId(account.openId);
    setError(null);

    try {
      await api.disconnectAccount(account.openId);
      await onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="stack">
      {!health.tiktokConfigured && <SetupGuide redirectUri={health.redirectUri} />}

      <div className="card stack">
        <div className="row-between">
          <SectionTitle>TikTok accounts</SectionTitle>
          {health.tiktokConfigured ? (
            <a className="btn btn-primary" href={api.connectUrl()}>
              Connect account
            </a>
          ) : (
            <button className="btn btn-primary" disabled>
              Connect account
            </button>
          )}
        </div>

        {!health.appAudited && (
          <p className="banner banner-warning small">
            Your TikTok app is unaudited. Sandbox apps only get Inbox mode: the video lands in the TikTok app's inbox and you
            choose who can view it when you finish the post there. Direct Post needs the <code>video.publish</code> scope,
            which only audited apps can enable.
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        {accounts.length === 0 ? (
          <p className="muted">No accounts connected yet.</p>
        ) : (
          <div className="stack-sm">
            {accounts.map((account) => (
              <div key={account.openId} className="card-muted row-between">
                <div className="row">
                  {account.avatarUrl ? <img className="avatar" src={account.avatarUrl} alt="" /> : <div className="avatar" />}
                  <div>
                    <strong>{account.displayName}</strong>
                    <p className="muted small">
                      Connected {formatDate(account.connectedAt)} · sign-in valid until {formatDate(account.refreshExpiresAt)}
                    </p>
                    <div className="chips">
                      {account.scopes.map((scope) => (
                        <span key={scope} className="tag">
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={busyId === account.openId}
                  onClick={() => void disconnect(account)}
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
