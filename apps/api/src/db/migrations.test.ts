import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from './migrations';

describe('migrations', () => {
  it('names existing portfolios "Portfolio N" in creation order when adding the name column', () => {
    const db = new Database(':memory:');
    migrate(db, 5);
    const insert = db.prepare('INSERT INTO portfolios (id, created_at, updated_at) VALUES (?, ?, ?)');
    insert.run('newest', 3000, 3000);
    insert.run('oldest', 1000, 9000);
    insert.run('middle', 2000, 2000);

    migrate(db);

    const names = db.prepare('SELECT id, name FROM portfolios ORDER BY created_at').all();
    expect(names).toEqual([
      { id: 'oldest', name: 'Portfolio 1' },
      { id: 'middle', name: 'Portfolio 2' },
      { id: 'newest', name: 'Portfolio 3' },
    ]);
    expect(() => db.prepare("UPDATE portfolios SET name = '  ' WHERE id = 'oldest'").run()).toThrow(/CHECK/);
  });
});
