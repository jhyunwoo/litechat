import { expect, test } from 'bun:test';
import { createServer, connect, type ServerHttp2Stream } from 'node:http2';
import { generateKeyPairSync, verify } from 'node:crypto';
import { APNsProvider } from './apns';
import { createConfig } from '../../config';
test('provider sends HTTP/2 APNs headers and valid ES256 JWT and parses rejection', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const server = createServer();
  const headers: any[] = [];
  const bodies: string[] = [];
  server.on('stream', (rawStream, h) => {
    const stream = rawStream as ServerHttp2Stream;
    headers.push(h);
    let body = '';
    stream.on('data', (c) => (body += c.toString()));
    stream.on('end', () => {
      bodies.push(body);
      stream.respond({ ':status': 410 });
      stream.end(JSON.stringify({ reason: 'Unregistered', timestamp: 1234 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const provider = new APNsProvider(
    createConfig({
      watchAPNsTeamId: 'TESTTEAM00',
      watchAPNsSandbox: {
        keyId: 'TESTKEY000',
        privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      },
    }),
    () => connect(`http://127.0.0.1:${address.port}`),
  );
  try {
    const p = {
      token: 'abcd',
      environment: 'sandbox' as const,
      requestId: crypto.randomUUID(),
      expiration: 12345,
      payload: {
        aps: {
          alert: { title: 'Alice', body: 'Hello' },
          sound: 'default',
          category: 'LITECHAT_MESSAGE',
          'thread-id': 'conversation-2',
        },
        c: 2,
        m: 5,
      },
    };
    expect(await provider.send(p)).toEqual({
      status: 410,
      reason: 'Unregistered',
      timestamp: 1234,
    });
    await provider.send(p);
    expect(headers[0][':path']).toBe('/3/device/abcd');
    expect(headers[0]['apns-topic']).toBe('kr.moveto.litechat.watch');
    expect(headers[0]['apns-push-type']).toBe('alert');
    expect(headers[0]['apns-priority']).toBe('10');
    expect(headers[0]['apns-collapse-id']).toBe('message-5');
    expect(JSON.parse(bodies[0]!)).toEqual(p.payload);
    expect(headers[0].authorization).toBe(headers[1].authorization);
    const jwt = headers[0].authorization.slice(7).split('.');
    expect(JSON.parse(Buffer.from(jwt[0], 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: 'TESTKEY000',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(jwt[0] + '.' + jwt[1]),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(jwt[2], 'base64url'),
      ),
    ).toBe(true);
  } finally {
    provider.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
