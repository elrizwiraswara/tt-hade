const MB = 1024 * 1024;

export const MIN_CHUNK_BYTES = 5 * MB;
export const MAX_CHUNK_BYTES = 64 * MB;
export const MAX_FINAL_CHUNK_BYTES = 128 * MB;
export const MAX_CHUNK_COUNT = 1000;
export const MAX_VIDEO_BYTES = 4 * 1024 * MB;

export interface ChunkRange {
  start: number;
  end: number;
}

export interface UploadChunkPlan {
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
  chunks: ChunkRange[];
}

export function planUploadChunks(videoSize: number, preferredChunkSize: number): UploadChunkPlan {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) {
    throw new RangeError('The video is empty.');
  }

  if (videoSize > MAX_VIDEO_BYTES) {
    throw new RangeError('TikTok accepts videos up to 4 GB.');
  }

  let chunkSize = Math.min(MAX_CHUNK_BYTES, Math.max(MIN_CHUNK_BYTES, preferredChunkSize));

  if (videoSize <= chunkSize) {
    return { videoSize, chunkSize: videoSize, totalChunkCount: 1, chunks: [{ start: 0, end: videoSize }] };
  }

  chunkSize = Math.max(chunkSize, Math.ceil(videoSize / MAX_CHUNK_COUNT));

  const totalChunkCount = Math.floor(videoSize / chunkSize);
  const chunks = Array.from({ length: totalChunkCount }, (_, index) => ({
    start: index * chunkSize,
    end: index === totalChunkCount - 1 ? videoSize : (index + 1) * chunkSize,
  }));

  return { videoSize, chunkSize, totalChunkCount, chunks };
}
