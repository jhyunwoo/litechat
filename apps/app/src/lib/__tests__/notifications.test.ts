/**
 * 알림 정책 테스트 — 보고 있는 대화방의 포그라운드 알림 억제
 */
import * as Notifications from 'expo-notifications';
import { setActiveConversation } from '@/data/active-conversation';
import '../notifications'; // 모듈 로드 시 setNotificationHandler가 등록된다

type Handler = (notification: {
  request: { content: { data: Record<string, unknown> } };
}) => Promise<{ shouldShowBanner: boolean; shouldPlaySound: boolean }>;

function getHandler(): Handler {
  const call = jest.mocked(Notifications.setNotificationHandler).mock.calls[0]![0]!;
  return call.handleNotification as unknown as Handler;
}

function notification(data: Record<string, unknown>) {
  return { request: { content: { data } } };
}

afterEach(() => {
  setActiveConversation(null);
});

describe('포그라운드 알림 정책', () => {
  test('보고 있는 대화방의 알림은 억제된다', async () => {
    setActiveConversation(7);
    const result = await getHandler()(notification({ c: 7 }));
    expect(result.shouldShowBanner).toBe(false);
    expect(result.shouldPlaySound).toBe(false);
  });

  test('다른 대화방의 알림은 표시된다', async () => {
    setActiveConversation(7);
    const result = await getHandler()(notification({ c: 8 }));
    expect(result.shouldShowBanner).toBe(true);
    expect(result.shouldPlaySound).toBe(true);
  });

  test('대화방을 보고 있지 않으면 모두 표시된다', async () => {
    setActiveConversation(null);
    const result = await getHandler()(notification({ c: 7 }));
    expect(result.shouldShowBanner).toBe(true);
  });

  test('c 데이터가 없는 알림도 표시된다', async () => {
    setActiveConversation(7);
    const result = await getHandler()(notification({}));
    expect(result.shouldShowBanner).toBe(true);
  });
});
