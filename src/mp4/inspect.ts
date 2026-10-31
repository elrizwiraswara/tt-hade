import { boxesOfType, scanTopLevel } from './layout.js';
import { readEncoderTag } from './metadata.js';
import { codecName, readMovie, type TrackInfo, type TrackKind } from './movie.js';
import type { RandomAccessSource } from './source.js';
import { parseBoxes } from './tree.js';

const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const UNKNOWN_U32_DURATION = 0xffff_ffff;

export interface TrackReport {
  id: number;
  kind: TrackKind;
  codec: string;
  codecName: string;
  enabled: boolean;
  alternateGroup: number;
  durationSeconds: number | null;
  sampleCount: number | null;
  bitrateKbps: number | null;
  width: number | null;
  height: number | null;
  trackWidth: number;
  trackHeight: number;
  fps: number | null;
}

export interface MediaReport {
  fileSize: number;
  topLevel: { type: string; size: number }[];
  trailingBytes: number;
  headerFirst: boolean | null;
  fragmented: boolean;
  durationSeconds: number | null;
  durationUnknown: boolean;
  nextTrackId: number | null;
  tracks: TrackReport[];
  encoderTag: string | null;
  overallBitrateKbps: number | null;
  issues: string[];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

function mediaSeconds(track: TrackInfo): number | null {
  const media = track.media;

  if (!media || media.timescale <= 0 || media.duration <= 0 || media.duration === UNKNOWN_U32_DURATION) {
    return null;
  }

  return media.duration / media.timescale;
}

function trackReport(track: TrackInfo): TrackReport {
  const seconds = mediaSeconds(track);
  const sizes = track.sizes;

  return {
    id: track.header.trackId,
    kind: track.kind,
    codec: track.entry?.codec ?? '',
    codecName: codecName(track),
    enabled: track.header.enabled,
    alternateGroup: track.header.alternateGroup,
    durationSeconds: seconds === null ? null : round(seconds, 3),
    sampleCount: sizes?.sampleCount ?? null,
    bitrateKbps: sizes && seconds ? Math.round((sizes.totalBytes * 8) / seconds / 1000) : null,
    width: track.entry?.width ?? null,
    height: track.entry?.height ?? null,
    trackWidth: track.header.width,
    trackHeight: track.header.height,
    fps: track.kind === 'video' && sizes && seconds ? round(sizes.sampleCount / seconds, 2) : null,
  };
}

export async function inspectFile(source: RandomAccessSource): Promise<MediaReport> {
  const layout = await scanTopLevel(source);
  const moovBox = boxesOfType(layout, 'moov')[0];
  const mdatBox = boxesOfType(layout, 'mdat')[0];

  const report: MediaReport = {
    fileSize: layout.fileSize,
    topLevel: layout.boxes.map((box) => ({ type: box.type, size: box.size })),
    trailingBytes: layout.trailingBytes,
    headerFirst: moovBox && mdatBox ? moovBox.start < mdatBox.start : null,
    fragmented: layout.boxes.some((box) => box.type === 'moof'),
    durationSeconds: null,
    durationUnknown: false,
    nextTrackId: null,
    tracks: [],
    encoderTag: null,
    overallBitrateKbps: null,
    issues: [],
  };

  if (layout.trailingBytes > 0) {
    report.issues.push(`${layout.trailingBytes.toLocaleString('en-US')} bytes of data after the last box.`);
  }

  if (!moovBox) {
    report.issues.push('No moov box found.');

    return report;
  }

  if (moovBox.size > MAX_MOOV_BYTES) {
    report.issues.push('The moov box is larger than 64 MB and was not inspected.');

    return report;
  }

  try {
    const [moov] = parseBoxes(await source.read(moovBox.start, moovBox.size));
    const movie = readMovie(moov!);
    const { header } = movie;

    report.durationUnknown = header.durationUnknown;
    report.nextTrackId = header.nextTrackId;
    report.tracks = movie.tracks.map(trackReport);
    report.encoderTag = readEncoderTag(moov!);

    if (!header.durationUnknown && header.timescale > 0 && header.duration > 0) {
      report.durationSeconds = round(header.duration / header.timescale, 3);
    }
  } catch (error) {
    report.issues.push(error instanceof Error ? error.message : String(error));
  }

  const fallbackSeconds = report.tracks.find((track) => track.kind === 'video')?.durationSeconds ?? null;
  const seconds = report.durationSeconds ?? fallbackSeconds;

  if (seconds) {
    report.overallBitrateKbps = Math.round((report.fileSize * 8) / seconds / 1000);
  }

  return report;
}

export function primaryVideo(report: MediaReport): TrackReport | null {
  return report.tracks.find((track) => track.kind === 'video') ?? null;
}
