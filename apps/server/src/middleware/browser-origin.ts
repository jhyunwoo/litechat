import type { MiddlewareHandler } from 'hono';
import type { AppDeps } from '../deps';

/** SameSite cookies also accompany requests from unrelated sibling subdomains. */
export function browserOrigin(deps: AppDeps): MiddlewareHandler {
  return async (c, next) => {
    const websocket = c.req.path === '/ws';
    if (!websocket && ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    const origin = c.req.header('Origin');
    const request = new URL(c.req.url);
    const expected = `${deps.config.isProduction ? 'https:' : request.protocol}//${request.host}`;
    if (
      (origin && origin !== expected) ||
      ['cross-site', 'same-site'].includes(c.req.header('Sec-Fetch-Site') ?? '') ||
      (websocket && !origin && !c.req.header('Authorization'))
    ) {
      return c.json({ error: 'FORBIDDEN_ORIGIN' }, 403);
    }
    return next();
  };
}
