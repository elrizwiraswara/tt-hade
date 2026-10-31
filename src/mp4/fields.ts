import { readFourCC, readU16, readU32, readU64, writeU16, writeU32, writeU64 } from './bytes.js';
import { Mp4Error } from './errors.js';
import { readBoxHeader, type Mp4Box } from './tree.js';

const MAX_U32 = 0xffff_ffff;
const TRACK_ENABLED_FLAG = 0x1;

function requireLength(box: Mp4Box, length: number): Uint8Array {
  if (box.payload.length < length) {
    throw new Mp4Error('malformed_box', `Malformed '${box.type}' box (needs ${length} bytes).`);
  }

  return box.payload;
}

function versionOf(box: Mp4Box): number {
  const version = requireLength(box, 4)[0]!;

  if (version > 1) {
    throw new Mp4Error('malformed_box', `Unsupported '${box.type}' version ${version}.`);
  }

  return version;
}

function readFlags(payload: Uint8Array): number {
  return (payload[1]! << 16) | (payload[2]! << 8) | payload[3]!;
}

function writeFlags(payload: Uint8Array, flags: number): void {
  payload[1] = (flags >>> 16) & 0xff;
  payload[2] = (flags >>> 8) & 0xff;
  payload[3] = flags & 0xff;
}

function isAllOnes(payload: Uint8Array, offset: number, length: number): boolean {
  for (let index = offset; index < offset + length; index++) {
    if (payload[index] !== 0xff) {
      return false;
    }
  }

  return true;
}

export interface MovieHeader {
  version: number;
  timescale: number;
  duration: number;
  durationUnknown: boolean;
  nextTrackId: number;
}

const MVHD_LAYOUT = [
  { length: 100, timescale: 12, duration: 16, durationBytes: 4, nextTrackId: 96 },
  { length: 112, timescale: 20, duration: 24, durationBytes: 8, nextTrackId: 108 },
] as const;

export function readMovieHeader(mvhd: Mp4Box): MovieHeader {
  const version = versionOf(mvhd);
  const layout = MVHD_LAYOUT[version]!;
  const payload = requireLength(mvhd, layout.length);
  const durationUnknown = isAllOnes(payload, layout.duration, layout.durationBytes);

  return {
    version,
    timescale: readU32(payload, layout.timescale),
    duration: durationUnknown ? 0 : version ? readU64(payload, layout.duration) : readU32(payload, layout.duration),
    durationUnknown,
    nextTrackId: readU32(payload, layout.nextTrackId),
  };
}

export function setMovieDurationUnknown(mvhd: Mp4Box): void {
  const layout = MVHD_LAYOUT[versionOf(mvhd)]!;
  const payload = requireLength(mvhd, layout.length);

  payload.fill(0xff, layout.duration, layout.duration + layout.durationBytes);
}

export function setNextTrackId(mvhd: Mp4Box, nextTrackId: number): void {
  const layout = MVHD_LAYOUT[versionOf(mvhd)]!;

  writeU32(requireLength(mvhd, layout.length), layout.nextTrackId, nextTrackId);
}

export interface TrackHeader {
  version: number;
  enabled: boolean;
  trackId: number;
  alternateGroup: number;
  width: number;
  height: number;
}

const TKHD_LAYOUT = [
  { length: 84, trackId: 12, alternateGroup: 34, width: 76, height: 80 },
  { length: 96, trackId: 20, alternateGroup: 46, width: 88, height: 92 },
] as const;

export function readTrackHeader(tkhd: Mp4Box): TrackHeader {
  const version = versionOf(tkhd);
  const layout = TKHD_LAYOUT[version]!;
  const payload = requireLength(tkhd, layout.length);

  return {
    version,
    enabled: (readFlags(payload) & TRACK_ENABLED_FLAG) !== 0,
    trackId: readU32(payload, layout.trackId),
    alternateGroup: readU16(payload, layout.alternateGroup),
    width: readU32(payload, layout.width) / 0x10000,
    height: readU32(payload, layout.height) / 0x10000,
  };
}

