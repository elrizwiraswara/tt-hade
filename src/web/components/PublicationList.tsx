import { useState } from 'react';

import type { Job, Publication, PublicationStatus, Variant } from '../../shared/api.js';
import { api, errorMessage } from '../api.js';
import { formatBytes, formatDate, formatPercent } from '../format.js';

interface PublicationListProps {
  job: Job;
  variant: Variant;
  onChanged: () => Promise<void>;
}

const STATUS_STYLES: Record<PublicationStatus, { label: string; tone: string }> = {
  initializing: { label: 'Starting', tone: 'badge-accent' },
  uploading: { label: 'Uploading', tone: 'badge-accent' },
  processing: { label: 'TikTok is processing', tone: 'badge-accent' },
  inbox: { label: 'In TikTok inbox', tone: 'badge-success' },
  published: { label: 'Published', tone: 'badge-success' },
  failed: { label: 'Failed', tone: 'badge-danger' },
};

function PublicationRow({ job, variant, publication, onChanged }: PublicationListProps & { publication: Publication }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const style = STATUS_STYLES[publication.status];
  const progress = publication.totalBytes ? publication.uploadedBytes / publication.totalBytes : 0;

  const refresh = async () => {
    setBusy(true);
    setError(null);

    try {
      await api.refreshPublication(job.id, variant.id, publication.id);
      await onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-muted stack-sm">
      <div className="row-between">
        <div className="row">
          <span className={`badge ${style.tone}`}>{style.label}</span>
          <span>{publication.mode === 'direct' ? 'Direct post' : 'Inbox draft'}</span>
          <span className="muted small">
            {publication.accountName} · {formatDate(publication.createdAt)}
          </span>
        </div>
        <button className="btn btn-ghost btn-sm" disabled={busy || !publication.publishId} onClick={() => void refresh()}>
          Refresh status
        </button>
      </div>

      {publication.status === 'uploading' && (
        <div className="stack-sm">
          <div className="progress">
            <div style={{ width: formatPercent(progress) }} />
          </div>
          <span className="muted small">
            {formatBytes(publication.uploadedBytes)} of {formatBytes(publication.totalBytes)}
          </span>
        </div>
      )}

      <div className="row small muted">
        {publication.tiktokStatus && (
          <span>
            TikTok status: <code>{publication.tiktokStatus}</code>
          </span>
        )}
        {publication.privacyLevel && <span>Visibility: {publication.privacyLevel}</span>}
        {publication.publishId && (
          <span>
            Publish ID: <code>{publication.publishId}</code>
          </span>
        )}
      </div>

      {publication.postIds.length > 0 && (
        <p className="small">
          Post ID: <code>{publication.postIds.join(', ')}</code>
        </p>
      )}

      {publication.failReason && <p className="error-text small">{publication.failReason}</p>}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}

export function PublicationList(props: PublicationListProps) {
  const { variant } = props;

  if (!variant.publications.length) {
    return null;
  }

  return (
    <div className="stack-sm">
      {variant.publications.map((publication) => (
        <PublicationRow key={publication.id} {...props} publication={publication} />
      ))}
    </div>
  );
}
