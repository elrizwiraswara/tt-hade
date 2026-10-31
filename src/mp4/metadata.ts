import { concatBytes, fourCCBytes, writeU32 } from './bytes.js';
import { Mp4Error } from './errors.js';
import { createContainer, createLeaf, findChild, findPath, readBoxHeader, serializeBox, type Mp4Box } from './tree.js';

const ENCODER_TAG = '©too';
const UTF8_TYPE_INDICATOR = 1;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function readEncoderTag(moov: Mp4Box): string | null {
  const tag = findChild(findPath(moov, ['udta', 'meta', 'ilst']), ENCODER_TAG);

  if (!tag || tag.children) {
    return null;
  }

  const header = readBoxHeader(tag.payload, 0, tag.payload.length);

  if (!header || header.type !== 'data' || header.size < header.headerSize + 8) {
    return null;
  }

  return decoder.decode(tag.payload.subarray(header.headerSize + 8, header.size));
}

export function writeEncoderTag(moov: Mp4Box, value: string): void {
  const udta = ensureChildContainer(moov, 'udta', () => createContainer('udta', []));
  const meta = ensureChildContainer(udta, 'meta', () =>
    createContainer('meta', [createMetadataHandler()], new Uint8Array(4)),
  );
  const ilst = ensureChildContainer(meta, 'ilst', () => createContainer('ilst', []));

  ilst.children = ilst.children!.filter((child) => child.type !== ENCODER_TAG);
  ilst.children.push(createLeaf(ENCODER_TAG, serializeBox(createLeaf('data', dataPayload(value)))));
}

function ensureChildContainer(parent: Mp4Box, type: string, create: () => Mp4Box): Mp4Box {
  if (!parent.children) {
    throw new Mp4Error('unsupported_layout', `The '${parent.type}' box could not be parsed, so metadata can't be added.`);
  }

  const existing = findChild(parent, type);

  if (existing && !existing.children) {
    throw new Mp4Error('unsupported_layout', `The '${type}' box could not be parsed, so metadata can't be added.`);
  }

  if (existing) {
    return existing;
  }

  const created = create();
  parent.children.push(created);

  return created;
}

function createMetadataHandler(): Mp4Box {
  const payload = concatBytes([
    new Uint8Array(8),
    fourCCBytes('mdir'),
    fourCCBytes('appl'),
    new Uint8Array(8),
    new Uint8Array(1),
  ]);

  return createLeaf('hdlr', payload);
}

function dataPayload(value: string): Uint8Array {
  const header = new Uint8Array(8);
  writeU32(header, 0, UTF8_TYPE_INDICATOR);

  return concatBytes([header, encoder.encode(value)]);
}
