export type UpstreamSource = 'coingecko' | 'frankfurter';

export type UpstreamFailureReason = 'rate_limited' | 'timeout' | 'unavailable' | 'bad_response';

export class UpstreamError extends Error {
  constructor(
    readonly source: UpstreamSource,
    readonly reason: UpstreamFailureReason,
    message: string,
    readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'UpstreamError';
  }
}
