import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AccountSummary, CreatorInfo } from '../../shared/api.js';
import { accountParamsSchema } from '../schemas.js';
import type { Services } from '../services/index.js';
import { toAccountSummary } from '../services/tiktok/account.store.js';
import type { CallbackQuery } from '../services/tiktok/oauth.service.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const startQuerySchema = z.object({ returnTo: z.string().optional() });

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

function safeReturnTo(value: string | undefined): string {
  if (!value) {
    return '/';
  }

  try {
    const url = new URL(value);

    if ((url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTS.has(url.hostname)) {
      return `${url.origin}/`;
    }
  } catch {
    return '/';
  }

  return '/';
}

export function authRoutes({ oauth, accounts, posting }: Services): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/auth/tiktok/start', async (request, reply) => {
      const { returnTo } = startQuerySchema.parse(request.query);

      return reply.redirect(oauth.authorizationUrl(safeReturnTo(returnTo)));
    });

    const callback = async (request: FastifyRequest, reply: FastifyReply) => {
      const query: CallbackQuery = callbackQuerySchema.parse(request.query);
      const result = await oauth.completeAuthorization(query);
      const target = new URL(result.returnTo, `http://${request.headers.host ?? 'localhost'}`);

      if (result.error) {
        target.searchParams.set('auth_error', result.error);
      } else if (result.account) {
        target.searchParams.set('connected', result.account.displayName);
      }

      return reply.redirect(target.toString());
    };

    app.get('/api/auth/tiktok/callback', callback);
    app.get('/api/auth/tiktok/callback/', callback);

    app.get('/api/accounts', async (): Promise<AccountSummary[]> => accounts.list().map(toAccountSummary));

    app.delete('/api/accounts/:openId', async (request, reply) => {
      const { openId } = accountParamsSchema.parse(request.params);

      await oauth.disconnect(openId);

      return reply.status(204).send();
    });

    app.get('/api/accounts/:openId/creator-info', async (request): Promise<CreatorInfo> => {
      const { openId } = accountParamsSchema.parse(request.params);

      return posting.creatorInfo(openId);
    });
  };
}
