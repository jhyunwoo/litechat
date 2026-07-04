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
import { useEffect } from 'react';
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
 */
export function useNotificationDeepLink(): void {
  useEffect(() => {
    function open(notification: Notifications.Notification) {
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
