import { resolve } from 'node:path';

import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3455),
  HOST: z.string().min(1).default('localhost'),
  DATA_DIR: z.string().min(1).default('./data'),
  TIKTOK_CLIENT_KEY: z.string().default(''),
  TIKTOK_CLIENT_SECRET: z.string().default(''),
  TIKTOK_REDIRECT_URI: z.string().url().default('http://localhost:3455/api/auth/tiktok/callback/'),
  TIKTOK_SCOPES: z.string().default('user.info.basic,video.upload'),
  TIKTOK_APP_AUDITED: booleanFlag.default('false'),
  PATCH_MARKER: z.string().min(1).max(100).default('tt-hade'),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  UPLOAD_CHUNK_MB: z.coerce.number().int().min(5).max(64).default(10),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(4096),
});

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  webDir: string;
  tiktok: {
    clientKey: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
    audited: boolean;
  };
  marker: string;
  ffmpegPath: string;
  ffprobePath: string;
  uploadChunkBytes: number;
  maxUploadBytes: number;
}

function loadEnvFile(): void {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function loadConfig(): AppConfig {
  loadEnvFile();

  const env = envSchema.parse(process.env);

  return {
    port: env.PORT,
    host: env.HOST,
    dataDir: resolve(env.DATA_DIR),
    webDir: resolve('dist/web'),
    tiktok: {
      clientKey: env.TIKTOK_CLIENT_KEY,
      clientSecret: env.TIKTOK_CLIENT_SECRET,
      redirectUri: env.TIKTOK_REDIRECT_URI,
      scopes: env.TIKTOK_SCOPES.split(',').map((scope) => scope.trim()).filter(Boolean),
      audited: env.TIKTOK_APP_AUDITED,
    },
    marker: env.PATCH_MARKER,
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    uploadChunkBytes: env.UPLOAD_CHUNK_MB * 1024 * 1024,
    maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  };
}
