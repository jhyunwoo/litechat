/**
 * KV 저장소 추상화
 *
 * 세션 등 휘발성 데이터는 Redis에 저장하지만, 단위 테스트에서는
 * 실제 Redis 없이 돌 수 있도록 최소 인터페이스 뒤에 숨긴다.
 * 프로덕션: RedisKV (redis-kv.ts) / 테스트: MemoryKV (아래)
 */

export interface KVStore {
  /** 키 조회 — 없거나 만료되었으면 null */
  get(key: string): Promise<string | null>;
  /** 키 저장 — ttlSeconds를 주면 해당 시간 후 만료 */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** 키 삭제 */
  del(key: string): Promise<void>;
  /** 만료 시간 갱신 (슬라이딩 세션용) */
  expire(key: string, ttlSeconds: number): Promise<void>;
  /** 연결 종료 (테스트 정리/서버 셧다운용) */
  close(): Promise<void>;
}

/** 테스트용 인메모리 KV — 만료 시각을 함께 저장해 TTL 의미론을 재현한다. */
export class MemoryKV implements KVStore {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  /** 테스트에서 시간을 임의로 흘리기 위한 현재 시각 함수 (기본: Date.now) */
  constructor(private now: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? this.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = this.now() + ttlSeconds * 1000;
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
