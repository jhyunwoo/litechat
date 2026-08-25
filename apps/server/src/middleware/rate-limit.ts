import type { MiddlewareHandler } from 'hono';
import type { AppDeps } from '../deps';

function clientAddress(headers: Headers): string {
  const cloudflare = headers.get('cf-connecting-ip')?.trim();
  if (cloudflare) return cloudflare;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',').at(-1)?.trim() || 'unknown';
  return 'unknown';
}

/** Redis-backed fixed-window limiter. Production instances share the same budget. */
export function rateLimit(
  deps: AppDeps,
  options: { name: string; limit: number; windowSeconds: number },
): MiddlewareHandler {
  return async (c, next) => {
    const address = clientAddress(c.req.raw.headers);
    const key = `rate:${options.name}:${address}`;
    const { count, retryAfter } = await deps.kv.increment(key, options.windowSeconds);
    c.header('X-RateLimit-Limit', String(options.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, options.limit - count)));
    if (count > options.limit) {
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'RATE_LIMITED' }, 429);
    }
    await next();
  };
}