export function setTrackId(tkhd: Mp4Box, trackId: number): void {
  const layout = TKHD_LAYOUT[versionOf(tkhd)]!;

  writeU32(requireLength(tkhd, layout.length), layout.trackId, trackId);
}

export function setTrackEnabled(tkhd: Mp4Box, enabled: boolean): void {
  const payload = requireLength(tkhd, TKHD_LAYOUT[versionOf(tkhd)]!.length);
  const flags = readFlags(payload);

  writeFlags(payload, enabled ? flags | TRACK_ENABLED_FLAG : flags & ~TRACK_ENABLED_FLAG);
}

export function setAlternateGroup(tkhd: Mp4Box, group: number): void {
  const layout = TKHD_LAYOUT[versionOf(tkhd)]!;

  writeU16(requireLength(tkhd, layout.length), layout.alternateGroup, group);
}

export function zeroTrackDimensions(tkhd: Mp4Box): void {
  const layout = TKHD_LAYOUT[versionOf(tkhd)]!;
  const payload = requireLength(tkhd, layout.length);

  writeU32(payload, layout.width, 0);
  writeU32(payload, layout.height, 0);
}

export interface MediaHeader {
  timescale: number;
  duration: number;
}

export function readMediaHeader(mdhd: Mp4Box): MediaHeader {
  const version = versionOf(mdhd);
  const payload = requireLength(mdhd, version ? 32 : 20);

  return version
    ? { timescale: readU32(payload, 20), duration: readU64(payload, 24) }
    : { timescale: readU32(payload, 12), duration: readU32(payload, 16) };
}

export function readHandlerType(hdlr: Mp4Box): string {
  return readFourCC(requireLength(hdlr, 12), 8);
}

export interface SampleEntry {
  count: number;
  codec: string;
  width: number | null;
  height: number | null;
}

const VISUAL_ENTRY_WIDTH_OFFSET = 40;

export function readSampleEntry(stsd: Mp4Box, isVisual: boolean): SampleEntry {
  const payload = requireLength(stsd, 16);
  const count = readU32(payload, 4);
  const codec = count > 0 ? readFourCC(payload, 12) : '';
  const hasDimensions = isVisual && payload.length >= VISUAL_ENTRY_WIDTH_OFFSET + 4;

  return {
    count,
    codec,
    width: hasDimensions ? readU16(payload, VISUAL_ENTRY_WIDTH_OFFSET) : null,
    height: hasDimensions ? readU16(payload, VISUAL_ENTRY_WIDTH_OFFSET + 2) : null,
  };
}

const AUDIO_ENTRY_CHILDREN_OFFSET = 8 + 28;
const ES_DESCRIPTOR_TAG = 0x03;
const DECODER_CONFIG_TAG = 0x04;

interface Descriptor {
  tag: number;
  bodyStart: number;
  bodyEnd: number;
}

function readDescriptor(buffer: Uint8Array, offset: number, end: number): Descriptor | null {
  if (offset >= end) {
    return null;
  }

  let length = 0;
  let cursor = offset + 1;

  for (let index = 0; index < 4 && cursor < end; index++) {
    const byte = buffer[cursor++]!;
    length = (length << 7) | (byte & 0x7f);

    if (!(byte & 0x80)) {
      break;
    }
  }

  return { tag: buffer[offset]!, bodyStart: cursor, bodyEnd: Math.min(end, cursor + length) };
}

