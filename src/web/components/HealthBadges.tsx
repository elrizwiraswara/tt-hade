import type { HealthResponse } from '../../shared/api.js';

interface HealthBadgesProps {
  health: HealthResponse | null;
  accountCount: number;
}

export function HealthBadges({ health, accountCount }: HealthBadgesProps) {
  if (!health) {
    return null;
  }

  return (
    <section className="health" aria-label="Status">
      <span className={`badge ${health.ffmpeg ? 'badge-success' : 'badge-warning'}`}>
        ffmpeg {health.ffmpeg ? 'ready' : 'missing'}
      </span>
      <span className={`badge ${health.tiktokConfigured ? 'badge-success' : 'badge-warning'}`}>
        TikTok app {health.tiktokConfigured ? 'configured' : 'not configured'}
      </span>
      <span className={`badge ${health.appAudited ? 'badge-success' : 'badge-accent'}`}>
        {health.appAudited ? 'Audited app' : 'Unaudited app'}
      </span>
      <span className="badge">
        {accountCount} account{accountCount === 1 ? '' : 's'}
      </span>
    </section>
  );
}
