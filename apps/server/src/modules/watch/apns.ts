import { connect, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import type { AppConfig } from '../../config';

export interface WatchPush {
  token: string;
  environment: 'sandbox' | 'production';
  requestId: string;
  expiration: number;
  payload: {
    aps: {
      alert: { title: string; body: string };
      sound: string;
      category: string;
      'thread-id': string;
    };
    c: number;
    m: number;
  };
}
export interface APNsResult {
  status: number;
  reason?: string;
  timestamp?: number;
}
export type WatchPushSender = (push: WatchPush) => Promise<APNsResult>;

/** APNs needs HTTP/2, not fetch's unspecified negotiated protocol. No raw credentials in errors. */
export class APNsProvider {
  private connections = new Map<string, ClientHttp2Session>();
  private tokens = new Map<string, { value: string; issued: number }>();
  private keys = new Map<string, KeyObject>();
  constructor(
    private config: AppConfig,
    private connectionFactory = (environment: WatchPush['environment']) =>
      connect(
        environment === 'sandbox'
          ? 'https://api.sandbox.push.apple.com'
          : 'https://api.push.apple.com',
      ),
  ) {}
  private jwt(environment: WatchPush['environment']) {
    const credentials =
      environment === 'sandbox' ? this.config.watchAPNsSandbox : this.config.watchAPNsProduction;
    if (!credentials.keyId || !credentials.privateKey || !this.config.watchAPNsTeamId)
      throw new Error('APNS_NOT_CONFIGURED');
    const now = Math.floor(Date.now() / 1000);
    const cached = this.tokens.get(environment);
    if (cached && now - cached.issued < 50 * 60) return cached.value;
    let key = this.keys.get(environment);
    if (!key) {
      key = createPrivateKey(credentials.privateKey.replace(/\\n/g, '\n'));
      this.keys.set(environment, key);
    }
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'ES256', kid: credentials.keyId })}.${encode({ iss: this.config.watchAPNsTeamId, iat: now })}`;
    const value = `${input}.${sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    this.tokens.set(environment, { value, issued: now });
    return value;
  }
  send: WatchPushSender = async (push) => {
    const authorization = `bearer ${this.jwt(push.environment)}`;
    let connection = this.connections.get(push.environment);
    if (!connection || connection.destroyed || connection.closed) {
      connection = this.connectionFactory(push.environment);
      connection.on('error', () => {}); // Each pending stream reports failure without logging tokens.
      connection.on('goaway', () => {
        connection?.close();
      });
      this.connections.set(push.environment, connection);
    }
    const body = JSON.stringify(push.payload);
    if (Buffer.byteLength(body) > 4096) throw new Error('APNS_PAYLOAD_TOO_LARGE');
    return new Promise<APNsResult>((resolve, reject) => {
      const stream = connection!.request({
        ':method': 'POST',
        ':path': `/3/device/${push.token}`,
        authorization,
        'apns-topic': this.config.watchAPNsTopic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-id': push.requestId,
        'apns-expiration': String(push.expiration),
        'apns-collapse-id': `message-${push.payload.m}`,
        'content-type': 'application/json',
      });
      let status = 0;
      let response = '';
      let finished = false;
      const done = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (error) {
          stream.close();
          reject(new Error('APNS_TRANSPORT_ERROR'));
          return;
        }
        try {
          resolve({ ...JSON.parse(response || '{}'), status });
        } catch {
          reject(new Error('APNS_INVALID_RESPONSE'));
        }
      };
      const timeout = setTimeout(() => done(new Error('timeout')), 10_000);
      stream.on('response', (headers) => {
        status = Number(headers[':status']);
      });
      stream.on('data', (chunk) => {
        response += chunk.toString();
        if (response.length > 8192) done(new Error('size'));
      });
      stream.on('error', () => done(new Error('transport')));
      stream.on('end', () => done());
      stream.on('close', () => {
        if (!finished) done(new Error('closed'));
      });
      stream.end(body);
    });
  };
  close() {
    for (const c of this.connections.values()) c.destroy();
    this.connections.clear();
  }
}
