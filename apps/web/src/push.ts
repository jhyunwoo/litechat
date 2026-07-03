/**
 * Web Push 구독 관리 (클라이언트)
 *
 * 프로필 탭의 알림 on/off 토글이 사용한다.
 */
import { api, unwrap } from './api';

/** base64url VAPID 공개키 → PushManager가 요구하는 Uint8Array */
function decodeKey(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

/** 이 브라우저에서 푸시를 지원하는지 */
export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** 현재 구독 상태 확인 */
export async function getSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** 알림 켜기 — 권한 요청 → 구독 → 서버 등록 */
export async function enablePush(): Promise<boolean> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const { key, enabled } = await unwrap<{ key: string; enabled: boolean }>(
    await api.api.push.key.$get(),
  );
  if (!enabled) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeKey(key) as BufferSource,
  });

  const json = subscription.toJSON();
  await unwrap(
    await api.api.push.subscribe.$post({
      json: {
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
      },
    }),
  );
  return true;
}

/** 알림 끄기 — 브라우저 구독 해제 + 서버에서 제거 */
export async function disablePush(): Promise<void> {
  const subscription = await getSubscription();
  if (!subscription) return;
  await api.api.push.unsubscribe.$post({ json: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
}
