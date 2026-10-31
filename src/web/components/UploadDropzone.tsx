import { useRef, useState, type DragEvent } from 'react';

import { formatPercent } from '../format.js';

interface UploadDropzoneProps {
  label: string;
  hint: string;
  busy: boolean;
  progress: number | null;
  onFile: (file: File) => void;
}

const ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov,.m4v';

export function UploadDropzone({ label, hint, busy, progress, onFile }: UploadDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);

    const file = event.dataTransfer.files[0];

    if (file && !busy) {
      onFile(file);
    }
  };

  return (
    <div
      className="dropzone"
      role="button"
      tabIndex={0}
      data-active={dragging}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !busy) {
          input.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <strong>{busy ? `Uploading ${formatPercent(progress)}` : label}</strong>
      <span className="muted small">{hint}</span>
      {busy && (
        <div className="progress" style={{ width: '100%' }}>
          <div style={{ width: formatPercent(progress ?? 0) }} />
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';

          if (file) {
            onFile(file);
          }
        }}
      />
    </div>
  );
}
