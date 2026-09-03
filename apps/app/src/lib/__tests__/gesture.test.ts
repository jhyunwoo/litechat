/**
 * 답장 스와이프 판정 테스트 — 방향 제한, 임계값, 세로 스크롤 회피
 */
import { REPLY_SWIPE_MAX, REPLY_SWIPE_THRESHOLD, replySwipe } from '../gesture';

describe('replySwipe', () => {
  test('상대 메시지는 왼쪽→오른쪽으로 끌리면 답장이 된다', () => {
    expect(replySwipe(60, 0, false)).toEqual({ offset: 60, ready: true });
  });

  test('내 메시지는 오른쪽→왼쪽으로 끌리면 답장이 된다', () => {
    expect(replySwipe(-60, 0, true)).toEqual({ offset: -60, ready: true });
  });

  test('상대 메시지를 왼쪽으로 끌면 반응하지 않는다', () => {
    expect(replySwipe(-60, 0, false)).toEqual({ offset: 0, ready: false });
  });

  test('내 메시지를 오른쪽으로 끌면 반응하지 않는다', () => {
    expect(replySwipe(60, 0, true)).toEqual({ offset: 0, ready: false });
  });

  test('임계값 미만이면 따라오기만 하고 답장은 아니다', () => {
    const { offset, ready } = replySwipe(REPLY_SWIPE_THRESHOLD - 1, 0, false);
    expect(offset).toBe(REPLY_SWIPE_THRESHOLD - 1);
    expect(ready).toBe(false);
  });

  test('세로 이동이 크면 스크롤로 보고 무시한다', () => {
    expect(replySwipe(60, 50, false)).toEqual({ offset: 0, ready: false });
  });

  test('최대 끌림을 넘지 않는다', () => {
    expect(replySwipe(500, 0, false)).toEqual({ offset: REPLY_SWIPE_MAX, ready: true });
  });
});
