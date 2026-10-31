import type { Job, Variant } from '../../shared/api.js';
import { formatBytes, formatKbps, formatPercent, formatResolution } from '../format.js';

function latestPublicationStatus(variant: Variant): string {
  const latest = variant.publications[0];

  if (!latest) {
    return 'Not posted';
  }

  return latest.status === 'failed' ? `Failed: ${latest.failReason ?? 'unknown'}` : latest.status;
}

export function ResultsTable({ job }: { job: Job }) {
  return (
    <div className="card stack-sm">
      <h3>Results</h3>
      <p className="muted small">
        Compare served quality across variants. Post each variant, then paste its public link into the variant's served-quality
        check.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Variant</th>
              <th className="num">Techniques</th>
              <th className="num">Size</th>
              <th>Posted</th>
              <th>Served top version</th>
              <th className="num">Kept</th>
              <th>Encoder tag</th>
            </tr>
          </thead>
          <tbody>
            {job.variants.map((variant) => {
              const served = variant.servedChecks[0];
              const top = served?.topRung;

              return (
                <tr key={variant.id}>
                  <td>
                    {variant.label} <span className="muted mono">{variant.id}</span>
                  </td>
                  <td className="num">{variant.applied.length}</td>
                  <td className="num">{formatBytes(variant.size)}</td>
                  <td>{latestPublicationStatus(variant)}</td>
                  <td>{top ? `${formatResolution(top.width, top.height)} · ${formatKbps(top.bitrateKbps)}` : '—'}</td>
                  <td className="num">{formatPercent(served?.retention)}</td>
                  <td>{served?.download ? (served.download.markerFound ? 'Survived' : 'Replaced') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
