import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './testApp';

function testApp() {
  return createTestApp().app;
}

describe('app', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(testApp()).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /nope not found' },
    });
  });

  it('returns a JSON 400 for malformed JSON bodies', async () => {
    const res = await request(testApp())
      .post('/portfolios')
      .set('Content-Type', 'application/json')
      .send('{"holdings": [');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
