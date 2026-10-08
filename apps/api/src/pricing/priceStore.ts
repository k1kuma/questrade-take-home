import type Database from 'better-sqlite3';
import type { Asset } from '@portfolio/contracts';
import type { UpstreamSource } from './errors';
import type { CachedPrice } from './types';

type PriceRow = { asset: string; source: string; price_cad: string; as_of: number; fetched_at: number };

export class PriceStore {
  private readonly selectAll;
  private readonly upsert;

  constructor(private readonly db: Database.Database) {
    this.selectAll = db.prepare<[], PriceRow>(
      'SELECT asset, source, price_cad, as_of, fetched_at FROM price_cache',
    );
    this.upsert = db.prepare<[string, string, string, number, number]>(`
      INSERT INTO price_cache (asset, source, price_cad, as_of, fetched_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (asset) DO UPDATE SET
        source = excluded.source,
        price_cad = excluded.price_cad,
        as_of = excluded.as_of,
        fetched_at = excluded.fetched_at
    `);
  }

  loadAll(): CachedPrice[] {
    return this.selectAll.all().map((row) => ({
      asset: row.asset as Asset,
      source: row.source as UpstreamSource,
      priceCad: row.price_cad,
      asOf: row.as_of,
      fetchedAt: row.fetched_at,
    }));
  }

  save(prices: readonly CachedPrice[]): void {
    this.db.transaction(() => {
      for (const p of prices) this.upsert.run(p.asset, p.source, p.priceCad, p.asOf, p.fetchedAt);
    })();
  }
}
