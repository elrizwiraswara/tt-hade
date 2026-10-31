import { readChunkOffsets } from './fields.js';
import { boxesOfType, payloadRange, scanTopLevel } from './layout.js';
import { readEncoderTag } from './metadata.js';
import { readMovie, type MovieModel } from './movie.js';
import type { PatchExpectation } from './patch.js';
import type { RandomAccessSource } from './source.js';
import { parseBoxes } from './tree.js';

const COMPARE_BLOCK_BYTES = 4 * 1024 * 1024;

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function check(name: string, ok: boolean, detail: string): VerificationCheck {
  return { name, ok, detail };
}

function offsetsInside(movie: MovieModel, start: number, end: number): boolean {
  return movie.tracks.every((track) =>
    track.nodes.chunkOffsets
      ? readChunkOffsets(track.nodes.chunkOffsets).every((offset) => offset >= start && offset < end)
      : false,
  );
}

export async function verifyPatchedFile(
  output: RandomAccessSource,
  expectation: PatchExpectation,
): Promise<VerificationCheck[]> {
  const layout = await scanTopLevel(output);
  const moovBoxes = boxesOfType(layout, 'moov');
  const mdatBoxes = boxesOfType(layout, 'mdat');
  const checks: VerificationCheck[] = [
    check(
      'Trailing data',
      layout.trailingBytes === expectation.trailingBytes,
      `${layout.trailingBytes} bytes after the last box (expected ${expectation.trailingBytes}).`,
    ),
    check(
      'Container layout',
      moovBoxes.length === 1 && mdatBoxes.length === 1,
      `${moovBoxes.length} moov and ${mdatBoxes.length} mdat boxes.`,
    ),
  ];

  const moovBox = moovBoxes[0];
  const mdatBox = mdatBoxes[0];

  if (!moovBox || !mdatBox) {
    return checks;
  }

  const media = payloadRange(mdatBox);

  checks.push(
    check(
      'Media data position',
      media.start === expectation.outputMediaRange.start && media.end === expectation.outputMediaRange.end,
      `Media data at ${media.start}-${media.end}.`,
    ),
  );

  let movie: MovieModel;
  let encoderTag: string | null;

  try {
    const [moov] = parseBoxes(await output.read(moovBox.start, moovBox.size));
    movie = readMovie(moov!);
    encoderTag = readEncoderTag(moov!);
  } catch (error) {
    checks.push(check('Header parses', false, error instanceof Error ? error.message : String(error)));

    return checks;
  }

  const video = movie.tracks.find((track) => track.kind === 'video');

  checks.push(
    check('Header parses', true, `${movie.tracks.length} tracks.`),
    check(
      'Track count',
      movie.tracks.length === expectation.trackCount,
      `${movie.tracks.length} tracks (expected ${expectation.trackCount}).`,
    ),
    check(
      'Video codec unchanged',
      video?.entry?.codec === expectation.videoCodec,
      `Codec ${video?.entry?.codec ?? 'missing'} (expected ${expectation.videoCodec}).`,
    ),
    check(
      'Video samples unchanged',
      video?.sizes?.sampleCount === expectation.videoSampleCount,
      `${video?.sizes?.sampleCount ?? 0} samples (expected ${expectation.videoSampleCount}).`,
    ),
    check(
      'Chunk offsets inside media data',
      offsetsInside(movie, media.start, media.end),
      'Every chunk offset must point into the media data.',
    ),
    check(
      'Movie duration',
      movie.header.durationUnknown === expectation.durationUnknown,
      movie.header.durationUnknown ? 'Duration is "unknown".' : 'Duration is declared.',
    ),
  );

  if (expectation.encoderTag) {
    checks.push(
      check('Encoder tag', encoderTag === expectation.encoderTag, `Encoder tag is "${encoderTag ?? 'missing'}".`),
    );
  }

  return checks;
}

export async function verifyMediaIdentical(
  source: RandomAccessSource,
  output: RandomAccessSource,
  expectation: PatchExpectation,
): Promise<VerificationCheck> {
  const { sourceMediaRange, outputMediaRange } = expectation;
  const length = sourceMediaRange.end - sourceMediaRange.start;

  for (let offset = 0; offset < length; offset += COMPARE_BLOCK_BYTES) {
    const size = Math.min(COMPARE_BLOCK_BYTES, length - offset);
    const [left, right] = await Promise.all([
      source.read(sourceMediaRange.start + offset, size),
      output.read(outputMediaRange.start + offset, size),
    ]);

    if (left.length !== size || right.length !== size || !bytesEqual(left, right)) {
      return check('Media bytes identical', false, `Media data differs near byte ${offset}.`);
    }
  }

  return check('Media bytes identical', true, `${length.toLocaleString('en-US')} bytes of audio/video copied unchanged.`);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}
