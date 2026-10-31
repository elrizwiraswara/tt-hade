import { fourCCBytes, hexToBytes, writeU32, writeU64 } from './bytes.js';
import { Mp4Error } from './errors.js';
import {
  readChunkOffsets,
  setAlternateGroup,
  setMovieDurationUnknown,
  setNextTrackId,
  setTrackEnabled,
  setTrackId,
  shiftChunkOffsets,
  zeroSampleEntryDimensions,
  zeroTrackDimensions,
} from './fields.js';
import { boxesOfType, payloadRange, scanTopLevel, type FileLayout, type TopLevelBox } from './layout.js';
import { readEncoderTag, writeEncoderTag } from './metadata.js';
import {
  codecName,
  isAacTrack,
  isSupportedVideoCodec,
  locateTrack,
  readMovie,
  type MovieModel,
  type TrackInfo,
} from './movie.js';
import { createPlan, type AssemblyPlan, type PlanPart } from './plan.js';
import type { RandomAccessSource } from './source.js';
import {
  describeOptions,
  MAX_JUNK_PATTERN_BYTES,
  MAX_JUNK_TAIL_BYTES,
  type PatchOptions,
} from './techniques.js';
import { boxSize, childrenOfType, cloneBox, parseBoxes, serializeBox, type Mp4Box } from './tree.js';

const MAX_HEADER_BYTES = 64 * 1024 * 1024;
const MAX_U32 = 0xffff_ffff;
const DOLBY_VISION_CODECS = ['dvh1', 'dvhe', 'dva1', 'dvav'];

