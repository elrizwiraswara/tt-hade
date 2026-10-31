import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AccountSummary, HealthResponse, Job, PatchPreset, PublicationStatus } from '../../shared/api.js';
import { api, errorMessage } from '../api.js';
import { JobListItem } from './JobListItem.js';
import { JobView } from './JobView.js';
import { UploadDropzone } from './UploadDropzone.js';

interface ExperimentsViewProps {
  health: HealthResponse;
  presets: PatchPreset[];
  accounts: AccountSummary[];
}

const ACTIVE_STATUSES: readonly PublicationStatus[] = ['initializing', 'uploading', 'processing'];
const POLL_INTERVAL_MS = 2500;

function hasActivePublication(jobs: Job[]): boolean {
  return jobs.some((job) =>
    job.variants.some((variant) => variant.publications.some((publication) => ACTIVE_STATUSES.includes(publication.status))),
  );
}

export function ExperimentsView({ health, presets, accounts }: ExperimentsViewProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setJobs(await api.jobs());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const polling = hasActivePublication(jobs);

  useEffect(() => {
    if (!polling) {
      return;
    }

    const timer = window.setInterval(() => void reload(), POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [polling, reload]);

  const selected = useMemo(() => jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? null, [jobs, selectedId]);

  const upload = async (file: File) => {
    setError(null);
    setUploadProgress(0);

    try {
      const job = await api.createJob(file, setUploadProgress);

      setJobs((current) => [job, ...current]);
      setSelectedId(job.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploadProgress(null);
    }
  };

  return (
    <div className="experiments">
      <aside className="stack">
        <UploadDropzone
          label="Add a source video"
          hint="MP4 or MOV, H.264 or HEVC. Export at 1080p, constant frame rate, high bitrate."
          busy={uploadProgress !== null}
          progress={uploadProgress}
          onFile={(file) => void upload(file)}
        />

        {error && <p className="error-text small">{error}</p>}

        <div className="job-list">
          {jobs.map((job) => (
            <JobListItem
              key={job.id}
              job={job}
              selected={selected?.id === job.id}
              onSelect={() => setSelectedId(job.id)}
            />
          ))}
        </div>
      </aside>

      <section>
        {selected ? (
          <JobView
            key={selected.id}
            job={selected}
            health={health}
            presets={presets}
            accounts={accounts}
            onChanged={reload}
            onDeleted={() => {
              setSelectedId(null);
              void reload();
            }}
          />
        ) : (
          <div className="card empty">Add a source video to start an experiment.</div>
        )}
      </section>
    </div>
  );
}
