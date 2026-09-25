import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type WatchSessionNativeModule = {
  publishSessionToken(token: string | null): void;
};

const nativeModule =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<WatchSessionNativeModule>('WatchSession')
    : null;

/**
 * iPhone의 세션 토큰을 iCloud 동기화 Keychain 항목으로 발행한다.
 * 워치 앱이 이 항목을 읽어 아이폰 로그인 상태를 자동으로 채택한다.
 * 동기화 실패(미연동 모듈, iCloud 비활성)도 로그인 자체를 막지 않는다.
 */
export function publishSessionToken(token: string | null): void {
  try {
    nativeModule?.publishSessionToken(token);
  } catch {
    // best-effort 미러링 — 실패해도 세션 동작에 영향을 주지 않는다.
  }
}
