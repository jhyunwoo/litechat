/**
 * OTA 업데이트 (EAS Update) — 포그라운드 복귀 시 조용히 내려받는다.
 *
 * expo-updates 기본 동작은 콜드 런치 때만 체크하는데, 채팅 앱은 백그라운드
 * 상주가 길어 그것만으로는 전파가 느리다. 앱이 활성화될 때마다 체크해
 * 백그라운드로 내려받아 두면 다음 실행에서 자동 적용된다.
 * (대화 중 강제 리로드는 하지 않는다 — 입력 중인 메시지가 날아가면 안 된다)
 */
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState } from 'react-native';

/** 중복 체크 방지 — 한 번에 하나의 체크/다운로드만 */
let checking = false;

/** 새 업데이트가 있으면 다음 실행에 적용되도록 내려받는다 (실패는 조용히 무시) */
export async function fetchUpdateInBackground(): Promise<void> {
  // 개발 모드/Expo Go에서는 Updates API가 동작하지 않는다.
  if (__DEV__ || !Updates.isEnabled || checking) return;
  checking = true;
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (isAvailable) {
      await Updates.fetchUpdateAsync();
      console.log('[ota] update downloaded — applies on next launch');
    }
  } catch {
    /* 네트워크 오류 등 — 다음 포그라운드 전환 때 재시도된다 */
  } finally {
    checking = false;
  }
}

/**
 * 루트 레이아웃에서 한 번 마운트 — 시작 시 + 포그라운드 복귀 시 체크.
 *
 * @param ready 초기 세션 확인이 끝났는지. 콜드 스타트의 업데이트 확인은 이때까지
 *   미룬다 — 확인/다운로드는 번들 전체를 받을 수도 있는 작업이라, 시작 직후에 돌면
 *   같은 회선에서 진짜 급한 요청(/api/auth/me, WebSocket 연결)과 대역폭을 다툰다.
 *   미뤄도 되는 이유는 OTA가 어차피 **다음 실행**에 적용되기 때문이다.
 *   (useNotificationDeepLink와 같은 ready 게이팅 패턴)
 */
export function useOTAUpdates(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    void fetchUpdateInBackground();
  }, [ready]);

  // 포그라운드 복귀는 시작 경로가 아니므로 그대로 즉시 확인한다.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void fetchUpdateInBackground();
    });
    return () => subscription.remove();
  }, []);
}
