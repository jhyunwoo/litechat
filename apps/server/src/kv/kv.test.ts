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

  test('increment는 고정 시간창 카운터와 남은 TTL을 유지한다', async () => {
    let now = 0;
    const kv = new MemoryKV(() => now);
    expect(await kv.increment('rate', 10)).toEqual({ count: 1, retryAfter: 10 });
    now = 5_000;
    expect(await kv.increment('rate', 10)).toEqual({ count: 2, retryAfter: 5 });
    now = 10_001;
    expect(await kv.increment('rate', 10)).toEqual({ count: 1, retryAfter: 10 });
  });

  test('getSessionAndRate는 세션 조회와 카운터 증가를 한 번에 처리한다', async () => {
    let now = 0;
    const kv = new MemoryKV(() => now);
    await kv.set('sess:tok', '7', 100);

    // 세션이 있으면 값 + 증가된 카운트를 돌려준다
    expect(await kv.getSessionAndRate('sess:tok', 100, 'rate:user:', 60)).toEqual({
      value: '7',
      count: 1,
      retryAfter: 60,
    });
    expect(await kv.getSessionAndRate('sess:tok', 100, 'rate:user:', 60)).toEqual({
      value: '7',
      count: 2,
      retryAfter: 60,
    });

    // 세션이 없으면 카운터를 만들지 않는다
    expect(await kv.getSessionAndRate('sess:gone', 100, 'rate:user:', 60)).toEqual({
      value: null,
      count: 0,
      retryAfter: 0,
    });
    expect(await kv.get('rate:user:gone-user')).toBeNull();

    // 슬라이딩: 조회가 세션 만료를 미룬다
    now = 99_000;
    expect((await kv.getSessionAndRate('sess:tok', 100, 'rate:user:', 60)).value).toBe('7');
    now = 101_000;
    expect(await kv.get('sess:tok')).toBe('7');
  });

  test('deleteByValue는 지정 접두사의 일치 세션만 삭제한다', async () => {
    const kv = new MemoryKV();
    await kv.set('sess:a', '1');
    await kv.set('sess:b', '2');
    await kv.set('other:c', '1');
    expect(await kv.deleteByValue('sess:', '1')).toBe(1);
    expect(await kv.get('sess:a')).toBeNull();
    expect(await kv.get('sess:b')).toBe('2');
    expect(await kv.get('other:c')).toBe('1');
  });
});