function readEsdsObjectType(buffer: Uint8Array, start: number, end: number): number | null {
  const es = readDescriptor(buffer, start, end);

  if (!es || es.tag !== ES_DESCRIPTOR_TAG) {
    return null;
  }

  let cursor = es.bodyStart + 2;
  const flags = buffer[cursor++] ?? 0;

  if (flags & 0x80) {
    cursor += 2;
  }

  if (flags & 0x40) {
    cursor += 1 + (buffer[cursor] ?? 0);
  }

  if (flags & 0x20) {
    cursor += 2;
  }

  const decoderConfig = readDescriptor(buffer, cursor, es.bodyEnd);

  return decoderConfig?.tag === DECODER_CONFIG_TAG ? (buffer[decoderConfig.bodyStart] ?? null) : null;
}

function findEsdsObjectType(buffer: Uint8Array, start: number, end: number): number | null {
  for (let offset = start; offset + 8 <= end; ) {
    const header = readBoxHeader(buffer, offset, end);

    if (!header) {
      return null;
    }

    if (header.type === 'esds') {
      return readEsdsObjectType(buffer, offset + header.headerSize + 4, offset + header.size);
    }

    if (header.type === 'wave') {
      const nested = findEsdsObjectType(buffer, offset + header.headerSize, offset + header.size);

      if (nested !== null) {
        return nested;
      }
    }

    offset += header.size;
  }

  return null;
}

export function readAudioObjectType(stsd: Mp4Box): number | null {
  const payload = stsd.payload;

  if (payload.length < 8 + AUDIO_ENTRY_CHILDREN_OFFSET || readFourCC(payload, 12) !== 'mp4a') {
    return null;
  }

  const entryEnd = Math.min(payload.length, 8 + readU32(payload, 8));
  const soundVersion = readU16(payload, 8 + 16);
  const versionExtra = soundVersion === 1 ? 16 : soundVersion === 2 ? 36 : 0;

  return findEsdsObjectType(payload, 8 + AUDIO_ENTRY_CHILDREN_OFFSET + versionExtra, entryEnd);
}

export function zeroSampleEntryDimensions(stsd: Mp4Box): void {
  const payload = requireLength(stsd, VISUAL_ENTRY_WIDTH_OFFSET + 4);

  writeU16(payload, VISUAL_ENTRY_WIDTH_OFFSET, 0);
  writeU16(payload, VISUAL_ENTRY_WIDTH_OFFSET + 2, 0);
}

export interface SampleSizes {
  sampleCount: number;
  totalBytes: number;
}

export function readSampleSizes(stsz: Mp4Box): SampleSizes {
  const payload = requireLength(stsz, 12);
  const sampleSize = readU32(payload, 4);
  const sampleCount = readU32(payload, 8);

  if (sampleSize !== 0) {
    return { sampleCount, totalBytes: sampleSize * sampleCount };
  }

  requireLength(stsz, 12 + sampleCount * 4);
  let totalBytes = 0;

  for (let index = 0; index < sampleCount; index++) {
    totalBytes += readU32(payload, 12 + index * 4);
  }

  return { sampleCount, totalBytes };
}

export function readChunkOffsets(box: Mp4Box): number[] {
  const payload = requireLength(box, 8);
  const count = readU32(payload, 4);
  const entrySize = box.type === 'co64' ? 8 : 4;

  requireLength(box, 8 + count * entrySize);

  return Array.from({ length: count }, (_, index) =>
    entrySize === 8 ? readU64(payload, 8 + index * 8) : readU32(payload, 8 + index * 4),
  );
}

export function shiftChunkOffsets(box: Mp4Box, delta: number): void {
  if (delta === 0) {
    return;
  }

  const offsets = readChunkOffsets(box);

  offsets.forEach((offset, index) => {
    const shifted = offset + delta;

    if (box.type === 'co64') {
      writeU64(box.payload, 8 + index * 8, shifted);

      return;
    }

    if (shifted < 0 || shifted > MAX_U32) {
      throw new Mp4Error('offset_out_of_range', 'A relocated chunk offset does not fit in a 32-bit stco table.');
    }

    writeU32(box.payload, 8 + index * 4, shifted);
  });
}
