/**
 * 세션 토큰 저장소 — iOS Keychain(expo-secure-store)에 보관한다.
 *
 * fetch 헤더 콜백은 동기적으로 토큰이 필요하므로 인메모리 캐시를 함께 유지한다.
 * 앱 시작 시 hydrateToken()으로 캐시를 채운 뒤 API/WS를 시작해야 한다.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'lc_sess';

/** 동기 접근용 캐시 — SecureStore와 항상 동기화된다 */
let cached: string | null = null;

/** 앱 시작 시 한 번 호출 — Keychain에서 토큰을 캐시로 불러온다 */
export async function hydrateToken(): Promise<string | null> {
  cached = await SecureStore.getItemAsync(KEY);
  return cached;
}

/** 현재 토큰 (hydrate 이후 동기 접근) */
export function getToken(): string | null {
  return cached;
}

/** 로그인 성공 시 토큰 저장 */
export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token, {
    // 기기 잠금 해제 상태에서만 접근 가능 + iCloud/기기 이전에 포함되지 않음
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  cached = token;
}

/** 로그아웃 시 토큰 삭제 */
export async function clearToken(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(KEY);
}
