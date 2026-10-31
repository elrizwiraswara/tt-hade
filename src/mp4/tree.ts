import { fourCCBytes, isPrintableFourCC, readFourCC, readU32, readU64, writeU32, writeU64 } from './bytes.js';
import { Mp4Error } from './errors.js';

const MAX_DEPTH = 16;
const MAX_U32 = 0xffff_ffff;
const EMPTY = new Uint8Array(0);

const CONTAINER_TYPES = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'dinf',
  'udta',
  'meta',
  'ilst',
  'mvex',
  'tref',
]);

export interface Mp4Box {
  type: string;
  largeSize: boolean;
  prefix: Uint8Array;
  children: Mp4Box[] | null;
  payload: Uint8Array;
  suffix: Uint8Array;
}

export interface BoxHeader {
  type: string;
  size: number;
  headerSize: number;
  largeSize: boolean;
}

export function readBoxHeader(buffer: Uint8Array, offset: number, end: number): BoxHeader | null {
  if (offset + 8 > end) {
    return null;
  }

  let size = readU32(buffer, offset);
  let headerSize = 8;
  let largeSize = false;

  if (size === 1) {
    if (offset + 16 > end) {
      return null;
    }

    size = readU64(buffer, offset + 8);
    headerSize = 16;
    largeSize = true;
  } else if (size === 0) {
    size = end - offset;
  }

  if (size < headerSize || offset + size > end || !isPrintableFourCC(buffer, offset + 4)) {
    return null;
  }

  return { type: readFourCC(buffer, offset + 4), size, headerSize, largeSize };
}

export function parseBoxes(buffer: Uint8Array, start = 0, end = buffer.length): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;

  while (offset < end) {
    const header = readBoxHeader(buffer, offset, end);

    if (!header) {
      throw new Mp4Error('malformed_box', `Malformed box header at byte ${offset}.`);
    }

    boxes.push(parseBox(buffer, offset, header, 0));
    offset += header.size;
  }

  return boxes;
}

function parseBox(buffer: Uint8Array, offset: number, header: BoxHeader, depth: number): Mp4Box {
  if (depth > MAX_DEPTH) {
    throw new Mp4Error('malformed_box', 'Box nesting is too deep to patch safely.');
  }

  const payloadStart = offset + header.headerSize;
  const payloadEnd = offset + header.size;

  if (CONTAINER_TYPES.has(header.type)) {
    const prefixLength = containerPrefixLength(header.type, buffer, payloadStart, payloadEnd);
    const parsed = tryParseChildren(buffer, payloadStart + prefixLength, payloadEnd, depth + 1);

    if (parsed) {
      return {
        type: header.type,
        largeSize: header.largeSize,
        prefix: buffer.slice(payloadStart, payloadStart + prefixLength),
        children: parsed.children,
        payload: EMPTY,
        suffix: buffer.slice(parsed.suffixStart, payloadEnd),
      };
    }
  }

  return createLeaf(header.type, buffer.slice(payloadStart, payloadEnd), header.largeSize);
}

function containerPrefixLength(type: string, buffer: Uint8Array, start: number, end: number): number {
  if (type !== 'meta') {
    return 0;
  }

  const isQuickTimeMeta = end - start >= 8 && readFourCC(buffer, start + 4) === 'hdlr';

  return isQuickTimeMeta ? 0 : 4;
}

function tryParseChildren(
  buffer: Uint8Array,
  start: number,
  end: number,
  depth: number,
): { children: Mp4Box[]; suffixStart: number } | null {
  if (start > end) {
    return null;
  }

  const children: Mp4Box[] = [];
  let offset = start;

  while (offset < end) {
    const header = readBoxHeader(buffer, offset, end);

    if (!header) {
      return isZeroPadding(buffer, offset, end) ? { children, suffixStart: offset } : null;
    }

    children.push(parseBox(buffer, offset, header, depth));
    offset += header.size;
  }

  return { children, suffixStart: end };
}

function isZeroPadding(buffer: Uint8Array, start: number, end: number): boolean {
  if (end - start >= 8) {
    return false;
  }

  for (let index = start; index < end; index++) {
    if (buffer[index] !== 0) {
      return false;
    }
  }

  return true;
}

export function createLeaf(type: string, payload: Uint8Array, largeSize = false): Mp4Box {
  return { type, largeSize, prefix: EMPTY, children: null, payload, suffix: EMPTY };
}

export function createContainer(type: string, children: Mp4Box[], prefix: Uint8Array = EMPTY): Mp4Box {
  return { type, largeSize: false, prefix, children, payload: EMPTY, suffix: EMPTY };
}

export function cloneBox(box: Mp4Box): Mp4Box {
  return {
    type: box.type,
    largeSize: box.largeSize,
    prefix: box.prefix.slice(),
    children: box.children ? box.children.map(cloneBox) : null,
    payload: box.payload.slice(),
    suffix: box.suffix.slice(),
  };
}

function bodySize(box: Mp4Box): number {
  if (!box.children) {
    return box.payload.length;
  }

  const childrenSize = box.children.reduce((sum, child) => sum + boxSize(child), 0);

  return box.prefix.length + childrenSize + box.suffix.length;
}

function headerSizeFor(box: Mp4Box, body: number): number {
  return box.largeSize || body + 8 > MAX_U32 ? 16 : 8;
}

export function boxSize(box: Mp4Box): number {
  const body = bodySize(box);

  return headerSizeFor(box, body) + body;
}

export function serializeBox(box: Mp4Box): Uint8Array {
  const output = new Uint8Array(boxSize(box));
  writeBox(box, output, 0);

  return output;
}

function writeBox(box: Mp4Box, output: Uint8Array, offset: number): number {
  const body = bodySize(box);
  const headerSize = headerSizeFor(box, body);
  const typeBytes = fourCCBytes(box.type);

  if (headerSize === 16) {
    writeU32(output, offset, 1);
    output.set(typeBytes, offset + 4);
    writeU64(output, offset + 8, headerSize + body);
  } else {
    writeU32(output, offset, headerSize + body);
    output.set(typeBytes, offset + 4);
  }

  let cursor = offset + headerSize;

  if (!box.children) {
    output.set(box.payload, cursor);

    return cursor + box.payload.length;
  }

  output.set(box.prefix, cursor);
  cursor += box.prefix.length;

  for (const child of box.children) {
    cursor = writeBox(child, output, cursor);
  }

  output.set(box.suffix, cursor);

  return cursor + box.suffix.length;
}

export function findChild(box: Mp4Box | undefined, type: string): Mp4Box | undefined {
  return box?.children?.find((child) => child.type === type);
}

export function findPath(box: Mp4Box | undefined, path: readonly string[]): Mp4Box | undefined {
  return path.reduce<Mp4Box | undefined>((current, type) => findChild(current, type), box);
}

export function childrenOfType(box: Mp4Box | undefined, type: string): Mp4Box[] {
  return box?.children?.filter((child) => child.type === type) ?? [];
}
