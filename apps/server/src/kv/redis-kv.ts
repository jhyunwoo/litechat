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

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
