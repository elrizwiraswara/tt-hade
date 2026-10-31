import { useState, type FormEvent } from 'react';

import type {
  DecoyAudioMode,
  HealthResponse,
  Job,
  JunkTailMode,
  PatchOptions,
  PatchPreset,
  PresetId,
  VerificationCheck,
} from '../../shared/api.js';
import { ApiError, api, errorMessage } from '../api.js';
import { ChecksList, isCheckList } from './ChecksList.js';

interface VariantBuilderProps {
  job: Job;
  health: HealthResponse;
  presets: PatchPreset[];
  onCreated: () => Promise<void>;
}

const DEFAULT_PRESET: PresetId = 'light';
const KB = 1024;

function optionsFor(preset: PatchPreset | undefined, marker: string): PatchOptions {
  const base = preset?.options ?? {
    faststart: true,
    unknownMovieDuration: false,
    zeroSampleEntrySize: false,
    zeroTrackHeaderSize: false,
    decoyAudio: 'off' as const,
    encoderTag: true,
    junkTailBytes: 0,
    junkTailMode: 'raw' as const,
    junkTailPattern: '00',
  };

  return { ...base, encoderTag: base.encoderTag ? marker : null };
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{label}</strong>
        <br />
        <span className="muted small">{hint}</span>
      </span>
    </label>
  );
}

export function VariantBuilder({ job, health, presets, onCreated }: VariantBuilderProps) {
  const sourceHasAac = job.sourceReport.tracks.some((track) => track.kind === 'audio' && track.codecName === 'AAC');
  const [presetId, setPresetId] = useState<PresetId | 'custom'>(DEFAULT_PRESET);
  const [options, setOptions] = useState<PatchOptions>(() =>
    optionsFor(presets.find((preset) => preset.id === DEFAULT_PRESET), health.marker),
  );
  const [normalizeAudio, setNormalizeAudio] = useState(!sourceHasAac && health.ffmpeg);
  const [decodeCheck, setDecodeCheck] = useState(health.ffmpeg);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedChecks, setFailedChecks] = useState<VerificationCheck[] | null>(null);

  const choosePreset = (preset: PatchPreset) => {
    setPresetId(preset.id);
    setOptions(optionsFor(preset, health.marker));
  };

  const update = <K extends keyof PatchOptions>(key: K, value: PatchOptions[K]) => {
    setPresetId('custom');
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const decoyNeedsAudio = options.decoyAudio !== 'off' && !sourceHasAac && !normalizeAudio;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFailedChecks(null);

    try {
      await api.createVariant(job.id, { preset: presetId, options, normalizeAudio, decodeCheck, label: label.trim() || undefined });
      setLabel('');
      await onCreated();
    } catch (caught) {
      setError(errorMessage(caught));

      if (caught instanceof ApiError && isCheckList(caught.details)) {
        setFailedChecks(caught.details);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(event) => void submit(event)}>
      <div className="row-between">
        <h3>New variant</h3>
        <span className="badge">{presetId === 'custom' ? 'Custom settings' : `Preset: ${presetId}`}</span>
      </div>

      <div className="grid-3">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="preset-option"
            aria-pressed={presetId === preset.id}
            onClick={() => choosePreset(preset)}
          >
            <strong>{preset.label}</strong>
            <span className="muted small">{preset.description}</span>
          </button>
        ))}
      </div>

      <details>
        <summary>Techniques</summary>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <Toggle
            label="Header first"
            hint="Place the moov box before the media data (faststart)."
            checked={options.faststart}
            onChange={(value) => update('faststart', value)}
          />
          <Toggle
            label="Unknown movie duration"
            hint="Set mvhd.duration to the all-ones sentinel. Phones may show 0:00."
            checked={options.unknownMovieDuration}
            onChange={(value) => update('unknownMovieDuration', value)}
          />
          <Toggle
            label="0×0 sample entry size"
            hint="Zero the frame size declared in the video sample description."
            checked={options.zeroSampleEntrySize}
            onChange={(value) => update('zeroSampleEntrySize', value)}
          />
          <Toggle
            label="0×0 track header size"
            hint="Also zero the display size in the video track header."
            checked={options.zeroTrackHeaderSize}
            onChange={(value) => update('zeroTrackHeaderSize', value)}
          />
          <label className="field">
            <span className="field-label">Decoy AAC track</span>
            <select value={options.decoyAudio} onChange={(event) => update('decoyAudio', event.target.value as DecoyAudioMode)}>
              <option value="off">Off</option>
              <option value="disabled">Clone audio as a disabled track</option>
              <option value="enabled">Clone audio as an enabled track</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Encoder tag</span>
            <input
              type="text"
              value={options.encoderTag ?? ''}
              placeholder="Leave empty to keep the existing tag"
              onChange={(event) => update('encoderTag', event.target.value.trim() ? event.target.value : null)}
            />
          </label>
          <label className="field">
            <span className="field-label">Junk tail (KB, 0 = off)</span>
            <input
              type="number"
              min={0}
              max={65536}
              value={Math.round(options.junkTailBytes / KB)}
              onChange={(event) => update('junkTailBytes', Math.max(0, Math.round(Number(event.target.value) || 0)) * KB)}
            />
          </label>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">Tail format</span>
              <select value={options.junkTailMode} onChange={(event) => update('junkTailMode', event.target.value as JunkTailMode)}>
                <option value="raw">Raw bytes</option>
                <option value="free-box">Inside a free box</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Fill pattern (hex)</span>
              <input
                type="text"
                className="mono"
                value={options.junkTailPattern}
                onChange={(event) => update('junkTailPattern', event.target.value.trim())}
              />
            </label>
          </div>
        </div>
      </details>

      <div className="grid-2">
        <Toggle
          label="Normalize audio"
          hint={
            health.ffmpeg
              ? 'Re-encode audio to AAC 48 kHz stereo 320 kbps with ffmpeg. Video is copied untouched.'
              : 'Needs ffmpeg on the server.'
          }
          checked={normalizeAudio}
          onChange={setNormalizeAudio}
        />
        <Toggle
          label="Full decode check"
          hint="Decode every video frame with ffmpeg after patching."
          checked={decodeCheck}
          onChange={setDecodeCheck}
        />
      </div>

      {decoyNeedsAudio && (
        <p className="banner banner-warning small">
          The decoy track needs AAC audio and this source has none. Turn on audio normalization.
        </p>
      )}

      <div className="row">
        <input
          type="text"
          placeholder="Optional label"
          value={label}
          maxLength={80}
          onChange={(event) => setLabel(event.target.value)}
          style={{ maxWidth: 260 }}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || decoyNeedsAudio}>
          {busy ? 'Patching…' : 'Create variant'}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {failedChecks && <ChecksList checks={failedChecks} />}
    </form>
  );
}
