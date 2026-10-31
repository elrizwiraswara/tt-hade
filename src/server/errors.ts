import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { Mp4Error } from '../mp4/index.js';
import type { ApiErrorBody } from '../shared/api.js';

export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class TikTokApiError extends Error {
  override readonly name = 'TikTokApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly logId: string | null = null,
  ) {
    super(message);
  }
}

export function notFound(what: string): AppError {
  return new AppError(404, 'not_found', `${what} not found.`);
}

function toBody(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function handleError(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send(toBody(error.code, error.message, error.details));

    return;
  }

  if (error instanceof Mp4Error) {
    reply.status(422).send(toBody(error.code, error.message));

    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send(toBody('invalid_request', 'The request is invalid.', error.flatten()));

    return;
  }

  if (error instanceof TikTokApiError) {
    request.log.warn({ code: error.code, logId: error.logId }, error.message);
    reply.status(502).send(toBody(`tiktok_${error.code}`, error.message, { logId: error.logId }));

    return;
  }

  const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;

  if (statusCode >= 500) {
    request.log.error(error);
  }

  reply.status(statusCode).send(toBody(statusCode >= 500 ? 'internal_error' : 'request_error', error.message));
}
