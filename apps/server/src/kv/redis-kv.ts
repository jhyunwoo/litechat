/**
 * Redis 기반 KVStore 구현 (프로덕션용)
 *
 * ioredis 클라이언트를 얇게 감싼다. 세션처럼 만료가 있는 데이터를
 * 매우 빠르게 조회하기 위해 사용한다 (매 요청마다 세션 조회가 발생).
 */
import { Redis } from 'ioredis';
import type { KVStore } from './kv';

export class RedisKV implements KVStore {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      // 서버 시작 시 Redis가 아직 준비되지 않았어도 재시도하며 버틴다.
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  /**
   * GETEX — 조회와 TTL 갱신을 왕복 1회로 처리한다 (Redis 6.2+, 운영은 redis:7-alpine).
   * 인증된 모든 요청이 지나는 경로라 왕복 2회 → 1회가 그대로 요청당 지연으로 돌아온다.
   */
  async getAndRefresh(key: string, ttlSeconds: number): Promise<string | null> {
    return this.redis.getex(key, 'EX', ttlSeconds);
  }

  async increment(key: string, ttlSeconds: number): Promise<{ count: number; retryAfter: number }> {
    const result = (await this.redis.eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return {count, redis.call('TTL', KEYS[1])}`,
      1,
      key,
      ttlSeconds,
    )) as [number, number];
    return { count: Number(result[0]), retryAfter: Math.max(1, Number(result[1])) };
  }

  async deleteByValue(prefix: string, value: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.redis.mget(keys);
      const matches = keys.filter((_key, index) => values[index] === value);
      if (matches.length > 0) deleted += await this.redis.del(...matches);
    } while (cursor !== '0');
    return deleted;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
