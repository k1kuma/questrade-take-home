import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
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

  it('requires a non-blank name in the { name, holdings } form', async () => {
    const { app } = appWithDb();

    const named = await request(app).post('/portfolios').send({ name: '  Retirement  ', holdings: BRIEF_HOLDINGS });
    const missing = await request(app).post('/portfolios').send({ holdings: BRIEF_HOLDINGS });
    const blank = await request(app).post('/portfolios').send({ name: '   ', holdings: [] });

    expect(named.status).toBe(201);
    expect(named.body.name).toBe('Retirement');
    for (const res of [missing, blank]) {
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].path).toBe('name');
    }
  });

  it('normalizes asset case and amount notation', async () => {
    const { app } = appWithDb();

    const res = await request(app)
      .post('/portfolios')
      .send({
        name: 'Normalization',
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

describe('GET /portfolios', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists portfolios most recently updated first, with their assets in order', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { app } = appWithDb();
    vi.setSystemTime(Date.parse('2026-10-01T10:00:00Z'));
    const first = await request(app).post('/portfolios').send([{ asset: 'BTC', amount: 1 }]);
    vi.setSystemTime(Date.parse('2026-10-01T11:00:00Z'));
    const second = await request(app).post('/portfolios').send([{ asset: 'USD', amount: 1 }]);
    vi.setSystemTime(Date.parse('2026-10-01T12:00:00Z'));
    await request(app)
      .put(`/portfolios/${first.body.id}`)
      .send([
        { asset: 'ETH', amount: 2 },
        { asset: 'BTC', amount: 1 },
      ]);

    const res = await request(app).get('/portfolios');

    expect(res.status).toBe(200);
    expect(res.body.portfolios).toEqual([
      {
        id: first.body.id,
        name: 'Portfolio 1',
        assets: ['ETH', 'BTC'],
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      },
      {
        id: second.body.id,
        name: 'Portfolio 2',
        assets: ['USD'],
        createdAt: '2026-10-01T11:00:00.000Z',
        updatedAt: '2026-10-01T11:00:00.000Z',
      },
    ]);
  });

  it('applies the limit and validates it', async () => {
    const { app } = appWithDb();
    for (let i = 0; i < 3; i++) {
      await request(app).post('/portfolios').send([{ asset: 'BTC', amount: i + 1 }]);
    }

    const limited = await request(app).get('/portfolios?limit=2');
    const invalid = await request(app).get('/portfolios?limit=500');

    expect(limited.body.portfolios).toHaveLength(2);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details[0].path).toBe('limit');
  });

  it('returns an empty list when there are no portfolios', async () => {
    const res = await request(appWithDb().app).get('/portfolios');

    expect(res.body).toEqual({ portfolios: [] });
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

  it('keeps the name for a bare-array body and renames with { name, holdings }', async () => {
    const { app } = appWithDb();
    const created = await request(app).post('/portfolios').send({ name: 'Original', holdings: [] });

    const kept = await request(app).put(`/portfolios/${created.body.id}`).send(BRIEF_HOLDINGS);
    const renamed = await request(app)
      .put(`/portfolios/${created.body.id}`)
      .send({ name: 'Renamed', holdings: BRIEF_HOLDINGS });
    const blank = await request(app).put(`/portfolios/${created.body.id}`).send({ name: '', holdings: [] });

    expect(kept.body.name).toBe('Original');
    expect(renamed.body.name).toBe('Renamed');
    expect(blank.status).toBe(400);
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
