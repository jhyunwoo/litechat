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
  /**
   * 조회와 동시에 만료를 연장한다 (슬라이딩 세션 조회 전용).
   *
   * 인증이 필요한 **모든 요청**이 세션을 조회하고 만료를 미룬다. get+expire를 따로
   * 부르면 요청마다 Redis 왕복이 2회 발생하는데, GETEX 한 번이면 원자적으로 끝난다.
   */
  getAndRefresh(key: string, ttlSeconds: number): Promise<string | null>;
  /** 고정 시간창 카운터를 원자적으로 증가시키고 현재 값/남은 TTL을 반환 */
  increment(key: string, ttlSeconds: number): Promise<{ count: number; retryAfter: number }>;
  /**
   * 세션 조회(+슬라이딩 연장)와 레이트 카운터 증가를 왕복 1회로 묶는다.
   * 레이트 키는 `rateKeyPrefix + <세션 값>` — 세션 값을 읽기 전에는 키를 알 수 없으므로
   * 접두사만 받아 구현 쪽에서 이어 붙인다.
   * 인증 미들웨어와 WS 프레임 경로(서버에서 가장 뜨거운 경로) 전용 — 세션과 레이트를
   * 따로 조회하면 요청/프레임마다 Redis 왕복이 2번 발생한다.
   * 세션이 없으면 카운터는 건드리지 않고 value=null로 반환한다.
   */
  getSessionAndRate(
    key: string,
    ttlSeconds: number,
    rateKeyPrefix: string,
    rateTtlSeconds: number,
  ): Promise<{ value: string | null; count: number; retryAfter: number }>;
  /** 접두사 아래에서 값이 일치하는 키를 모두 삭제 (계정 전체 세션 파기용) */
  deleteByValue(prefix: string, value: string): Promise<number>;
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

  async getAndRefresh(key: string, ttlSeconds: number): Promise<string | null> {
    const value = await this.get(key);
    if (value !== null) await this.expire(key, ttlSeconds);
    return value;
  }

  async increment(key: string, ttlSeconds: number): Promise<{ count: number; retryAfter: number }> {
    const current = Number((await this.get(key)) ?? 0) + 1;
    const existing = this.store.get(key);
    const expiresAt = existing?.expiresAt ?? this.now() + ttlSeconds * 1000;
    this.store.set(key, { value: String(current), expiresAt });
    return { count: current, retryAfter: Math.max(1, Math.ceil((expiresAt - this.now()) / 1000)) };
  }

  async getSessionAndRate(
    key: string,
    ttlSeconds: number,
    rateKeyPrefix: string,
    rateTtlSeconds: number,
  ): Promise<{ value: string | null; count: number; retryAfter: number }> {
    const value = await this.getAndRefresh(key, ttlSeconds);
    if (value === null) return { value: null, count: 0, retryAfter: 0 };
    const { count, retryAfter } = await this.increment(rateKeyPrefix + value, rateTtlSeconds);
    return { value, count, retryAfter };
  }

  async deleteByValue(prefix: string, value: string): Promise<number> {
    let deleted = 0;
    for (const [key, entry] of this.store) {
      if (key.startsWith(prefix) && (await this.get(key)) === value && entry) {
        this.store.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
