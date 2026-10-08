import { UpstreamError, type UpstreamSource } from './errors';

export type FetchFn = typeof fetch;

export type FetchJsonOptions = {
  source: UpstreamSource;
  fetchFn: FetchFn;
  timeoutMs: number;
  headers?: Record<string, string>;
};

// Retry-After is either delta-seconds or an HTTP date (RFC 9110 §10.2.3).
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'TimeoutError';
}

export async function fetchJson(url: URL, options: FetchJsonOptions): Promise<unknown> {
  const { source, fetchFn, timeoutMs, headers } = options;
  // One signal covers connecting, waiting for headers and reading the body.
  const signal = AbortSignal.timeout(timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(url, { headers: { accept: 'application/json', ...headers }, signal });
  } catch (err) {
    if (isTimeout(err)) {
      throw new UpstreamError(source, 'timeout', `${source} timed out after ${timeoutMs}ms`, undefined, { cause: err });
    }
    throw new UpstreamError(source, 'unavailable', `${source} request failed`, undefined, { cause: err });
  }

  if (!res.ok) {
    // Undici holds the connection until the body is consumed or cancelled.
    await res.body?.cancel();
    if (res.status === 429) {
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), Date.now());
      throw new UpstreamError(source, 'rate_limited', `${source} rate limited the request`, retryAfterMs);
    }
    throw new UpstreamError(source, 'unavailable', `${source} responded with HTTP ${res.status}`);
  }

  try {
    return await res.json();
  } catch (err) {
    if (isTimeout(err)) {
      throw new UpstreamError(source, 'timeout', `${source} timed out after ${timeoutMs}ms`, undefined, { cause: err });
    }
    throw new UpstreamError(source, 'bad_response', `${source} returned invalid JSON`, undefined, { cause: err });
  }
}
