/**
 * 의존성 컨테이너 (Dependency Container)
 *
 * 서버 전역에서 공유되는 리소스(설정, DB, KV)를 하나의 객체로 묶는다.
 * 모든 모듈은 이 컨테이너를 주입받아 동작하므로,
 * 테스트에서는 인메모리 구현으로 통째로 교체할 수 있다.
 */
import type { Database } from 'bun:sqlite';
import { createConfig, type AppConfig } from './config';
import { openDatabase } from './db/database';
import { MemoryKV, type KVStore } from './kv/kv';
import { RedisKV } from './kv/redis-kv';
import { WatchWaiters } from './modules/watch/waiters';
import { WsHub } from './ws/hub';

export interface AppDeps {
  config: AppConfig;
  db: Database;
  kv: KVStore;
  /** 실시간 팬아웃용 WebSocket 허브 */
  hub: WsHub;
  watchWaiters: WatchWaiters;
}

/** 프로덕션 의존성 생성 — 파일 DB + 실제 Redis */
export function createDeps(config: AppConfig = createConfig()): AppDeps {
  return {
    config,
    db: openDatabase(config.dbPath),
    // REDIS_URL=memory 는 Redis 없이 띄우는 개발/e2e용 특수값 (단일 프로세스 한정)
    kv: config.redisUrl === 'memory' ? new MemoryKV() : new RedisKV(config.redisUrl),
    hub: new WsHub(),
    watchWaiters: new WatchWaiters(),
  };
}

/** 테스트 의존성 생성 — 인메모리 DB + 인메모리 KV */
export function createTestDeps(overrides: Partial<AppConfig> = {}): AppDeps {
  const config = createConfig({
    dbPath: ':memory:',
    uploadDir: `/tmp/litechat-test-uploads-${crypto.randomUUID()}`,
    cookieDomain: '',
    isProduction: false,
    // 테스트가 빨리 돌도록 해시 비용을 최소화한다 (프로덕션 기본값은 config.ts 참고).
    passwordMemoryCost: 4096,
    passwordTimeCost: 2,
    ...overrides,
  });
  return {
    config,
    db: openDatabase(config.dbPath),
    kv: new MemoryKV(),
    hub: new WsHub(),
    watchWaiters: new WatchWaiters(),
  };
}
