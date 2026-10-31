import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';

import type { Job, Variant } from '../../shared/api.js';
import { AppError } from '../errors.js';
import { createVariantSchema, jobParamsSchema, variantParamsSchema } from '../schemas.js';
import type { Services } from '../services/index.js';

export async function requireUploadedFile(request: FastifyRequest): Promise<MultipartFile> {
  const file = await request.file();

  if (!file) {
    throw new AppError(400, 'file_required', 'Attach a video file.');
  }

  return file;
}

function attachmentHeader(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function jobRoutes({ jobStore, jobs }: Services): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/jobs', async (): Promise<Job[]> => jobStore.list());

    app.post('/api/jobs', async (request, reply) => {
      const job = await jobs.createFromUpload(await requireUploadedFile(request));

      return reply.status(201).send(job);
    });

    app.get('/api/jobs/:jobId', async (request): Promise<Job> => {
      const { jobId } = jobParamsSchema.parse(request.params);

      return jobStore.require(jobId);
    });

    app.get('/api/jobs/:jobId/source', async (request, reply) => {
      const { jobId } = jobParamsSchema.parse(request.params);
      const job = jobStore.require(jobId);

      return reply.sendFile(job.sourceFileName, jobStore.jobDir(jobId));
    });

    app.delete('/api/jobs/:jobId', async (request, reply) => {
      const { jobId } = jobParamsSchema.parse(request.params);

      await jobStore.remove(jobId);

      return reply.status(204).send();
    });

    app.post('/api/jobs/:jobId/variants', async (request, reply) => {
      const { jobId } = jobParamsSchema.parse(request.params);
      const variant: Variant = await jobs.createVariant(jobId, createVariantSchema.parse(request.body));

      return reply.status(201).send(variant);
    });

    app.delete('/api/jobs/:jobId/variants/:variantId', async (request, reply) => {
      const { jobId, variantId } = variantParamsSchema.parse(request.params);

      await jobs.deleteVariant(jobId, variantId);

      return reply.status(204).send();
    });

    app.get('/api/jobs/:jobId/variants/:variantId/file', async (request, reply) => {
      const { jobId, variantId } = variantParamsSchema.parse(request.params);
      const download = jobs.variantDownload(jobId, variantId);
      const { size } = await stat(download.path);

      return reply
        .header('Content-Type', download.contentType)
        .header('Content-Length', size)
        .header('Content-Disposition', attachmentHeader(download.fileName))
        .send(createReadStream(download.path));
    });
  };
}
