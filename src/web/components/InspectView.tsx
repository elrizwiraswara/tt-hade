import { useState } from 'react';

import type { InspectResponse, ServedReport } from '../../shared/api.js';
import { api, errorMessage } from '../api.js';
import { MediaSummary } from './MediaSummary.js';
import { SectionTitle } from './SectionTitle.js';
import { ServedCheckForm } from './ServedCheckForm.js';
import { ServedReportView } from './ServedReportView.js';
import { UploadDropzone } from './UploadDropzone.js';

export function InspectView() {
  const [progress, setProgress] = useState<number | null>(null);
  const [inspected, setInspected] = useState<InspectResponse | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [served, setServed] = useState<ServedReport | null>(null);

  const inspect = async (file: File) => {
    setInspectError(null);
    setProgress(0);

    try {
      setInspected(await api.inspect(file, setProgress));
    } catch (caught) {
      setInspectError(errorMessage(caught));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <SectionTitle>Inspect a file</SectionTitle>
          <p className="muted small">
            Read the container of any MP4: your exports, patched variants, or a version you downloaded from TikTok.
          </p>
        </div>
        <UploadDropzone
          label="Drop a video to inspect"
          hint="The file is read on the server and deleted right after."
          busy={progress !== null}
          progress={progress}
          onFile={(file) => void inspect(file)}
        />
        {inspectError && <p className="error-text">{inspectError}</p>}
        {inspected && (
          <div className="stack-sm">
            <div className="row">
              <strong>{inspected.fileName}</strong>
              <span className={`badge ${inspected.markerFound ? 'badge-success' : ''}`}>
                {inspected.markerFound ? 'Carries the patch marker' : 'No patch marker'}
              </span>
            </div>
            <MediaSummary report={inspected.report} />
          </div>
        )}
      </div>

      <div className="card stack">
        <div>
          <SectionTitle>Check a TikTok post</SectionTitle>
          <p className="muted small">See the versions TikTok serves for any public post, without linking it to an experiment.</p>
        </div>
        <ServedCheckForm
          onCheck={async (url, download) => {
            setServed(await api.standaloneServedCheck({ url, download }));
          }}
        />
        {served && <ServedReportView report={served} marker="" />}
      </div>
    </div>
  );
}
