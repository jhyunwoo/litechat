/**
 * 알림 수신 ACK 테스트 — data.n을 서버에 되돌려 보내는지 확인
 */
import { renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { useNotificationReceivedAck } from '../notifications';

function received(data: Record<string, unknown>) {
  return { request: { content: { data } } } as unknown as Notifications.Notification;
}

/** 마지막으로 등록된 수신 리스너를 꺼낸다 */
function lastListener(): (n: Notifications.Notification) => void {
  const { calls } = jest.mocked(Notifications.addNotificationReceivedListener).mock;
  return calls[calls.length - 1]![0] as (n: Notifications.Notification) => void;
}

/**
 * hono client의 `$post`는 async 함수이고 `await opt.headers()`를 거친 뒤에야 실제
 * fetch를 호출한다 — 리스너 콜백은 그 호출을 fire-and-forget(`void ...catch`)하므로,
 * 동기 단언 전에 마이크로태스크 큐를 한 번 비워줘야 fetch 호출이 반영된다.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  // `typeof fetch`는 최신 dom lib에서 정적 `preconnect` 속성을 요구하므로 mock은
  // 구조적으로 캐스팅한다(런타임 동작에는 영향 없음).
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }) as unknown as typeof fetch;
});

describe('useNotificationReceivedAck', () => {
  // NOTE: @testing-library/react-native@14의 renderHook/unmount는 async 함수다
  // (내부적으로 test-renderer의 act()를 await한다) — await 없이 호출하면 useEffect가
  // 아직 커밋되지 않은 상태로 단언이 실행돼 항상 실패한다. 브리프의 세 단언은 그대로 두고
  // 렌더/언마운트 호출에만 await를 추가한다.
  test('data.n이 있으면 /api/push/ack로 ACK를 보낸다', async () => {
    await renderHook(() => useNotificationReceivedAck());
    lastListener()(received({ c: 5, n: 42 }));
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = jest.mocked(global.fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/push/ack');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ n: 42 });
  });

  test('data.n이 없으면 ACK를 보내지 않는다', async () => {
    await renderHook(() => useNotificationReceivedAck());
    lastListener()(received({ c: 5 }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('언마운트 시 리스너를 해제한다', async () => {
    const { unmount } = await renderHook(() => useNotificationReceivedAck());
    const subscription = jest.mocked(Notifications.addNotificationReceivedListener).mock.results[0]!
      .value as { remove: jest.Mock };
    await unmount();
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });
});
