import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/connection';
import { createTestApp } from '../testApp';

function appWithDb(filename = ':memory:') {
  return createTestApp({ db: openDatabase(filename) });
}

const BRIEF_HOLDINGS = [
  { asset: 'BTC', amount: 0.5 },
  { asset: 'ETH', amount: 10 },
  { asset: 'USD', amount: 2500 },
  { asset: 'EUR', amount: 1000 },
];

describe('POST /portfolios', () => {
  it('creates a portfolio from the bare holdings array in the brief, auto-named', async () => {
    const { app } = appWithDb();

    const res = await request(app).post('/portfolios').send(BRIEF_HOLDINGS);
    const second = await request(app).post('/portfolios').send([]);

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/portfolios/${res.body.id}`);
    expect(res.body.name).toBe('Portfolio 1');
    expect(second.body.name).toBe('Portfolio 2');
    expect(res.body.holdings).toEqual([
      { asset: 'BTC', amount: '0.5' },
      { asset: 'ETH', amount: '10' },
      { asset: 'USD', amount: '2500' },
      { asset: 'EUR', amount: '1000' },
    ]);
  });
});

describe('PUT /portfolios/:id', () => {
  it('replaces all holdings and bumps updatedAt', async () => {
    const { app } = appWithDb();
    const created = await request(app).post('/portfolios').send(BRIEF_HOLDINGS);

    const res = await request(app)
      .put(`/portfolios/${created.body.id}`)
      .send([
        { asset: 'SOL', amount: 3 },
        { asset: 'BTC', amount: 1 },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.holdings).toEqual([
      { asset: 'SOL', amount: '3' },
      { asset: 'BTC', amount: '1' },
    ]);
    expect(res.body.createdAt).toBe(created.body.createdAt);
    expect(Date.parse(res.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.body.updatedAt));
  });
});

describe('persistence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-test-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps portfolios across a restart', async () => {
    const filename = path.join(dir, 'portfolio.db');
    const first = appWithDb(filename);
    const created = await request(first.app).post('/portfolios').send(BRIEF_HOLDINGS);
    first.db.close();

    const second = appWithDb(filename);
    const res = await request(second.app).get(`/portfolios/${created.body.id}`);
    second.db.close();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);
  });
});
