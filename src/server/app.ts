import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from './config.js';
import { handleError } from './errors.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { jobRoutes } from './routes/job.routes.js';
import { publishRoutes } from './routes/publish.routes.js';
import { servedRoutes } from './routes/served.routes.js';
import { createServices } from './services/index.js';

async function hasBuiltWeb(webDir: string): Promise<boolean> {
  try {
    return (await stat(join(webDir, 'index.html'))).isFile();
  } catch {
    return false;
  }
}

function registerNotFound(app: FastifyInstance, servesWeb: boolean): void {
  app.setNotFoundHandler((request, reply) => {
    if (servesWeb && request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }

    return reply.status(404).send({ error: { code: 'not_found', message: `Route ${request.method} ${request.url} not found.` } });
  });
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const servesWeb = await hasBuiltWeb(config.webDir);

  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });
  await app.register(fastifyStatic, { root: servesWeb ? config.webDir : config.dataDir, serve: servesWeb });
  app.setErrorHandler(handleError);

  const services = await createServices(config, app.log);

  await app.register(healthRoutes(services));
  await app.register(authRoutes(services));
  await app.register(jobRoutes(services));
  await app.register(publishRoutes(services));
  await app.register(servedRoutes(services));
  registerNotFound(app, servesWeb);

  return app;
}
