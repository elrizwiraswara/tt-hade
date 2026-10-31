import { Mp4Error } from './errors.js';
import {
  readAudioObjectType,
  readHandlerType,
  readMediaHeader,
  readMovieHeader,
  readSampleEntry,
  readSampleSizes,
  readTrackHeader,
  type MediaHeader,
  type MovieHeader,
  type SampleEntry,
  type SampleSizes,
  type TrackHeader,
} from './fields.js';
import { childrenOfType, findChild, findPath, type Mp4Box } from './tree.js';

export const SUPPORTED_VIDEO_CODECS = ['avc1', 'avc3', 'hvc1', 'hev1'] as const;

const AAC_OBJECT_TYPES = new Set([0x40, 0x66, 0x67, 0x68]);
const MP3_OBJECT_TYPES = new Set([0x69, 0x6b]);

const CODEC_NAMES: Record<string, string> = {
  avc1: 'H.264',
  avc3: 'H.264',
  hvc1: 'HEVC',
  hev1: 'HEVC',
  dvh1: 'Dolby Vision',
  dvhe: 'Dolby Vision',
  av01: 'AV1',
  vp09: 'VP9',
  'ac-3': 'AC-3',
  'ec-3': 'E-AC-3',
  Opus: 'Opus',
  alac: 'ALAC',
  lpcm: 'PCM',
};

export type TrackKind = 'video' | 'audio' | 'other';

export interface TrackNodes {
  trak: Mp4Box;
  tkhd: Mp4Box;
  mdhd: Mp4Box | undefined;
  hdlr: Mp4Box | undefined;
  stsd: Mp4Box | undefined;
  stsz: Mp4Box | undefined;
  chunkOffsets: Mp4Box | undefined;
}

export interface TrackInfo {
  nodes: TrackNodes;
  kind: TrackKind;
  handler: string;
  header: TrackHeader;
  media: MediaHeader | null;
  entry: SampleEntry | null;
  audioObjectType: number | null;
  sizes: SampleSizes | null;
}

export interface MovieModel {
  moov: Mp4Box;
  mvhd: Mp4Box;
  header: MovieHeader;
  tracks: TrackInfo[];
}

export function locateTrack(trak: Mp4Box): TrackNodes {
  const tkhd = findChild(trak, 'tkhd');

  if (!tkhd) {
    throw new Mp4Error('malformed_box', 'A track is missing its tkhd box.');
  }

  const mdia = findChild(trak, 'mdia');
  const stbl = findPath(mdia, ['minf', 'stbl']);

  return {
    trak,
    tkhd,
    mdhd: findChild(mdia, 'mdhd'),
    hdlr: findChild(mdia, 'hdlr'),
    stsd: findChild(stbl, 'stsd'),
    stsz: findChild(stbl, 'stsz') ?? findChild(stbl, 'stz2'),
    chunkOffsets: findChild(stbl, 'stco') ?? findChild(stbl, 'co64'),
  };
}

function kindOf(handler: string): TrackKind {
  if (handler === 'vide') {
    return 'video';
  }

  return handler === 'soun' ? 'audio' : 'other';
}

export function readTrack(trak: Mp4Box): TrackInfo {
  const nodes = locateTrack(trak);
  const handler = nodes.hdlr ? readHandlerType(nodes.hdlr) : '';
  const kind = kindOf(handler);

  return {
    nodes,
    kind,
    handler,
    header: readTrackHeader(nodes.tkhd),
    media: nodes.mdhd ? readMediaHeader(nodes.mdhd) : null,
    entry: nodes.stsd ? readSampleEntry(nodes.stsd, kind === 'video') : null,
    audioObjectType: kind === 'audio' && nodes.stsd ? readAudioObjectType(nodes.stsd) : null,
    sizes: nodes.stsz?.type === 'stsz' ? readSampleSizes(nodes.stsz) : null,
  };
}

export function isAacTrack(track: TrackInfo): boolean {
  return track.entry?.codec === 'mp4a' && track.audioObjectType !== null && AAC_OBJECT_TYPES.has(track.audioObjectType);
}

export function codecName(track: TrackInfo): string {
  const codec = track.entry?.codec ?? '';

  if (codec === 'mp4a') {
    if (isAacTrack(track)) {
      return 'AAC';
    }

    if (track.audioObjectType !== null && MP3_OBJECT_TYPES.has(track.audioObjectType)) {
      return 'MP3';
    }

    return track.audioObjectType === null ? 'mp4a' : `mp4a (0x${track.audioObjectType.toString(16)})`;
  }

  return CODEC_NAMES[codec] ?? (codec || 'unknown');
}

export function readMovie(moov: Mp4Box): MovieModel {
  const mvhd = findChild(moov, 'mvhd');

  if (!mvhd) {
    throw new Mp4Error('malformed_box', 'The movie header (mvhd) is missing.');
  }

  return {
    moov,
    mvhd,
    header: readMovieHeader(mvhd),
    tracks: childrenOfType(moov, 'trak').map(readTrack),
  };
}

export function isSupportedVideoCodec(codec: string): boolean {
  return (SUPPORTED_VIDEO_CODECS as readonly string[]).includes(codec);
}
