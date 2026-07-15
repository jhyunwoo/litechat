/**
 * 푸시 알림 — Expo Push 토큰 등록/해지, 포그라운드 억제, 딥링크, 배지
 *
 * 서버는 상대가 오프라인일 때 { title, body, data: { c }, badge }로 발송한다
 * (apps/server/src/modules/push/expo-service.ts).
 */
import type { ConversationSummary } from '@litechat/types';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef } from 'react';
import { getActiveConversation } from '@/data/active-conversation';
import { api, unwrap } from './api';

/** 이 기기에서 등록한 토큰을 기억해 로그아웃/토글 오프 시 해지한다 */
const TOKEN_KEY = 'lc_expo_push_token';

/**
 * 포그라운드 알림 정책 — 지금 보고 있는 대화방의 알림은 억제한다.
 * (해당 메시지는 WS로 이미 화면에 떠 있다)
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const conversationId = notification.request.content.data?.c;
    const suppress =
      typeof conversationId === 'number' && conversationId === getActiveConversation();
    return {
      shouldShowBanner: !suppress,
      shouldShowList: !suppress,
      shouldPlaySound: !suppress,
      shouldSetBadge: true,
    };
  },
});

/**
 * 푸시 알림 켜기 — 권한 요청 → Expo 토큰 발급 → 서버 등록.
 * 성공하면 true, 권한 거부/시뮬레이터면 false.
 */
export async function registerForPush(): Promise<boolean> {
  if (!Device.isDevice) return false; // 시뮬레이터는 푸시 토큰이 없다

  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );

  const res = await api.api.push.expo.register.$post({ json: { token } });
  await unwrap(res);
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  return true;
}

/** 푸시 알림 끄기 — 서버에서 이 기기의 토큰을 해지한다 */
export async function unregisterPush(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  const res = await api.api.push.expo.unregister.$post({ json: { token } });
  await unwrap(res);
}

/** 이 기기에서 푸시를 켠 상태인지 (프로필 토글 초기값) */
export async function isPushEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(TOKEN_KEY)) !== null;
}

/**
 * 알림 탭 → 대화방 딥링크. 루트 레이아웃에서 한 번 마운트한다.
 * 콜드 스타트(종료 상태에서 알림 탭으로 실행)도 처리한다.
 *
 * @param ready 내비게이터(Stack)가 마운트된 뒤에만 true — 그 전의 push는 유실된다.
 */
export function useNotificationDeepLink(ready: boolean): void {
  // iOS는 리스너가 붙기 전에 도착한 알림 응답을 리스너가 붙는 순간 다시 쏜다
  // (expo/expo#34850). getLastNotificationResponse와 리스너가 같은 응답을 두 번
  // 전달하면 같은 방이 두 번 push되고, 그 리마운트가 막 입력을 시작한 컴포저
  // (키보드·초안)를 날린다 → 알림 ID로 응답당 한 번만 연다.
  const handledId = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;

    function open(notification: Notifications.Notification) {
      if (notification.request.identifier === handledId.current) return;
      handledId.current = notification.request.identifier;
      const conversationId = notification.request.content.data?.c;
      if (typeof conversationId === 'number') {
        router.push(`/chat/${conversationId}`);
      }
    }

    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) open(last.notification);

    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      open(response.notification),
    );
    return () => subscription.remove();
  }, [ready]);
}

/**
 * 알림 수신 ACK — 알림이 실제로 도착했을 때(포그라운드/백그라운드, 프로세스가 살아있는
 * 동안) 서버에 수신 시각을 기록한다. 루트 레이아웃에서 한 번 마운트한다.
 *
 * 한계: 앱이 완전히 종료된 상태로 도착한 알림은 이 리스너가 붙어 있지 않아 ACK가
 * 오지 않는다 — 딥링크(useNotificationDeepLink)와 달리 콜드 스타트 시점의 재발화가
 * 없다(expo-notifications가 "받았다"는 과거 이벤트를 다시 쏴주지 않는다).
 */
export function useNotificationReceivedAck(): void {
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const logId = notification.request.content.data?.n;
      if (typeof logId !== 'number') return;
      void (async () => {
        try {
          await unwrap(await api.api.push.ack.$post({ json: { n: logId } }));
        } catch {
          /* ACK 실패는 무시 — 다음 알림 수신 때 재시도할 필요는 없다(수신 로그일 뿐) */
        }
      })();
    });
    return () => subscription.remove();
  }, []);
}

/**
 * 앱 아이콘 배지 동기화 — 대화 목록 캐시의 안읽음 합계를 반영한다.
 * (앱이 종료된 동안은 서버가 push payload의 badge 필드로 유지한다)
 */
export function useBadgeSync(conversations: ConversationSummary[] | undefined): void {
  useEffect(() => {
    if (!conversations) return;
    const total = conversations.reduce((sum, conv) => sum + conv.unread, 0);
    void Notifications.setBadgeCountAsync(total);
  }, [conversations]);
}
