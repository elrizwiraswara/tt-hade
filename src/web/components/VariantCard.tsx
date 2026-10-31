import { useState } from 'react';

import type { AccountSummary, HealthResponse, Job, Variant } from '../../shared/api.js';
import { api, errorMessage } from '../api.js';
import { formatBytes, formatDate } from '../format.js';
import { ChecksList } from './ChecksList.js';
import { MediaSummary } from './MediaSummary.js';
import { PublicationList } from './PublicationList.js';
import { PublishForm } from './PublishForm.js';
import { ServedCheckForm } from './ServedCheckForm.js';
import { ServedReportView } from './ServedReportView.js';

interface VariantCardProps {
  job: Job;
  variant: Variant;
  health: HealthResponse;
  accounts: AccountSummary[];
  onChanged: () => Promise<void>;
}

export function VariantCard({ job, variant, health, accounts, onChanged }: VariantCardProps) {
  const [error, setError] = useState<string | null>(null);
  const passed = variant.checks.filter((check) => check.ok).length;

  const remove = async () => {
    if (!window.confirm(`Delete variant "${variant.label}"?`)) {
      return;
    }

    try {
      await api.deleteVariant(job.id, variant.id);
      await onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <article className="card stack">
      <div className="row-between">
        <div>
          <h3>
            {variant.label} <span className="muted mono small">{variant.id}</span>
          </h3>
          <p className="muted small">
            {formatDate(variant.createdAt)} · {formatBytes(variant.size)}
          </p>
        </div>
        <div className="row">
          <a className="btn btn-ghost btn-sm" href={api.variantFileUrl(job.id, variant.id)}>
            Download
          </a>
          <button className="btn btn-sm btn-danger" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="chips">
        {variant.applied.map((technique) => (
          <span key={technique} className="tag">
            {technique}
          </span>
        ))}
      </div>

      <details>
        <summary>
          Verification: {passed}/{variant.checks.length} checks passed
        </summary>
        <div style={{ marginTop: 10 }}>
          <ChecksList checks={variant.checks} />
        </div>
      </details>

      <details>
        <summary>Patched file details</summary>
        <div style={{ marginTop: 10 }}>
          <MediaSummary report={variant.report} marker={health.marker} />
        </div>
      </details>

      <div className="divider" />

      <PublishForm job={job} variant={variant} health={health} accounts={accounts} onPublished={onChanged} />
      <PublicationList job={job} variant={variant} onChanged={onChanged} />

      <div className="divider" />

      <div className="stack-sm">
        <h4>Served quality</h4>
        <ServedCheckForm
          onCheck={async (url, download) => {
            await api.servedCheck(job.id, variant.id, { url, download });
            await onChanged();
          }}
        />
        {variant.servedChecks.map((report) => (
          <ServedReportView key={report.id} report={report} marker={health.marker} />
        ))}
      </div>
    </article>
  );
}
