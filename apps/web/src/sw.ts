/**
 * 서비스 워커 — PWA 프리캐시 + Web Push 수신
 *
 * vite-plugin-pwa(injectManifest)가 빌드 산출물 목록을 self.__WB_MANIFEST로 주입한다.
 */
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// 빌드된 정적 자산을 프리캐시 → 재방문/오프라인 시 네트워크 사용 0
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** 푸시 수신 — 서버가 보낸 { title, body, c, n } 페이로드를 알림으로 표시하고, 받았다고 서버에 알린다 */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; c?: number; n?: number };
  try {
    payload = event.data.json() as typeof payload;
  } catch {
    return;
  }
  const showNotification = self.registration.showNotification(payload.title ?? 'litechat', {
    body: payload.body ?? '',
    icon: '/icon-192.png',
    badge: '/notification-badge.png',
    tag: `conv-${payload.c ?? 0}`, // 같은 대화방 알림은 하나로 합친다
    data: { c: payload.c },
  });
  // 수신 ACK — 같은 오리진 요청이라 세션 쿠키가 자동으로 실린다. 실패해도 알림 표시는 막지 않는다.
  const ack =
    typeof payload.n === 'number'
      ? fetch('/api/push/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ n: payload.n }),
        }).catch(() => {})
      : Promise.resolve();
  event.waitUntil(Promise.all([showNotification, ack]));
});

/** 알림 클릭 — 해당 대화방을 연다 (이미 열린 탭이 있으면 재사용) */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const convId = (event.notification.data as { c?: number } | undefined)?.c;
  const url = convId ? `/chat/${convId}` : '/';
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientList[0];
      if (existing) {
        await existing.focus();
        await existing.navigate(url);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
