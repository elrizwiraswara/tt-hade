import type { MediaReport } from '../../shared/api.js';
import { formatBytes, formatKbps, formatResolution, formatSeconds } from '../format.js';

interface MediaSummaryProps {
  report: MediaReport;
  marker?: string;
}

function headerPosition(report: MediaReport): string {
  if (report.headerFirst === null) {
    return 'No header';
  }

  return report.headerFirst ? 'Header first' : 'Header at end';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function MediaSummary({ report, marker }: MediaSummaryProps) {
  const video = report.tracks.find((track) => track.kind === 'video');
  const duration = report.durationUnknown ? 'Unknown' : formatSeconds(report.durationSeconds);

  return (
    <div className="stack-sm">
      <div className="stats">
        <Stat label="File size" value={formatBytes(report.fileSize)} />
        <Stat label="Duration" value={duration} />
        <Stat label="Video" value={video ? `${video.codecName} ${formatResolution(video.width, video.height)}` : '—'} />
        <Stat label="Frame rate" value={video?.fps ? `${video.fps} fps` : '—'} />
        <Stat label="Video bitrate" value={formatKbps(video?.bitrateKbps)} />
        <Stat label="Overall bitrate" value={formatKbps(report.overallBitrateKbps)} />
      </div>

      <div className="row small">
        <span className="badge">{headerPosition(report)}</span>
        {report.fragmented && <span className="badge badge-warning">Fragmented</span>}
        {report.trailingBytes > 0 && <span className="badge badge-warning">{formatBytes(report.trailingBytes)} trailing data</span>}
        {report.encoderTag && (
          <span className={`badge ${marker && report.encoderTag === marker ? 'badge-success' : ''}`}>
            Encoder tag: <span className="mono">{report.encoderTag}</span>
          </span>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Track</th>
              <th>Codec</th>
              <th>State</th>
              <th>Declared size</th>
              <th>Track header size</th>
              <th className="num">Samples</th>
              <th className="num">Bitrate</th>
              <th className="num">Duration</th>
            </tr>
          </thead>
          <tbody>
            {report.tracks.map((track) => (
              <tr key={track.id}>
                <td>
                  #{track.id} {track.kind}
                </td>
                <td>
                  {track.codecName} <span className="muted mono">{track.codec}</span>
                </td>
                <td>
                  {track.enabled ? 'enabled' : 'disabled'}
                  {track.alternateGroup ? <span className="muted"> · group {track.alternateGroup}</span> : null}
                </td>
                <td>{track.kind === 'video' ? formatResolution(track.width, track.height) : '—'}</td>
                <td>{track.kind === 'video' ? formatResolution(track.trackWidth, track.trackHeight) : '—'}</td>
                <td className="num">{track.sampleCount?.toLocaleString() ?? '—'}</td>
                <td className="num">{formatKbps(track.bitrateKbps)}</td>
                <td className="num">{formatSeconds(track.durationSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.issues.length > 0 && (
        <ul className="small muted">
          {report.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
