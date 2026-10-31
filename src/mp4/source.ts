export interface RandomAccessSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export class MemorySource implements RandomAccessSource {
  constructor(private readonly bytes: Uint8Array) {}

  get size(): number {
    return this.bytes.length;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    return this.bytes.subarray(offset, Math.min(offset + length, this.bytes.length));
  }
}
