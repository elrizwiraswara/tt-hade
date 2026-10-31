import { open, rename, rm, type FileHandle } from 'node:fs/promises';

import { fillBytes, type AssemblyPlan } from '../../mp4/index.js';

const COPY_BLOCK_BYTES = 8 * 1024 * 1024;

async function writeAll(output: FileHandle, data: Uint8Array, position: number): Promise<void> {
  let written = 0;

  while (written < data.length) {
    const { bytesWritten } = await output.write(data, written, data.length - written, position + written);
    written += bytesWritten;
  }
}

async function copyRange(input: FileHandle, output: FileHandle, start: number, end: number, position: number): Promise<void> {
  const buffer = Buffer.allocUnsafe(Math.min(COPY_BLOCK_BYTES, end - start));

  for (let offset = start; offset < end; ) {
    const length = Math.min(buffer.length, end - offset);
    const { bytesRead } = await input.read(buffer, 0, length, offset);

    if (bytesRead !== length) {
      throw new Error(`Source file ended early at byte ${offset + bytesRead}.`);
    }

    await writeAll(output, buffer.subarray(0, length), position + (offset - start));
    offset += length;
  }
}

async function writeFill(output: FileHandle, pattern: Uint8Array, length: number, position: number): Promise<void> {
  const blockLength = Math.min(length, COPY_BLOCK_BYTES - (COPY_BLOCK_BYTES % pattern.length));
  const block = fillBytes(pattern, blockLength);

  for (let written = 0; written < length; written += blockLength) {
    await writeAll(output, block.subarray(0, Math.min(blockLength, length - written)), position + written);
  }
}

export async function writePlanToFile(plan: AssemblyPlan, sourcePath: string, outputPath: string): Promise<void> {
  const tempPath = `${outputPath}.part`;
  const input = await open(sourcePath, 'r');
  const output = await open(tempPath, 'w');
  let position = 0;

  try {
    for (const part of plan.parts) {
      if (part.kind === 'bytes') {
        await writeAll(output, part.data, position);
        position += part.data.length;
      } else if (part.kind === 'source') {
        await copyRange(input, output, part.start, part.end, position);
        position += part.end - part.start;
      } else {
        await writeFill(output, part.pattern, part.length, position);
        position += part.length;
      }
    }
  } catch (error) {
    await output.close();
    await input.close();
    await rm(tempPath, { force: true });

    throw error;
  }

  await output.close();
  await input.close();

  if (position !== plan.size) {
    await rm(tempPath, { force: true });

    throw new Error(`Assembled ${position} bytes but the plan expected ${plan.size}.`);
  }

  await rename(tempPath, outputPath);
}
