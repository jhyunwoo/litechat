import { getLocales } from 'expo-localization';
import { useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { translations } from './translations';

export type Language = 'ko' | 'en';
export type TranslationKey = keyof typeof translations;
type Params<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Params<Rest>
  : never;
type Arguments<K extends TranslationKey> = [Params<K>] extends [never]
  ? [params?: never]
  : [params: Record<Params<K>, string | number>];

/** Only the primary language counts; unsupported languages use English. */
export function languageFor(languageCode: string | null | undefined): Language {
  return languageCode?.toLowerCase().split(/[-_]/)[0] === 'ko' ? 'ko' : 'en';
}
export function getLanguage(): Language {
  return languageFor(getLocales()[0]?.languageCode);
}
export function getLocale(): string {
  return getLanguage() === 'ko' ? 'ko-KR' : 'en-US';
}

export function translate<K extends TranslationKey>(
  language: Language,
  key: K,
  ...args: Arguments<K>
): string {
  const template = language === 'ko' ? key : translations[key];
  const params = args[0] as Record<string, string | number> | undefined;
  return template.replace(/\{([^}]+)\}/g, (match, name: string) => String(params?.[name] ?? match));
}
export function t<K extends TranslationKey>(key: K, ...args: Arguments<K>): string {
  return translate(getLanguage(), key, ...args);
}

function subscribe(onChange: () => void) {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') onChange();
  });
  return () => subscription.remove();
}
/** Subscribe each consumer, including memoized rows, without remounting drafts/navigation. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, () => 'en');
}

export function useTranslation(): typeof t {
  const language = useLanguage();
  return useMemo(
    () =>
      <K extends TranslationKey>(key: K, ...args: Arguments<K>) =>
        translate(language, key, ...args),
    [language],
  );
}

export function useLocale(): string {
  return useLanguage() === 'ko' ? 'ko-KR' : 'en-US';
}
