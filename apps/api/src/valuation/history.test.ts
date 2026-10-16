import type Database from 'better-sqlite3';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { HistoryPoint } from '@portfolio/contracts';
import { createTestApp } from '../testApp';
import { ValuationRepository } from './repository';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const T0 = Date.parse('2026-10-01T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

type Seed = { at: number; total: string; degraded?: boolean };

function seed(db: Database.Database, portfolioId: string, seeds: Seed[]) {
  const repo = new ValuationRepository(db);
  db.transaction(() => {
    seeds.forEach((s, i) =>
      repo.recordIfChanged({
        portfolioId,
        computedAt: s.at,
        totalCad: s.total,
        status: s.degraded ? 'degraded' : 'complete',
        fingerprint: `fp-${i}`,
        breakdown: [],
      }),
    );
  })();
}

async function setup(now = T0 + 10 * DAY) {
  const clock = { t: now };
  const { app, db } = createTestApp({ now: () => clock.t });
  const res = await request(app).post('/portfolios').send([]);
  return { app, db, clock, id: res.body.id as string };
}

describe('GET /portfolios/:id/history', () => {
  it('returns raw points in time order, from the first snapshot to now by default', async () => {
    const { app, db, clock, id } = await setup();
    seed(db, id, [
      { at: T0 + 2 * MINUTE, total: '102.00' },
      { at: T0, total: '100.00' },
      { at: T0 + MINUTE, total: '101.00', degraded: true },
    ]);

    const res = await request(app).get(`/portfolios/${id}/history`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      portfolioId: id,
      from: iso(T0),
      to: iso(clock.t),
      downsampled: false,
      points: [
        { at: iso(T0), totalCad: '100.00', status: 'complete' },
        { at: iso(T0 + MINUTE), totalCad: '101.00', status: 'degraded' },
        { at: iso(T0 + 2 * MINUTE), totalCad: '102.00', status: 'complete' },
      ],
    });
  });

  it('downsamples thousands of snapshots to at most maxPoints, keeping real values and degraded periods', async () => {
    const { app, db, id } = await setup();
    const seeds: Seed[] = Array.from({ length: 5000 }, (_, i) => ({
      at: T0 + i * MINUTE,
      total: (1000 + i).toFixed(2),
      degraded: i % 997 === 0,
    }));
    seed(db, id, seeds);
    const from = T0;
    const to = T0 + 4999 * MINUTE;

    const res = await request(app).get(`/portfolios/${id}/history`).query({ from: iso(from), to: iso(to), maxPoints: 100 });

    // Reference: latest snapshot per equal-width bucket, degraded if any snapshot in the bucket was.
    const bucketMs = Math.ceil((to - from + 1) / 100);
    const buckets = new Map<number, HistoryPoint>();
    for (const s of seeds) {
      const key = Math.floor((s.at - from) / bucketMs);
      const wasDegraded = buckets.get(key)?.status === 'degraded';
      buckets.set(key, { at: iso(s.at), totalCad: s.total, status: wasDegraded || s.degraded ? 'degraded' : 'complete' });
    }

    expect(res.body.downsampled).toBe(true);
    expect(res.body.points.length).toBeLessThanOrEqual(100);
    expect(res.body.points).toEqual([...buckets.values()]);
    // The last bucket also holds snapshot 4985, which was degraded, so the bucket is flagged.
    expect(res.body.points.at(-1)).toEqual({ at: iso(to), totalCad: '5999.00', status: 'degraded' });
  });
});

describe('history retention', () => {
  it('deletes snapshots older than the cutoff in batches and keeps newer ones', async () => {
    const { db, id } = await setup();
    seed(db, id, [
      ...Array.from({ length: 7 }, (_, i) => ({ at: T0 + i * MINUTE, total: '1.00' })),
      ...Array.from({ length: 3 }, (_, i) => ({ at: T0 + 100 * DAY + i * MINUTE, total: '2.00' })),
    ]);
    const repo = new ValuationRepository(db);

    const deleted = repo.deleteOlderThan(T0 + DAY, 2);

    expect(deleted).toBe(7);
    expect(repo.earliestComputedAt(id)).toBe(T0 + 100 * DAY);
  });
});
