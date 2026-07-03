/**
 * iOS PWA 설치/실행 상태 감지 유틸
 *
 * iOS Safari는 "홈 화면에 추가"로 독립 실행(standalone) 모드에서 열었을 때만
 * Web Push(PushManager/Notification)를 노출한다. 온보딩은 이 상태를 읽어
 *   Safari(브라우저)  → 공유 → 홈 화면에 추가 안내
 *   standalone(설치됨) → 알림 켜기
 * 로 단계를 전환한다.
 */

/** iPhone/iPad/iPod 여부 (iPadOS 13+는 Mac으로 위장하므로 터치 포인트로 보정) */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  const iOSUA = /iphone|ipad|ipod/i.test(ua);
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOSUA || iPadOS;
}

/** 홈 화면에서 실행된 독립 실행(PWA) 모드인지 */
export function isStandalone(): boolean {
  const iosStandalone =
    'standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true;
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  return Boolean(iosStandalone || displayMode);
}

/** 현재 알림 권한 상태 ('default' | 'granted' | 'denied'). Notification 미지원 시 'unsupported' */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}
