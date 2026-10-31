export type DecoyAudioMode = 'off' | 'disabled' | 'enabled';
export type JunkTailMode = 'raw' | 'free-box';

export interface PatchOptions {
  faststart: boolean;
  unknownMovieDuration: boolean;
  zeroSampleEntrySize: boolean;
  zeroTrackHeaderSize: boolean;
  decoyAudio: DecoyAudioMode;
  encoderTag: string | null;
  junkTailBytes: number;
  junkTailMode: JunkTailMode;
  junkTailPattern: string;
}

export type PresetId = 'control' | 'light' | 'full';

export interface PatchPreset {
  id: PresetId;
  label: string;
  description: string;
  options: Omit<PatchOptions, 'encoderTag'> & { encoderTag: boolean };
}

export const MAX_JUNK_TAIL_BYTES = 64 * 1024 * 1024;
export const MAX_JUNK_PATTERN_BYTES = 64;

export const PATCH_PRESETS: readonly PatchPreset[] = [
  {
    id: 'control',
    label: 'Control',
    description: 'Only rewrites the container with the header first. Use it as the baseline when comparing results.',
    options: {
      faststart: true,
      unknownMovieDuration: false,
      zeroSampleEntrySize: false,
      zeroTrackHeaderSize: false,
      decoyAudio: 'off',
      encoderTag: true,
      junkTailBytes: 0,
      junkTailMode: 'raw',
      junkTailPattern: '00',
    },
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Unknown movie duration and a 0x0 declared frame size. Video and audio samples are untouched.',
    options: {
      faststart: true,
      unknownMovieDuration: true,
      zeroSampleEntrySize: true,
      zeroTrackHeaderSize: false,
      decoyAudio: 'off',
      encoderTag: true,
      junkTailBytes: 0,
      junkTailMode: 'raw',
      junkTailPattern: '00',
    },
  },
  {
    id: 'full',
    label: 'Full',
    description: 'Light, plus a cloned AAC decoy track and a junk tail after the media data.',
    options: {
      faststart: true,
      unknownMovieDuration: true,
      zeroSampleEntrySize: true,
      zeroTrackHeaderSize: false,
      decoyAudio: 'disabled',
      encoderTag: true,
      junkTailBytes: 1024 * 1024,
      junkTailMode: 'raw',
      junkTailPattern: '00',
    },
  },
];

export function presetOptions(id: PresetId, marker: string): PatchOptions {
  const preset = PATCH_PRESETS.find((candidate) => candidate.id === id);

  if (!preset) {
    throw new RangeError(`Unknown preset "${id}".`);
  }

  return { ...preset.options, encoderTag: preset.options.encoderTag ? marker : null };
}

export function describeOptions(options: PatchOptions): string[] {
  const applied: string[] = [];

  if (options.faststart) {
    applied.push('Header placed before media data');
  }

  if (options.unknownMovieDuration) {
    applied.push('Movie duration set to "unknown"');
  }

  if (options.zeroSampleEntrySize) {
    applied.push('Sample entry frame size set to 0x0');
  }

  if (options.zeroTrackHeaderSize) {
    applied.push('Track header frame size set to 0x0');
  }

  if (options.decoyAudio !== 'off') {
    applied.push(`Decoy AAC track added (${options.decoyAudio})`);
  }

  if (options.encoderTag) {
    applied.push(`Encoder tag "${options.encoderTag}"`);
  }

  if (options.junkTailBytes > 0) {
    applied.push(`${options.junkTailBytes.toLocaleString('en-US')} byte junk tail (${options.junkTailMode})`);
  }

  return applied;
}
