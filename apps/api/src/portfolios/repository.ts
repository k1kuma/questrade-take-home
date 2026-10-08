import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Asset, Holding, Portfolio, PortfolioSummary } from '@portfolio/contracts';

type PortfolioRow = { id: string; name: string; created_at: number; updated_at: number };
type HoldingRow = { asset: string; amount: string };

export class PortfolioRepository {
  private readonly insertPortfolio;
  private readonly nextDefaultNumber;
  private readonly touchPortfolio;
  private readonly selectPortfolio;
  private readonly selectRecentPortfolios;
  private readonly selectAssetsForPortfolios;
  private readonly insertHolding;
  private readonly deleteHoldings;
  private readonly selectHoldings;

  constructor(private readonly db: Database.Database) {
    this.insertPortfolio = db.prepare<[string, string, number, number]>(
      'INSERT INTO portfolios (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    );
    this.nextDefaultNumber = db.prepare<[], { n: number }>('SELECT COUNT(*) + 1 AS n FROM portfolios');
    // A null name keeps the current one (bare-array PUT).
    this.touchPortfolio = db.prepare<[number, string | null, string]>(
      'UPDATE portfolios SET updated_at = ?, name = COALESCE(?, name) WHERE id = ?',
    );
    this.selectPortfolio = db.prepare<[string], PortfolioRow>(
      'SELECT id, name, created_at, updated_at FROM portfolios WHERE id = ?',
    );
    // rowid breaks ties between portfolios updated in the same millisecond.
    this.selectRecentPortfolios = db.prepare<[number], PortfolioRow>(
      'SELECT id, name, created_at, updated_at FROM portfolios ORDER BY updated_at DESC, rowid DESC LIMIT ?',
    );
    this.selectAssetsForPortfolios = db.prepare<[string], { portfolio_id: string; asset: string }>(
      'SELECT portfolio_id, asset FROM holdings WHERE portfolio_id IN (SELECT value FROM json_each(?)) ORDER BY rowid',
    );
    this.insertHolding = db.prepare<[string, string, string]>(
      'INSERT INTO holdings (portfolio_id, asset, amount) VALUES (?, ?, ?)',
    );
    this.deleteHoldings = db.prepare<[string]>('DELETE FROM holdings WHERE portfolio_id = ?');
    // rowid order preserves the order the client submitted holdings in.
    this.selectHoldings = db.prepare<[string], HoldingRow>(
      'SELECT asset, amount FROM holdings WHERE portfolio_id = ? ORDER BY rowid',
    );
  }

  /** Without a name it becomes "Portfolio N", numbered inside the transaction so concurrent creates can't collide. */
  create(name: string | undefined, holdings: Holding[]): Portfolio {
    const id = randomUUID();
    const now = Date.now();
    const finalName = this.db.transaction(() => {
      const resolved = name ?? `Portfolio ${this.nextDefaultNumber.get()!.n}`;
      this.insertPortfolio.run(id, resolved, now, now);
      this.insertHoldings(id, holdings);
      return resolved;
    })();
    return { id, name: finalName, holdings, createdAt: toIso(now), updatedAt: toIso(now) };
  }

  findById(id: string): Portfolio | undefined {
    const row = this.selectPortfolio.get(id);
    if (!row) return undefined;
    const holdings = this.selectHoldings
      .all(id)
      .map((h) => ({ asset: h.asset as Asset, amount: h.amount }));
    return {
      id: row.id,
      name: row.name,
      holdings,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  /** Most recently updated first; two queries rather than one per portfolio. */
  listRecent(limit: number): PortfolioSummary[] {
    const rows = this.selectRecentPortfolios.all(limit);
    const assetsById = new Map(rows.map((row) => [row.id, [] as Asset[]]));
    const ids = JSON.stringify(rows.map((row) => row.id));
    for (const { portfolio_id, asset } of this.selectAssetsForPortfolios.all(ids)) {
      assetsById.get(portfolio_id)?.push(asset as Asset);
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      assets: assetsById.get(row.id) ?? [],
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }));
  }

  /** Replaces all holdings; renames too when a name is given. */
  replace(id: string, name: string | undefined, holdings: Holding[]): Portfolio | undefined {
    return this.db.transaction(() => {
      if (this.touchPortfolio.run(Date.now(), name ?? null, id).changes === 0) return undefined;
      this.deleteHoldings.run(id);
      this.insertHoldings(id, holdings);
      return this.findById(id);
    })();
  }

  private insertHoldings(portfolioId: string, holdings: Holding[]): void {
    for (const { asset, amount } of holdings) {
      this.insertHolding.run(portfolioId, asset, amount);
    }
  }
}

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
