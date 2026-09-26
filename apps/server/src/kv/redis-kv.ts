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

  /**
   * GETEX + INCR을 하나의 Lua 스크립트로 묶어 왕복 1회로 끝낸다.
   * 세션 값이 레이트 키(`rate:user:<userId>`)의 일부라 명령 두 개로 나눌 수 없다 —
   * 스크립트 안에서 읽은 값으로 두 번째 키를 만든다.
   */
  async getSessionAndRate(
    key: string,
    ttlSeconds: number,
    rateKeyPrefix: string,
    rateTtlSeconds: number,
  ): Promise<{ value: string | null; count: number; retryAfter: number }> {
    const [value, count, ttl] = (await this.redis.eval(
      `local value = redis.call('GETEX', KEYS[1], 'EX', ARGV[1])
       if not value then return {0, 0, 0} end
       local rate_key = KEYS[2] .. value
       local count = redis.call('INCR', rate_key)
       if count == 1 then redis.call('EXPIRE', rate_key, ARGV[2]) end
       return {value, count, redis.call('TTL', rate_key)}`,
      2,
      key,
      rateKeyPrefix,
      ttlSeconds,
      rateTtlSeconds,
    )) as [string | number, number, number];
    // Lua false는 반환 배열을 자르므로 세션 없음을 0으로 표시한다 (userId는 양수라 겹치지 않음)
    return {
      value: typeof value === 'string' ? value : null,
      count: Number(count),
      retryAfter: Math.max(1, Number(ttl)),
    };
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
