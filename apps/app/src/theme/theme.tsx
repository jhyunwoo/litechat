/**
 * 테마 컨텍스트 — 시스템 스킴 추종 + 수동 오버라이드(system/light/dark)
 *
 * 사용법:
 *   - 스타일시트: const useStyles = makeStyles(({ colors, type }) => ({ ... }));
 *     컴포넌트 안에서 const styles = useStyles();
 *   - 인라인 색: const { colors } = useTheme();
 *
 * 수동 오버라이드는 Appearance.setColorScheme으로 네이티브 표면(네이티브 탭,
 * 알럿, 키보드)에도 반영되고, expo-secure-store에 저장되어 재시작 후 유지된다.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, StyleSheet, useColorScheme } from 'react-native';
import {
  getThemePref,
  hydrateThemePref,
  setThemePref,
  type ThemePreference,
} from '@/lib/theme-pref';
import {
  darkColors,
  lightColors,
  makeShadows,
  makeType,
  type Palette,
  type TypeScale,
} from './tokens';

export interface Theme {
  scheme: 'light' | 'dark';
  pref: ThemePreference;
  setPref: (pref: ThemePreference) => void;
  colors: Palette;
  type: TypeScale;
  shadowCard: ReturnType<typeof makeShadows>['shadowCard'];
  shadowPanel: ReturnType<typeof makeShadows>['shadowPanel'];
}

function buildTheme(
  scheme: 'light' | 'dark',
  pref: ThemePreference,
  setPref: (pref: ThemePreference) => void,
): Theme {
  const colors = scheme === 'dark' ? darkColors : lightColors;
  return { scheme, pref, setPref, colors, type: makeType(colors), ...makeShadows(colors) };
}

/** 프로바이더 밖(테스트 등)에서는 라이트 테마로 동작한다 */
const fallbackTheme = buildTheme('light', 'system', () => {});

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePreference>(getThemePref());
  const [hydrated, setHydrated] = useState(false);
  const system = useColorScheme();

  // 저장된 선호를 불러와 네이티브 스킴에 반영한다. 완료 전에는 렌더하지 않아
  // (네이티브 스플래시가 덮고 있는 동안) 라이트 → 다크 플래시를 막는다.
  useEffect(() => {
    void hydrateThemePref().then((stored) => {
      setPrefState(stored);
      if (stored !== 'system') Appearance.setColorScheme(stored);
      setHydrated(true);
    });
  }, []);

  const setPref = useCallback((next: ThemePreference) => {
    setPrefState(next);
    void setThemePref(next);
    // 네이티브 표면(탭바/알럿/키보드)도 함께 전환 — unspecified면 시스템 복귀
    Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  }, []);

  const scheme: 'light' | 'dark' =
    pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  const value = useMemo(() => buildTheme(scheme, pref, setPref), [scheme, pref, setPref]);

  if (!hydrated) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext) ?? fallbackTheme;
}

/**
 * 테마 기반 StyleSheet 훅 팩토리 — 기존 StyleSheet.create 블록을
 * makeStyles((t) => ({ ... }))로 감싸면 스킴 전환 시 자동 재생성된다.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (theme: Theme) => T & StyleSheet.NamedStyles<T>,
): () => T {
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
  };
}
