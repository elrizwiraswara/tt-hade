import { randomBytes } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';

import type { InspectResponse, ServedReport } from '../../shared/api.js';
import { servedCheckSchema, variantParamsSchema } from '../schemas.js';
import type { Services } from '../services/index.js';
import { requireUploadedFile } from './job.routes.js';

export function servedRoutes({ served, jobs }: Services): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/served-checks', async (request): Promise<ServedReport> => {
      const { url, download } = servedCheckSchema.parse(request.body);
      const result = await served.check(url, download);

      return { ...result, id: randomBytes(6).toString('hex'), sourceBitrateKbps: null, retention: null };
    });

    app.post('/api/jobs/:jobId/variants/:variantId/served-checks', async (request): Promise<ServedReport> => {
      const { jobId, variantId } = variantParamsSchema.parse(request.params);
      const { url, download } = servedCheckSchema.parse(request.body);

      return jobs.attachServedCheck(jobId, variantId, await served.check(url, download));
    });

    app.post('/api/inspect', async (request): Promise<InspectResponse> => jobs.inspectUpload(await requireUploadedFile(request)));
  };
}
