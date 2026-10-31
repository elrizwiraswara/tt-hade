import { useState, type SyntheticEvent } from 'react';

import type { Job, TrackReport } from '../../shared/api.js';
import { api } from '../api.js';
import { formatBytes, formatDate, formatResolution } from '../format.js';

interface JobListItemProps {
  job: Job;
  selected: boolean;
  onSelect: () => void;
}

const FALLBACK_RATIO = '9 / 16';

function declaredRatio(video: TrackReport | undefined): string {
  return video?.width && video.height ? `${video.width} / ${video.height}` : FALLBACK_RATIO;
}

export function JobListItem({ job, selected, onSelect }: JobListItemProps) {
  const video = job.sourceReport.tracks.find((track) => track.kind === 'video');
  const [playable, setPlayable] = useState(true);
  const [ratio, setRatio] = useState(() => declaredRatio(video));
  const variantCount = `${job.variants.length} variant${job.variants.length === 1 ? '' : 's'}`;

  const applyRenderedRatio = (event: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;

    if (videoWidth && videoHeight) {
      setRatio(`${videoWidth} / ${videoHeight}`);
    }
  };

  return (
    <div className="job-item" aria-current={selected ? 'true' : undefined}>
      {playable ? (
        <video
          className="job-video"
          src={`${api.sourceVideoUrl(job.id)}#t=0.1`}
          controls
          preload="metadata"
          playsInline
          style={{ aspectRatio: ratio }}
          onLoadedMetadata={applyRenderedRatio}
          onPlay={onSelect}
          onError={() => setPlayable(false)}
        />
      ) : (
        <div className="job-video job-video-fallback muted small">
          This browser can't play {video ? `${video.codecName} video` : 'this file'}.
        </div>
      )}

      <button className="job-select" onClick={onSelect}>
        <span className="job-name">{job.originalName}</span>
        <span className="muted small">
          {video ? `${video.codecName} ${formatResolution(video.width, video.height)} · ` : ''}
          {formatBytes(job.sourceSize)} · {variantCount}
        </span>
        <span className="muted small">{formatDate(job.createdAt)}</span>
      </button>
    </div>
  );
}
