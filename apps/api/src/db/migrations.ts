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
];

export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
