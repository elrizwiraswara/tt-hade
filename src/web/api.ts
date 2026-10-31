import type {
  AccountSummary,
  ApiErrorBody,
  CreateVariantRequest,
  CreatorInfo,
  HealthResponse,
  InspectResponse,
  Job,
  PresetsResponse,
  Publication,
  PublishRequest,
  ServedCheckRequest,
  ServedReport,
  Variant,
} from '../shared/api.js';

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const error = (body as ApiErrorBody | null)?.error;

  return new ApiError(status, error?.code ?? 'http_error', error?.message ?? `Request failed (HTTP ${status}).`, error?.details);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Is it running?');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw toApiError(response.status, body);
  }

  return body as T;
}

function jsonBody(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function uploadWithProgress<T>(url: string, file: File, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();

    form.append('file', file);
    xhr.open('POST', url);
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as T);
      } else {
        reject(toApiError(xhr.status, xhr.response));
      }
    };

    xhr.onerror = () => reject(new ApiError(0, 'network_error', 'The upload failed. Is the server running?'));
    xhr.send(form);
  });
}

const encode = encodeURIComponent;

function variantPath(jobId: string, variantId: string): string {
  return `/api/jobs/${encode(jobId)}/variants/${encode(variantId)}`;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  presets: () => request<PresetsResponse>('/api/presets'),

  accounts: () => request<AccountSummary[]>('/api/accounts'),
  disconnectAccount: (openId: string) => request<void>(`/api/accounts/${encode(openId)}`, { method: 'DELETE' }),
  creatorInfo: (openId: string) => request<CreatorInfo>(`/api/accounts/${encode(openId)}/creator-info`),
  connectUrl: () => `/api/auth/tiktok/start?returnTo=${encode(window.location.origin)}`,

  jobs: () => request<Job[]>('/api/jobs'),
  createJob: (file: File, onProgress?: (fraction: number) => void) => uploadWithProgress<Job>('/api/jobs', file, onProgress),
  deleteJob: (jobId: string) => request<void>(`/api/jobs/${encode(jobId)}`, { method: 'DELETE' }),
  sourceVideoUrl: (jobId: string) => `/api/jobs/${encode(jobId)}/source`,

  createVariant: (jobId: string, body: CreateVariantRequest) =>
    request<Variant>(`/api/jobs/${encode(jobId)}/variants`, jsonBody('POST', body)),
  deleteVariant: (jobId: string, variantId: string) => request<void>(variantPath(jobId, variantId), { method: 'DELETE' }),
  variantFileUrl: (jobId: string, variantId: string) => `${variantPath(jobId, variantId)}/file`,

  publish: (jobId: string, variantId: string, body: PublishRequest) =>
    request<Publication>(`${variantPath(jobId, variantId)}/publications`, jsonBody('POST', body)),
  refreshPublication: (jobId: string, variantId: string, publicationId: string) =>
    request<Publication>(`${variantPath(jobId, variantId)}/publications/${encode(publicationId)}/refresh`, { method: 'POST' }),

  servedCheck: (jobId: string, variantId: string, body: ServedCheckRequest) =>
    request<ServedReport>(`${variantPath(jobId, variantId)}/served-checks`, jsonBody('POST', body)),
  standaloneServedCheck: (body: ServedCheckRequest) => request<ServedReport>('/api/served-checks', jsonBody('POST', body)),
  inspect: (file: File, onProgress?: (fraction: number) => void) =>
    uploadWithProgress<InspectResponse>('/api/inspect', file, onProgress),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
