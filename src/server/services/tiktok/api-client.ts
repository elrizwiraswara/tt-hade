import { TikTokApiError } from '../../errors.js';

const OPEN_API_BASE = 'https://open.tiktokapis.com';

interface OpenApiEnvelope<T> {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
    logid?: string;
  };
}

interface OAuthErrorBody {
  error?: string;
  error_description?: string;
  log_id?: string;
}

interface OpenApiRequest {
  method: 'GET' | 'POST';
  accessToken: string;
  body?: unknown;
  query?: Record<string, string>;
}

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TikTokApiError(response.status, 'invalid_response', `TikTok returned a non-JSON response (HTTP ${response.status}).`);
  }
}

export async function callOpenApi<T>(path: string, request: OpenApiRequest): Promise<T> {
  const url = new URL(path, OPEN_API_BASE);

  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${request.accessToken}` };

  if (request.method === 'POST') {
    headers['Content-Type'] = 'application/json; charset=UTF-8';
  }

  const response = await fetch(url, {
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const payload = await readJson<OpenApiEnvelope<T>>(response);
  const code = payload?.error?.code ?? (response.ok ? 'ok' : `http_${response.status}`);

  if (!response.ok || code !== 'ok') {
    throw new TikTokApiError(
      response.status,
      code,
      payload?.error?.message || `TikTok returned HTTP ${response.status}.`,
      payload?.error?.log_id ?? payload?.error?.logid ?? null,
    );
  }

  return (payload?.data ?? {}) as T;
}

export async function callOAuth<T>(path: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(new URL(path, OPEN_API_BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const payload = await readJson<T & OAuthErrorBody>(response);

  if (!response.ok || !payload || payload.error) {
    throw new TikTokApiError(
      response.status,
      payload?.error || `http_${response.status}`,
      payload?.error_description || `TikTok sign-in failed (HTTP ${response.status}).`,
      payload?.log_id ?? null,
    );
  }

  return payload;
}
