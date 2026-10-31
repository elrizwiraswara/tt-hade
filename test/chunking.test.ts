import { describe, expect, it } from 'vitest';

import {
  MAX_CHUNK_BYTES,
  MAX_CHUNK_COUNT,
  MAX_FINAL_CHUNK_BYTES,
  MIN_CHUNK_BYTES,
  planUploadChunks,
} from '../src/server/services/tiktok/chunking.js';

const MB = 1024 * 1024;

function assertValid(videoSize: number, preferred: number) {
  const plan = planUploadChunks(videoSize, preferred);
  const covered = plan.chunks.reduce((sum, chunk) => sum + (chunk.end - chunk.start), 0);

  expect(plan.chunks).toHaveLength(plan.totalChunkCount);
  expect(covered).toBe(videoSize);
  expect(plan.chunks[0]!.start).toBe(0);
  expect(plan.chunks.at(-1)!.end).toBe(videoSize);
  expect(plan.totalChunkCount).toBeLessThanOrEqual(MAX_CHUNK_COUNT);
  expect(plan.totalChunkCount).toBe(Math.floor(videoSize / plan.chunkSize));

  plan.chunks.slice(0, -1).forEach((chunk) => expect(chunk.end - chunk.start).toBe(plan.chunkSize));

  if (plan.totalChunkCount > 1) {
    expect(plan.chunkSize).toBeGreaterThanOrEqual(MIN_CHUNK_BYTES);
    expect(plan.chunkSize).toBeLessThanOrEqual(MAX_CHUNK_BYTES);
    expect(plan.chunks.at(-1)!.end - plan.chunks.at(-1)!.start).toBeLessThanOrEqual(MAX_FINAL_CHUNK_BYTES);
  }

  return plan;
}

describe('planUploadChunks', () => {
  it('uploads small files in one chunk', () => {
    expect(assertValid(3 * MB, 10 * MB)).toMatchObject({ chunkSize: 3 * MB, totalChunkCount: 1 });
  });

  it('uploads files up to the chunk size in one chunk', () => {
    expect(assertValid(10 * MB, 10 * MB)).toMatchObject({ totalChunkCount: 1 });
  });

  it('merges trailing bytes into the final chunk', () => {
    const plan = assertValid(25 * MB + 123, 10 * MB);

    expect(plan.totalChunkCount).toBe(2);
    expect(plan.chunks[1]!.end - plan.chunks[1]!.start).toBe(15 * MB + 123);
  });

  it('keeps a slightly larger file as one oversized final chunk', () => {
    expect(assertValid(10 * MB + 1, 10 * MB)).toMatchObject({ totalChunkCount: 1, chunkSize: 10 * MB });
  });

  it('clamps the preferred chunk size to TikTok limits', () => {
    expect(assertValid(500 * MB, 1 * MB).chunkSize).toBe(MIN_CHUNK_BYTES);
    expect(assertValid(500 * MB, 500 * MB).chunkSize).toBe(MAX_CHUNK_BYTES);
  });

  it('grows the chunk size to stay within 1000 chunks', () => {
    expect(assertValid(4 * 1024 * MB, 5 * MB).totalChunkCount).toBeLessThanOrEqual(MAX_CHUNK_COUNT);
  });

  it('rejects empty and oversized files', () => {
    expect(() => planUploadChunks(0, 10 * MB)).toThrow(RangeError);
    expect(() => planUploadChunks(4 * 1024 * MB + 1, 10 * MB)).toThrow(RangeError);
  });
});
