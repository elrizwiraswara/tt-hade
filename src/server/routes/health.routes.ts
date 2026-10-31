import type { FastifyPluginAsync } from 'fastify';

import { PATCH_PRESETS } from '../../mp4/index.js';
import type { HealthResponse, PresetsResponse } from '../../shared/api.js';
import type { Services } from '../services/index.js';

export function healthRoutes({ config, ffmpeg, oauth }: Services): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/health', async (): Promise<HealthResponse> => ({
      ffmpeg: await ffmpeg.available(),
      tiktokConfigured: oauth.configured,
      appAudited: config.tiktok.audited,
      marker: config.marker,
      redirectUri: config.tiktok.redirectUri,
      chunkSizeMb: config.uploadChunkBytes / (1024 * 1024),
    }));

    app.get('/api/presets', async (): Promise<PresetsResponse> => ({
      presets: [...PATCH_PRESETS],
      marker: config.marker,
    }));
  };
}
