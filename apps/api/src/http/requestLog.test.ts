import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../testApp';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestLog', () => {
  it('logs one line per request with method, URL, status and duration', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await request(createTestApp().app).get('/portfolios?limit=5');

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toMatch(/^\[http\] GET \/portfolios\?limit=5 200 \d+ms$/);
  });
});
