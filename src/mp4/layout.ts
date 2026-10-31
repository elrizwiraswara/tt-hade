import type { RandomAccessSource } from './source.js';
import { readBoxHeader } from './tree.js';

const MAX_TOP_LEVEL_BOXES = 1024;

export interface TopLevelBox {
  type: string;
  start: number;
  size: number;
  headerSize: number;
}

export interface FileLayout {
  fileSize: number;
  boxes: TopLevelBox[];
  trailingBytes: number;
}

export async function scanTopLevel(source: RandomAccessSource): Promise<FileLayout> {
  const boxes: TopLevelBox[] = [];
  let offset = 0;

  while (offset < source.size && boxes.length < MAX_TOP_LEVEL_BOXES) {
    const remaining = source.size - offset;
    const headerBytes = await source.read(offset, Math.min(16, remaining));
    const header = readBoxHeader(headerBytes, 0, remaining);

    if (!header) {
      break;
    }

    boxes.push({ type: header.type, start: offset, size: header.size, headerSize: header.headerSize });
    offset += header.size;
  }

  return { fileSize: source.size, boxes, trailingBytes: source.size - offset };
}

export function boxesOfType(layout: FileLayout, type: string): TopLevelBox[] {
  return layout.boxes.filter((box) => box.type === type);
}

export function payloadRange(box: TopLevelBox): { start: number; end: number } {
  return { start: box.start + box.headerSize, end: box.start + box.size };
}
