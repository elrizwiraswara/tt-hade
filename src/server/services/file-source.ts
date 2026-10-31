import { open, type FileHandle } from 'node:fs/promises';

import type { RandomAccessSource } from '../../mp4/index.js';

export class FileSource implements RandomAccessSource {
  private constructor(
    private readonly handle: FileHandle,
    readonly size: number,
  ) {}

  static async open(path: string): Promise<FileSource> {
    const handle = await open(path, 'r');
    const { size } = await handle.stat();

    return new FileSource(handle, size);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const size = Math.max(0, Math.min(length, this.size - offset));
    const buffer = Buffer.allocUnsafe(size);
    const { bytesRead } = await this.handle.read(buffer, 0, size, offset);

    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
  }

  close(): Promise<void> {
    return this.handle.close();
  }
}

export async function withFileSource<T>(path: string, use: (source: FileSource) => Promise<T>): Promise<T> {
  const source = await FileSource.open(path);

  try {
    return await use(source);
  } finally {
    await source.close();
  }
}
