import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Asset, Holding, Portfolio } from '@portfolio/contracts';

type PortfolioRow = { id: string; created_at: number; updated_at: number };
type HoldingRow = { asset: string; amount: string };

export class PortfolioRepository {
  private readonly insertPortfolio;
  private readonly touchPortfolio;
  private readonly selectPortfolio;
  private readonly insertHolding;
  private readonly deleteHoldings;
  private readonly selectHoldings;

  constructor(private readonly db: Database.Database) {
    this.insertPortfolio = db.prepare<[string, number, number]>(
      'INSERT INTO portfolios (id, created_at, updated_at) VALUES (?, ?, ?)',
    );
    this.touchPortfolio = db.prepare<[number, string]>(
      'UPDATE portfolios SET updated_at = ? WHERE id = ?',
    );
    this.selectPortfolio = db.prepare<[string], PortfolioRow>(
      'SELECT id, created_at, updated_at FROM portfolios WHERE id = ?',
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

  create(holdings: Holding[]): Portfolio {
    const id = randomUUID();
    const now = Date.now();
    this.db.transaction(() => {
      this.insertPortfolio.run(id, now, now);
      this.insertHoldings(id, holdings);
    })();
    return { id, holdings, createdAt: toIso(now), updatedAt: toIso(now) };
  }

  findById(id: string): Portfolio | undefined {
    const row = this.selectPortfolio.get(id);
    if (!row) return undefined;
    const holdings = this.selectHoldings
      .all(id)
      .map((h) => ({ asset: h.asset as Asset, amount: h.amount }));
    return {
      id: row.id,
      holdings,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  replaceHoldings(id: string, holdings: Holding[]): Portfolio | undefined {
    return this.db.transaction(() => {
      if (this.touchPortfolio.run(Date.now(), id).changes === 0) return undefined;
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
