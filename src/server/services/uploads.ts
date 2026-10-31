import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { MultipartFile } from '@fastify/multipart';

import { AppError } from '../errors.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v']);

export function videoExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase();

  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw new AppError(415, 'unsupported_file_type', 'Upload an MP4, MOV or M4V video.');
  }

  return extension;
}

export function videoContentType(fileName: string): string {
  return extname(fileName).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4';
}

export async function saveUpload(file: MultipartFile, path: string): Promise<void> {
  try {
    await pipeline(file.file, createWriteStream(path));
  } catch (error) {
    await rm(path, { force: true });

    throw error;
  }

  if (file.file.truncated) {
    await rm(path, { force: true });

    throw new AppError(413, 'file_too_large', 'The video is larger than the configured upload limit.');
  }
}
