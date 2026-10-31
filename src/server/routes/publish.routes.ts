import type { FastifyPluginAsync } from 'fastify';

import type { Publication } from '../../shared/api.js';
import { publicationParamsSchema, publishSchema, variantParamsSchema } from '../schemas.js';
import type { Services } from '../services/index.js';

export function publishRoutes({ publish }: Services): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/jobs/:jobId/variants/:variantId/publications', async (request, reply) => {
      const { jobId, variantId } = variantParamsSchema.parse(request.params);
      const publication = await publish.start(jobId, variantId, publishSchema.parse(request.body));

      return reply.status(202).send(publication);
    });

    app.post(
      '/api/jobs/:jobId/variants/:variantId/publications/:publicationId/refresh',
      async (request): Promise<Publication> => publish.refresh(publicationParamsSchema.parse(request.params)),
    );
  };
}
