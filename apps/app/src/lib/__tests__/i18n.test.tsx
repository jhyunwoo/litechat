import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { AppState, type AppStateStatus } from 'react-native';
import { Composer } from '@/components/composer';
import { ApiFailure, errorMessage } from '../api';
import { formatTime, quoteText } from '../format';
import { getLanguage, languageFor, t, translate } from '../i18n';
import { translations } from '../i18n/translations';

const locales = jest.mocked(getLocales);
const defaultLocale = getLocales()[0];
function setLanguages(...languages: string[]) {
  locales.mockReturnValue(
    languages.map((languageCode) => ({ ...defaultLocale, languageCode })) as ReturnType<
      typeof getLocales
    >,
  );
}

afterEach(() => {
  setLanguages('ko');
  jest.restoreAllMocks();
});

test.each(['ko', 'ko-KR', 'KO_kr'])('Korean primary language %s uses Korean', (language) => {
  expect(languageFor(language)).toBe('ko');
});
test.each(['en', 'ja', 'fr', '', null, undefined])(
  'unsupported or missing primary language %s uses English',
  (language) => {
    expect(languageFor(language)).toBe('en');
  },
);

test('a secondary Korean preference does not override the primary language', () => {
  setLanguages('ja', 'ko');
  expect(getLanguage()).toBe('en');
  expect(t('채팅')).toBe('Chats');
});

test('translations preserve user names, query text, and message content', () => {
  setLanguages('en');
  expect(t('{name}에게 답장', { name: '김민수 $& {name}' })).toBe('Replying to 김민수 $& {name}');
  expect(translate('ko', '{name}에게 답장', { name: 'Alice' })).toBe('Alice에게 답장');
  expect(t('‘{query}’ 사용자를 찾지 못했어요.', { query: '홍길동' })).toBe(
    'No users found for “홍길동”.',
  );
  expect(quoteText('t', '친구')).toBe('친구');
  expect(quoteText('i', 'private-image-id')).toBe('Photo');
});

test('every English message is nonempty and retains all interpolation placeholders', () => {
  for (const [key, value] of Object.entries(translations)) {
    expect(value.trim()).not.toBe('');
    expect(value).not.toMatch(/[가-힣]/);
    expect(value.match(/\{[^}]+\}/g)?.sort()).toEqual(key.match(/\{[^}]+\}/g)?.sort());
  }
});

test('API failures and date formatting follow the selected language', () => {
  const date = new Date(2020, 0, 2);
  for (const [language, locale, message] of [
    ['en', 'en-US', 'Incorrect username or password.'],
    ['ko', 'ko-KR', '아이디 또는 비밀번호가 올바르지 않아요.'],
  ]) {
    setLanguages(language);
    expect(errorMessage(new ApiFailure(401, 'INVALID_CREDENTIALS'))).toBe(message);
    expect(formatTime(date.getTime() / 1000)).toBe(
      date.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    );
  }
});

test('foreground locale changes update composer labels without losing draft or reply content', async () => {
  setLanguages('ko');
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listeners.add(callback);
    return {
      remove: () => {
        listeners.delete(callback);
      },
    };
  });
  await render(
    <Composer
      onSend={jest.fn()}
      onError={jest.fn()}
      onCancelReply={jest.fn()}
      replyPreview={{ name: '앨리스', text: '원본 메시지' }}
    />,
  );
  await fireEvent.changeText(screen.getByPlaceholderText('메시지 보내기'), '보존할 초안');
  setLanguages('en');
  await act(() => {
    listeners.forEach((listener) => listener('active'));
  });
  expect(screen.getByPlaceholderText('Send message').props.value).toBe('보존할 초안');
  expect(screen.getByLabelText('Send photo')).toBeTruthy();
  expect(screen.getByText('Replying to 앨리스')).toBeTruthy();
  expect(screen.getByText('원본 메시지')).toBeTruthy();
  setLanguages('ko');
  await act(() => {
    listeners.forEach((listener) => listener('active'));
  });
  expect(screen.getByPlaceholderText('메시지 보내기').props.value).toBe('보존할 초안');
});
