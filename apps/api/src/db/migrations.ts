import type Database from 'better-sqlite3';

// Index N upgrades the schema from version N to N + 1; never edit a shipped entry, append a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE portfolios (
    id         TEXT    PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE holdings (
    portfolio_id TEXT NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
    asset        TEXT NOT NULL,
    amount       TEXT NOT NULL,
    PRIMARY KEY (portfolio_id, asset)
  ) STRICT;
  `,
  `
  CREATE INDEX idx_portfolios_updated_at ON portfolios (updated_at);
  `,
  `
  -- Last known good price per asset, so fallbacks and freshness survive a restart.
  CREATE TABLE price_cache (
    asset      TEXT    PRIMARY KEY,
    source     TEXT    NOT NULL CHECK (source IN ('coingecko', 'frankfurter')),
    price_cad  TEXT    NOT NULL,
    as_of      INTEGER NOT NULL, -- when the upstream says the price is from
    fetched_at INTEGER NOT NULL  -- when we last received it
  ) STRICT;
  `,
  `
  CREATE TABLE valuations (
    id           INTEGER PRIMARY KEY,
    portfolio_id TEXT    NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
    computed_at  INTEGER NOT NULL,
    total_cad    TEXT    NOT NULL,
    status       TEXT    NOT NULL CHECK (status IN ('complete', 'degraded')),
    fingerprint  TEXT    NOT NULL, -- hash of what determines the value; equal to the previous row means skip
    breakdown    TEXT    NOT NULL  -- per-holding JSON, to explain any point in the history
  ) STRICT;

  CREATE INDEX idx_valuations_portfolio_time ON valuations (portfolio_id, computed_at);
  `,
  `
  -- Retention deletes by age across all portfolios.
  CREATE INDEX idx_valuations_computed_at ON valuations (computed_at);
  `,
  `
  -- ADD COLUMN can't take NOT NULL without a default; the default only satisfies the CHECK for existing rows.
  ALTER TABLE portfolios ADD COLUMN name TEXT NOT NULL DEFAULT 'Untitled' CHECK (length(trim(name)) BETWEEN 1 AND 100);

  -- Existing portfolios become "Portfolio 1".."Portfolio N" in creation order.
  UPDATE portfolios SET name = 'Portfolio ' || (
    SELECT COUNT(*) FROM portfolios AS earlier
    WHERE earlier.created_at < portfolios.created_at
       OR (earlier.created_at = portfolios.created_at AND earlier.rowid <= portfolios.rowid)
  );
  `,
];

/** Applies pending migrations up to `target` (default: all). Tests use `target` to build an older schema. */
export function migrate(db: Database.Database, target = MIGRATIONS.length): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < target; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
