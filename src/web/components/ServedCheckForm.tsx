import { useState, type FormEvent } from 'react';

import { errorMessage } from '../api.js';

interface ServedCheckFormProps {
  onCheck: (url: string, download: boolean) => Promise<void>;
}

export function ServedCheckForm({ onCheck }: ServedCheckFormProps) {
  const [url, setUrl] = useState('');
  const [download, setDownload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await onCheck(url.trim(), download);
      setUrl('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack-sm" onSubmit={(event) => void submit(event)}>
      <div className="row">
        <input
          type="url"
          required
          placeholder="https://www.tiktok.com/@account/video/…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          style={{ flex: '1 1 280px' }}
        />
        <button className="btn btn-ghost" type="submit" disabled={busy || !url.trim()}>
          {busy ? 'Checking…' : 'Check served quality'}
        </button>
      </div>
      <label className="check small">
        <input type="checkbox" checked={download} onChange={(event) => setDownload(event.target.checked)} />
        Download the top version and inspect it (looks for the encoder tag and measures the real bitrate)
      </label>
      {error && <p className="error-text small">{error}</p>}
    </form>
  );
}
