/**
 * 사용자 분석 계측 — notifications.ts/ota.ts와 같은 패턴(SecureStore 영속 + AppState 훅).
 *
 * IP는 서버가 요청에서 직접 읽으므로 여기서는 다루지 않는다. 앱은 쿠키 저장소가 없어
 * (별도 오리진 fetch) visitorId/sessionId를 직접 만들어 매 요청 body에 실어 보낸다 —
 * 서버는 이 값이 오면 그대로 신뢰한다(analytics/service.ts의 identity 분기 참고).
 */
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { usePathname } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { api } from './api';

const VISITOR_ID_KEY = 'lc_analytics_vid';
/** 이 시간 이상 백그라운드에 있었다면 포그라운드 복귀를 새 세션으로 취급한다 */
const SESSION_GAP_MS = 30 * 60 * 1000;

let visitorId: string | null = null;
let sessionId: string | null = null;
let lastActiveAt = 0;

async function getVisitorId(): Promise<string> {
  if (visitorId) return visitorId;
  const stored = await SecureStore.getItemAsync(VISITOR_ID_KEY);
  visitorId = stored ?? Crypto.randomUUID();
  if (!stored) await SecureStore.setItemAsync(VISITOR_ID_KEY, visitorId);
  return visitorId;
}

/** "LiteChatApp/1.4.2 (114; iPhone15,3; iOS 18.1)" 형태의 기기 정보 문자열 */
function deviceInfo(): string {
  const appVersion = Application.nativeApplicationVersion ?? '?';
  const buildVersion = Application.nativeBuildVersion ?? '?';
  const model = Device.modelName ?? Device.deviceName ?? 'unknown';
  const os = `${Device.osName ?? 'OS'} ${Device.osVersion ?? ''}`.trim();
  return `LiteChatApp/${appVersion} (${buildVersion}; ${model}; ${os})`.trim();
}

/** 콜드 스타트 또는 오래 쉬었다 복귀했을 때만 새 세션 ID를 발급한다 */
function ensureSessionId(): { sessionId: string; isNewSession: boolean } {
  const now = Date.now();
  const isNewSession = !sessionId || now - lastActiveAt > SESSION_GAP_MS;
  if (isNewSession) sessionId = Crypto.randomUUID();
  lastActiveAt = now;
  return { sessionId: sessionId!, isNewSession };
}

async function sendSession(): Promise<void> {
  const vid = await getVisitorId();
  const { sessionId: sid } = ensureSessionId();
  await api.api.analytics.session
    .$post({ json: { platform: 'app', deviceInfo: deviceInfo(), visitorId: vid, sessionId: sid } })
    .catch(() => {});
}

async function sendEvent(path: string): Promise<void> {
  const vid = await getVisitorId();
  const { sessionId: sid } = ensureSessionId();
  await api.api.analytics.event
    .$post({ json: { path, visitorId: vid, sessionId: sid } })
    .catch(() => {});
}

/**
 * 루트 레이아웃에서 한 번 마운트 — 콜드 스타트 시, 포그라운드 복귀 시,
 * 화면(경로) 전환마다 세션/이벤트를 기록한다.
 */
export function useAppAnalytics(): void {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    void sendSession();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sendSession();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    void sendEvent(pathname);
  }, [pathname]);
}