export interface PreparedFile {
  layout: FileLayout;
  headerBytes: Map<number, Uint8Array>;
  moovBox: TopLevelBox;
  mdatBox: TopLevelBox;
  moov: Mp4Box;
  movie: MovieModel;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface PatchExpectation {
  videoCodec: string;
  videoSampleCount: number;
  trackCount: number;
  durationUnknown: boolean;
  encoderTag: string | null;
  trailingBytes: number;
  sourceMediaRange: ByteRange;
  outputMediaRange: ByteRange;
}

export interface PatchResult {
  plan: AssemblyPlan;
  applied: string[];
  expectation: PatchExpectation;
}

export async function prepareFile(source: RandomAccessSource): Promise<PreparedFile> {
  const layout = await scanTopLevel(source);
  const types = layout.boxes.map((box) => box.type);

  if (types[0] !== 'ftyp') {
    throw new Mp4Error('not_mp4', 'This is not a standard MP4/MOV file (it does not start with an ftyp box).');
  }

  if (layout.trailingBytes > 0) {
    throw new Mp4Error(
      'unsupported_layout',
      `The file has ${layout.trailingBytes.toLocaleString('en-US')} bytes of unrecognised data after the last box. It may already be patched.`,
    );
  }

  if (types.includes('moof')) {
    throw new Mp4Error('unsupported_layout', 'Fragmented MP4 files are not supported. Re-export as a standard MP4.');
  }

  const [moovBox, ...extraMoov] = boxesOfType(layout, 'moov');
  const [mdatBox, ...extraMdat] = boxesOfType(layout, 'mdat');

  if (!moovBox || !mdatBox || extraMoov.length || extraMdat.length) {
    throw new Mp4Error('unsupported_layout', 'Expected exactly one moov and one mdat box.');
  }

  const headerBoxes = layout.boxes.filter((box) => box.type !== 'mdat');
  const headerSize = headerBoxes.reduce((sum, box) => sum + box.size, 0);

  if (headerSize > MAX_HEADER_BYTES) {
    throw new Mp4Error('header_too_large', 'The file header is larger than 64 MB.');
  }

  const headerBytes = new Map<number, Uint8Array>();

  for (const box of headerBoxes) {
    headerBytes.set(box.start, (await source.read(box.start, box.size)).slice());
  }

  const [moov] = parseBoxes(headerBytes.get(moovBox.start)!);

  if (!moov?.children) {
    throw new Mp4Error('malformed_box', 'The moov box could not be parsed.');
  }

  return { layout, headerBytes, moovBox, mdatBox, moov, movie: readMovie(moov) };
}

function requireVideoTrack(movie: MovieModel): TrackInfo {
  const videoTracks = movie.tracks.filter((track) => track.kind === 'video');

  if (videoTracks.length !== 1) {
    throw new Mp4Error('unsupported_layout', `Expected one video track, found ${videoTracks.length}.`);
  }

  const video = videoTracks[0]!;
  const codec = video.entry?.codec ?? '';

  if (DOLBY_VISION_CODECS.includes(codec)) {
    throw new Mp4Error('unsupported_codec', 'Dolby Vision is not supported. Export as standard H.264 or HEVC.');
  }

  if (!isSupportedVideoCodec(codec)) {
    throw new Mp4Error('unsupported_codec', `Video must be H.264 or HEVC (found "${codec || 'unknown'}").`);
  }

  if (!video.nodes.stsd || !video.sizes) {
    throw new Mp4Error('malformed_box', 'The video track has no readable sample table.');
  }

  return video;
}

function requireAacTrack(movie: MovieModel): TrackInfo {
  const audioTracks = movie.tracks.filter((track) => track.kind === 'audio');
  const aac = audioTracks.find(isAacTrack);

  if (!aac) {
    const found = audioTracks.length ? `found ${audioTracks.map(codecName).join(', ')}` : 'the file has no audio';

    throw new Mp4Error(
      'missing_audio',
      `The decoy track needs an AAC audio track (${found}). Turn on audio normalization or re-export with AAC audio.`,
    );
  }

  return aac;
}

function assertNotPatched(prepared: PreparedFile, options: PatchOptions): void {
  if (prepared.movie.header.durationUnknown) {
    throw new Mp4Error('already_patched', 'The movie duration is already set to "unknown". This file looks already patched.');
  }

  if (options.encoderTag && readEncoderTag(prepared.moov) === options.encoderTag) {
    throw new Mp4Error('already_patched', 'This file already carries the patch marker.');
  }
}

function assertOffsetsInside(movie: MovieModel, range: ByteRange): void {
  for (const track of movie.tracks) {
    if (!track.nodes.chunkOffsets) {
      throw new Mp4Error('malformed_box', `Track ${track.header.trackId} has no chunk offset table.`);
    }

    const outside = readChunkOffsets(track.nodes.chunkOffsets).find(
      (offset) => offset < range.start || offset >= range.end,
    );

    if (outside !== undefined) {
      throw new Mp4Error(
        'offset_out_of_range',
        `Track ${track.header.trackId} points at byte ${outside}, outside the media data. The layout is not supported.`,
      );
    }
  }
}

function validateOptions(options: PatchOptions): Uint8Array {
  if (!Number.isSafeInteger(options.junkTailBytes) || options.junkTailBytes < 0 || options.junkTailBytes > MAX_JUNK_TAIL_BYTES) {
    throw new RangeError(`Junk tail must be between 0 and ${MAX_JUNK_TAIL_BYTES} bytes.`);
  }

  const pattern = hexToBytes(options.junkTailPattern);

  if (pattern.length > MAX_JUNK_PATTERN_BYTES) {
    throw new RangeError(`Junk tail pattern must be at most ${MAX_JUNK_PATTERN_BYTES} bytes.`);
  }

  return pattern;
}

function addDecoyAudioTrack(movie: MovieModel, audio: TrackInfo, enabled: boolean): void {
  const highestTrackId = Math.max(...movie.tracks.map((track) => track.header.trackId));
  const decoyTrackId = Math.max(movie.header.nextTrackId, highestTrackId + 1);

  if (decoyTrackId >= MAX_U32) {
    throw new Mp4Error('unsupported_layout', 'No free track ID is left for the decoy track.');
  }

  const decoy = cloneBox(audio.nodes.trak);
  const decoyNodes = locateTrack(decoy);
  const group = audio.header.alternateGroup || 1;

  setTrackId(decoyNodes.tkhd, decoyTrackId);
  setTrackEnabled(decoyNodes.tkhd, enabled);
  setAlternateGroup(decoyNodes.tkhd, group);
  setAlternateGroup(audio.nodes.tkhd, group);
  setNextTrackId(movie.mvhd, decoyTrackId + 1);

  const children = movie.moov.children!;
  children.splice(children.indexOf(audio.nodes.trak) + 1, 0, decoy);
}

function applyTechniques(prepared: PreparedFile, video: TrackInfo, options: PatchOptions): void {
  const { movie, moov } = prepared;
  const audio = options.decoyAudio === 'off' ? null : requireAacTrack(movie);

  if (options.unknownMovieDuration) {
    setMovieDurationUnknown(movie.mvhd);
  }

  if (options.zeroSampleEntrySize) {
    zeroSampleEntryDimensions(video.nodes.stsd!);
  }

  if (options.zeroTrackHeaderSize) {
    zeroTrackDimensions(video.nodes.tkhd);
  }

  if (audio) {
    addDecoyAudioTrack(movie, audio, options.decoyAudio === 'enabled');
  }

  if (options.encoderTag) {
    writeEncoderTag(moov, options.encoderTag);
  }
}

function outputOrder(layout: FileLayout, faststart: boolean): TopLevelBox[] {
  const order = [...layout.boxes];
  const moovIndex = order.findIndex((box) => box.type === 'moov');
  const mdatIndex = order.findIndex((box) => box.type === 'mdat');

  if (faststart && moovIndex > mdatIndex) {
    const [moov] = order.splice(moovIndex, 1);
    order.splice(mdatIndex, 0, moov!);
  }

  return order;
}

function mdatHeader(mdat: TopLevelBox): Uint8Array {
  const header = new Uint8Array(mdat.headerSize);

  if (mdat.headerSize === 16) {
    writeU32(header, 0, 1);
    header.set(fourCCBytes('mdat'), 4);
    writeU64(header, 8, mdat.size);

    return header;
  }

  if (mdat.size > MAX_U32) {
    throw new Mp4Error('unsupported_layout', 'The media data box is too large for its header.');
  }

  writeU32(header, 0, mdat.size);
  header.set(fourCCBytes('mdat'), 4);

  return header;
}

function junkTailParts(options: PatchOptions, pattern: Uint8Array): PlanPart[] {
  if (options.junkTailBytes === 0) {
    return [];
  }

  const fill: PlanPart = { kind: 'fill', pattern, length: options.junkTailBytes };

  if (options.junkTailMode === 'raw') {
    return [fill];
  }

  const header = new Uint8Array(8);
  writeU32(header, 0, 8 + options.junkTailBytes);
  header.set(fourCCBytes('free'), 4);

  return [{ kind: 'bytes', data: header }, fill];
}

export async function buildPatchPlan(source: RandomAccessSource, options: PatchOptions): Promise<PatchResult> {
  const pattern = validateOptions(options);
  const prepared = await prepareFile(source);
  const sourceMediaRange = payloadRange(prepared.mdatBox);

  assertNotPatched(prepared, options);
  assertOffsetsInside(prepared.movie, sourceMediaRange);

  const video = requireVideoTrack(prepared.movie);
  const videoCodec = video.entry!.codec;
  const videoSampleCount = video.sizes!.sampleCount;

  applyTechniques(prepared, video, options);

  const order = outputOrder(prepared.layout, options.faststart);
  const moovSize = boxSize(prepared.moov);
  const mdatIndex = order.indexOf(prepared.mdatBox);
  const mdatStart = order
    .slice(0, mdatIndex)
    .reduce((sum, box) => sum + (box === prepared.moovBox ? moovSize : box.size), 0);
  const outputMediaStart = mdatStart + prepared.mdatBox.headerSize;
  const delta = outputMediaStart - sourceMediaRange.start;

  for (const trak of childrenOfType(prepared.moov, 'trak')) {
    shiftChunkOffsets(locateTrack(trak).chunkOffsets!, delta);
  }

  const moovBytes = serializeBox(prepared.moov);
  const parts: PlanPart[] = order.flatMap<PlanPart>((box) => {
    if (box === prepared.moovBox) {
      return [{ kind: 'bytes', data: moovBytes }];
    }

    if (box === prepared.mdatBox) {
      return [
        { kind: 'bytes', data: mdatHeader(box) },
        { kind: 'source', start: sourceMediaRange.start, end: sourceMediaRange.end },
      ];
    }

    return [{ kind: 'bytes', data: prepared.headerBytes.get(box.start)! }];
  });

  parts.push(...junkTailParts(options, pattern));

  const mediaLength = sourceMediaRange.end - sourceMediaRange.start;

  return {
    plan: createPlan(parts),
    applied: describeOptions(options),
    expectation: {
      videoCodec,
      videoSampleCount,
      trackCount: prepared.movie.tracks.length + (options.decoyAudio === 'off' ? 0 : 1),
      durationUnknown: options.unknownMovieDuration,
      encoderTag: options.encoderTag,
      trailingBytes: options.junkTailMode === 'raw' ? options.junkTailBytes : 0,
      sourceMediaRange,
      outputMediaRange: { start: outputMediaStart, end: outputMediaStart + mediaLength },
    },
  };
}
