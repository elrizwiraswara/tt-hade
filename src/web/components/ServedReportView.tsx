import type { ServedReport } from '../../shared/api.js';
import { formatBytes, formatDate, formatKbps, formatPercent, formatResolution } from '../format.js';
import { MediaSummary } from './MediaSummary.js';

interface ServedReportViewProps {
  report: ServedReport;
  marker: string;
}

export function ServedReportView({ report, marker }: ServedReportViewProps) {
  const top = report.topRung;
  const downloadedVideo = report.download?.report.tracks.find((track) => track.kind === 'video');

  return (
    <div className="card-muted stack-sm">
      <div className="row-between">
        <div className="row">
          <strong>{top ? `${formatResolution(top.width, top.height)} · ${formatKbps(top.bitrateKbps)}` : 'No streams found'}</strong>
          {report.download && (
            <span className={`badge ${report.download.markerFound ? 'badge-success' : 'badge-warning'}`}>
              {report.download.markerFound ? 'Encoder tag survived' : 'Encoder tag replaced'}
            </span>
          )}
          {report.retention !== null && <span className="badge badge-accent">{formatPercent(report.retention)} of source bitrate</span>}
        </div>
        <span className="muted small">
          {formatDate(report.checkedAt)} ·{' '}
          <a href={report.url} target="_blank" rel="noreferrer">
            open post
          </a>
        </span>
      </div>

      {report.rungs.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Codec</th>
                <th>Resolution</th>
                <th className="num">Bitrate</th>
                <th className="num">Size</th>
              </tr>
            </thead>
            <tbody>
              {report.rungs.map((rung, index) => (
                <tr key={`${rung.gearName}-${index}`}>
                  <td className="mono">{rung.gearName}</td>
                  <td>{rung.codec}</td>
                  <td>{formatResolution(rung.width, rung.height)}</td>
                  <td className="num">{formatKbps(rung.bitrateKbps)}</td>
                  <td className="num">{formatBytes(rung.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.download && (
        <details>
          <summary>
            Downloaded top version: {downloadedVideo?.codecName ?? 'unknown'} {formatKbps(downloadedVideo?.bitrateKbps)}
          </summary>
          <div style={{ marginTop: 10 }}>
            <MediaSummary report={report.download.report} marker={marker} />
          </div>
        </details>
      )}

      {report.downloadError && <p className="muted small">Download skipped: {report.downloadError}</p>}
    </div>
  );
}
