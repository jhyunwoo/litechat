/**
 * MemoryKV 단위 테스트 — TTL 의미론이 Redis와 동일하게 동작해야
 * 테스트 환경과 프로덕션 환경의 세션 동작이 일치한다.
 */
import { describe, expect, test } from 'bun:test';
import { MemoryKV } from './kv';

describe('MemoryKV', () => {
  test('저장한 값을 조회할 수 있다', async () => {
    const kv = new MemoryKV();
    await kv.set('k', 'v');
    expect(await kv.get('k')).toBe('v');
  });

  test('없는 키는 null을 반환한다', async () => {
    const kv = new MemoryKV();
    expect(await kv.get('missing')).toBeNull();
  });

  test('TTL이 지나면 만료된다', async () => {
    let now = 0;
    const kv = new MemoryKV(() => now);
    await kv.set('k', 'v', 10);
    now = 9_999;
    expect(await kv.get('k')).toBe('v');
    now = 10_001;
    expect(await kv.get('k')).toBeNull();
  });

  test('expire로 만료 시간을 연장할 수 있다 (슬라이딩 세션)', async () => {
    let now = 0;
    const kv = new MemoryKV(() => now);
    await kv.set('k', 'v', 10);
    now = 9_000;
    await kv.expire('k', 10);
    now = 15_000;
    expect(await kv.get('k')).toBe('v');
  });

  test('del로 키를 삭제할 수 있다', async () => {
    const kv = new MemoryKV();
    await kv.set('k', 'v');
    await kv.del('k');
    expect(await kv.get('k')).toBeNull();
  });
});
