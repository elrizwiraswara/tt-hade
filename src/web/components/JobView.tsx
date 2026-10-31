import { useState } from 'react';

import type { AccountSummary, HealthResponse, Job, PatchPreset } from '../../shared/api.js';
import { api, errorMessage } from '../api.js';
import { formatBytes, formatDate } from '../format.js';
import { MediaSummary } from './MediaSummary.js';
import { ResultsTable } from './ResultsTable.js';
import { SectionTitle } from './SectionTitle.js';
import { VariantBuilder } from './VariantBuilder.js';
import { VariantCard } from './VariantCard.js';

interface JobViewProps {
  job: Job;
  health: HealthResponse;
  presets: PatchPreset[];
  accounts: AccountSummary[];
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}

export function JobView({ job, health, presets, accounts, onChanged, onDeleted }: JobViewProps) {
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!window.confirm(`Delete "${job.originalName}" and all of its variants?`)) {
      return;
    }

    try {
      await api.deleteJob(job.id);
      onDeleted();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row-between">
          <div>
            <SectionTitle>{job.originalName}</SectionTitle>
            <p className="muted small">
              Added {formatDate(job.createdAt)} · {formatBytes(job.sourceSize)}
            </p>
          </div>
          <button className="btn btn-sm btn-danger" onClick={() => void remove()}>
            Delete job
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        <h4>Source</h4>
        <MediaSummary report={job.sourceReport} marker={health.marker} />
      </div>

      <VariantBuilder job={job} health={health} presets={presets} onCreated={onChanged} />

      {job.variants.length > 0 && <ResultsTable job={job} />}

      {job.variants.map((variant) => (
        <VariantCard
          key={variant.id}
          job={job}
          variant={variant}
          health={health}
          accounts={accounts}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
