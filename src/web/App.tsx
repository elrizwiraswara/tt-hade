import { useCallback, useEffect, useState } from 'react';

import type { AccountSummary, HealthResponse, PatchPreset } from '../shared/api.js';
import { api, errorMessage } from './api.js';
import { AccountsView } from './components/AccountsView.js';
import { ExperimentsView } from './components/ExperimentsView.js';
import { HealthBadges } from './components/HealthBadges.js';
import { InspectView } from './components/InspectView.js';

type Tab = 'experiments' | 'accounts' | 'inspect';

interface Notice {
  tone: 'success' | 'danger';
  text: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'experiments', label: 'Experiments' },
  { id: 'accounts', label: 'TikTok accounts' },
  { id: 'inspect', label: 'Inspect' },
];

function readAuthNotice(): Notice | null {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const authError = params.get('auth_error');

  if (!connected && !authError) {
    return null;
  }

  window.history.replaceState(null, '', window.location.pathname);

  return connected
    ? { tone: 'success', text: `Connected TikTok account ${connected}.` }
    : { tone: 'danger', text: `TikTok sign-in failed: ${authError}` };
}

export function App() {
  const [initialNotice] = useState(readAuthNotice);
  const [tab, setTab] = useState<Tab>(initialNotice ? 'accounts' : 'experiments');
  const [notice, setNotice] = useState<Notice | null>(initialNotice);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [presets, setPresets] = useState<PatchPreset[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reloadAccounts = useCallback(async () => {
    setAccounts(await api.accounts());
  }, []);

  useEffect(() => {
    Promise.all([api.health(), api.presets(), api.accounts()])
      .then(([healthResponse, presetsResponse, accountList]) => {
        setHealth(healthResponse);
        setPresets(presetsResponse.presets);
        setAccounts(accountList);
      })
      .catch((error: unknown) => setLoadError(errorMessage(error)));
  }, []);

  return (
    <>
      <header className="app-bar">
        <div className="app-bar-inner">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">TT HADE</span>
            <span className="tag tag-accent" title="Experimental tool: results are not guaranteed and behaviour may change.">
              Experimental
            </span>
          </span>
          <nav className="tabs" role="tablist" aria-label="Sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                className="tab"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="shell">
        <main className="app-main stack">
          <HealthBadges health={health} accountCount={accounts.length} />

          {notice && (
            <div className={`banner banner-${notice.tone} row-between`}>
              <span>{notice.text}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}

          {loadError && <div className="banner banner-danger">Could not load the app: {loadError}</div>}

          {health && tab === 'experiments' && <ExperimentsView health={health} presets={presets} accounts={accounts} />}
          {health && tab === 'accounts' && <AccountsView health={health} accounts={accounts} onChanged={reloadAccounts} />}
          {health && tab === 'inspect' && <InspectView />}
        </main>
      </div>

      <footer className="app-foot">
        <div className="app-foot-inner">
          <span>TT HADE · experimental internal tool</span>
          {health && (
            <span className="mono">
              marker <code>{health.marker}</code>
            </span>
          )}
        </div>
      </footer>
    </>
  );
}
