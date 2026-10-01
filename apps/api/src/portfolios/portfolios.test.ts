import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { openDatabase } from '../db/connection';
import { PortfolioRepository } from './repository';

function appWithDb(filename = ':memory:') {
  const db = openDatabase(filename);
  return { app: createApp({ portfolios: new PortfolioRepository(db) }), db };
}

const BRIEF_HOLDINGS = [
  { asset: 'BTC', amount: 0.5 },
  { asset: 'ETH', amount: 10 },
  { asset: 'USD', amount: 2500 },
  { asset: 'EUR', amount: 1000 },
];

describe('POST /portfolios', () => {
  it('creates a portfolio from the bare holdings array in the brief', async () => {
    const { app } = appWithDb();

    const res = await request(app).post('/portfolios').send(BRIEF_HOLDINGS);

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/portfolios/${res.body.id}`);
    expect(res.body.holdings).toEqual([
      { asset: 'BTC', amount: '0.5' },
      { asset: 'ETH', amount: '10' },
      { asset: 'USD', amount: '2500' },
      { asset: 'EUR', amount: '1000' },
    ]);
  });

  it('normalizes asset case and amount notation', async () => {
    const { app } = appWithDb();

    const res = await request(app)
      .post('/portfolios')
      .send({
        holdings: [
          { asset: ' btc ', amount: '007.50' },
          { asset: 'eth', amount: 1e-7 },
          { asset: 'CAD', amount: '0.123456789012345678901234567890' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.holdings).toEqual([
      { asset: 'BTC', amount: '7.5' },
      { asset: 'ETH', amount: '0.0000001' },
      { asset: 'CAD', amount: '0.12345678901234567890123456789' },
    ]);
  });

  it('rejects unsupported assets and non-positive amounts with field-level details', async () => {
    const { app } = appWithDb();

    const res = await request(app)
      .post('/portfolios')
      .send([
        { asset: 'FAKE', amount: 1 },
        { asset: 'BTC', amount: 0 },
        { asset: 'ETH', amount: '-1' },
      ]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      'holdings.0.asset',
      'holdings.1.amount',
      'holdings.2.amount',
    ]);
  });

  it('rejects duplicate assets after case normalization', async () => {
    const { app } = appWithDb();

    const res = await request(app)
      .post('/portfolios')
      .send([
        { asset: 'USD', amount: 5 },
        { asset: 'usd', amount: 6 },
      ]);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'holdings.1.asset', message: 'Duplicate asset USD' },
    ]);
  });

  it('rejects a missing body', async () => {
    const { app } = appWithDb();

    const res = await request(app).post('/portfolios');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /portfolios/:id', () => {
  it('returns 404 for an unknown portfolio', async () => {
    const { app } = appWithDb();

    const res = await request(app).get('/portfolios/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PORTFOLIO_NOT_FOUND');
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

  it('leaves existing holdings untouched when the new holdings are invalid', async () => {
    const { app } = appWithDb();
    const created = await request(app).post('/portfolios').send(BRIEF_HOLDINGS);

    const res = await request(app)
      .put(`/portfolios/${created.body.id}`)
      .send([{ asset: 'BTC', amount: -1 }]);
    const after = await request(app).get(`/portfolios/${created.body.id}`);

    expect(res.status).toBe(400);
    expect(after.body.holdings).toEqual(created.body.holdings);
  });

  it('returns 404 rather than creating an unknown portfolio', async () => {
    const { app } = appWithDb();

    const res = await request(app).put('/portfolios/does-not-exist').send(BRIEF_HOLDINGS);

    expect(res.status).toBe(404);
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
