import { UpstreamError, type UpstreamFailureReason, type UpstreamSource } from './errors';

export type SourceFailure = { reason: UpstreamFailureReason; retryAt: number };

/** Remembers an upstream's most recent failure and blocks further calls until its back-off ends. */
export class SourceHealth {
  private failure: SourceFailure | undefined;

  constructor(
    private readonly source: UpstreamSource,
    private readonly backoffMs: number,
  ) {}

  get lastFailure(): SourceFailure | undefined {
    return this.failure;
  }

  isBlocked(now: number): boolean {
    return this.failure !== undefined && now < this.failure.retryAt;
  }

  recordSuccess(): void {
    this.failure = undefined;
  }

  recordFailure(err: unknown, now: number): void {
    if (err instanceof UpstreamError) {
      console.warn(`[${this.source}] ${err.reason}: ${err.message}`);
      this.failure = { reason: err.reason, retryAt: now + (err.retryAfterMs ?? this.backoffMs) };
      return;
    }
    console.error(`[${this.source}] unexpected failure`, err);
    this.failure = { reason: 'unavailable', retryAt: now + this.backoffMs };
  }
}
