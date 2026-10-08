import type { ValuationRepository } from './repository';

export type RetentionOptions = {
  retentionMs: number;
  intervalMs: number;
  now?: () => number;
};

/** Deletes snapshots older than retentionMs now and then every intervalMs; returns a stop function. */
export function startHistoryRetention(snapshots: ValuationRepository, options: RetentionOptions): () => void {
  const now = options.now ?? Date.now;
  const run = () => {
    try {
      const deleted = snapshots.deleteOlderThan(now() - options.retentionMs);
      if (deleted > 0) console.info(`[retention] deleted ${deleted} valuation snapshots`);
    } catch (err) {
      // A failed cleanup must not take the server down; the next run retries.
      console.error('[retention] failed', err);
    }
  };
  run();
  const timer = setInterval(run, options.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
