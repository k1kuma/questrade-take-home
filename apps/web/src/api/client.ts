import type { ApiError, PricesUnavailableError } from '@portfolio/contracts';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super((body as Partial<ApiError> | undefined)?.error?.message ?? `Request failed with HTTP ${status}`);
    this.name = 'ApiRequestError';
  }

  get pricesUnavailable(): PricesUnavailableError['error'] | undefined {
    const error = (this.body as Partial<PricesUnavailableError> | undefined)?.error;
    return error?.code === 'PRICES_UNAVAILABLE' ? error : undefined;
  }
}

/** Calls our API through the Vite proxy; non-2xx responses throw ApiRequestError, network failures throw as-is. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  });
  if (!res.ok) {
    // Error bodies are best-effort (a proxy error page isn't JSON); the status alone is enough.
    const body: unknown = await res.json().catch(() => undefined);
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ApiRequestError(res.status, body, retryAfter > 0 ? retryAfter : undefined);
  }
  // On success, invalid JSON or an abort mid-body must reject, never resolve as undefined data.
  return (await res.json()) as T;
}
