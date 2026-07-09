/**
 * 테마 선호 저장소 — expo-secure-store에 보관한다 (session.ts와 같은 패턴).
 *
 * ThemeProvider가 첫 렌더에서 동기적으로 값을 읽어야 하므로 인메모리 캐시를
 * 함께 유지하고, 앱 시작 시 hydrateThemePref()로 캐시를 채운다.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'lc_theme';

export type ThemePreference = 'system' | 'light' | 'dark';

/** 동기 접근용 캐시 — SecureStore와 항상 동기화된다 */
let cached: ThemePreference = 'system';

function isPreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** 앱 시작 시 한 번 호출 — 저장된 선호를 캐시로 불러온다 */
export async function hydrateThemePref(): Promise<ThemePreference> {
  const stored = await SecureStore.getItemAsync(KEY);
  cached = isPreference(stored) ? stored : 'system';
  return cached;
}

/** 현재 선호 (hydrate 이후 동기 접근) */
export function getThemePref(): ThemePreference {
  return cached;
}

/** 선호 변경 저장 */
export async function setThemePref(pref: ThemePreference): Promise<void> {
  cached = pref;
  await SecureStore.setItemAsync(KEY, pref);
}
