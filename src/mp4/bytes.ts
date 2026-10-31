const TWO_POW_32 = 0x1_0000_0000;

export function readU16(buffer: Uint8Array, offset: number): number {
  return (buffer[offset]! << 8) | buffer[offset + 1]!;
}

export function readU32(buffer: Uint8Array, offset: number): number {
  return (
    buffer[offset]! * 0x100_0000 +
    ((buffer[offset + 1]! << 16) | (buffer[offset + 2]! << 8) | buffer[offset + 3]!)
  );
}

export function readU64(buffer: Uint8Array, offset: number): number {
  return readU32(buffer, offset) * TWO_POW_32 + readU32(buffer, offset + 4);
}

export function writeU16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = (value >>> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
}

export function writeU32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
}

export function writeU64(buffer: Uint8Array, offset: number, value: number): void {
  writeU32(buffer, offset, Math.floor(value / TWO_POW_32));
  writeU32(buffer, offset + 4, value % TWO_POW_32);
}

export function readFourCC(buffer: Uint8Array, offset: number): string {
  return String.fromCharCode(
    buffer[offset]!,
    buffer[offset + 1]!,
    buffer[offset + 2]!,
    buffer[offset + 3]!,
  );
}

export function fourCCBytes(type: string): Uint8Array {
  if (type.length !== 4) {
    throw new RangeError(`Box type must be 4 characters, got "${type}".`);
  }

  return Uint8Array.from(type, (char) => char.charCodeAt(0) & 0xff);
}

export function isPrintableFourCC(buffer: Uint8Array, offset: number): boolean {
  for (let index = offset; index < offset + 4; index++) {
    const byte = buffer[index];

    if (byte === undefined) {
      return false;
    }

    if ((byte < 0x20 || byte > 0x7e) && byte !== 0xa9) {
      return false;
    }
  }

  return true;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
    throw new RangeError(`Invalid hex pattern "${hex}".`);
  }

  return Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16));
}
