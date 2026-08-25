import { describe, expect, test } from 'bun:test';
import { parseClientFrame } from '@litechat/types';
import { createApp } from './app';
import { createTestDeps } from './deps';

describe('release security controls', () => {
  test('login is rate-limited with Retry-After', async () => {
    const app = createApp(createTestDeps());
    let response!: Response;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      response = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'nobody', password: 'password123' }),
      });
    }
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('client WebSocket frames are strict and size bounded', () => {
    expect(parseClientFrame('{"t":"p"}')).toEqual({ t: 'p' });
    expect(parseClientFrame('{"t":"p","extra":true}')).toBeNull();
    expect(parseClientFrame('{"t":"m","c":"1","k":"t","x":"hi","i":"tmp"}')).toBeNull();
    expect(
      parseClientFrame(JSON.stringify({ t: 'm', c: 1, k: 't', x: 'a'.repeat(9000), i: 'tmp' })),
    ).toBeNull();
  });
});
