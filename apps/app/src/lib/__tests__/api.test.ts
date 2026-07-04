/**
 * API 클라이언트 테스트 — Bearer 헤더 주입 + unwrap 오류 처리
 */
import { ApiFailure, authHeaders, errorMessage, unwrap } from '../api';
import { clearToken, setToken } from '../session';

describe('authHeaders', () => {
  afterEach(async () => {
    await clearToken();
  });

  test('토큰이 없으면 빈 헤더를 반환한다', async () => {
    await clearToken();
    expect(authHeaders()).toEqual({});
  });

  test('토큰이 있으면 Bearer 헤더를 붙인다', async () => {
    await setToken('secret-token');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer secret-token' });
  });
});

describe('unwrap', () => {
  test('성공 응답은 JSON을 반환한다', async () => {
    const result = await unwrap<{ ok: boolean }>({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    expect(result).toEqual({ ok: true });
  });

  test('실패 응답은 서버 오류 코드를 담아 던진다', async () => {
    await expect(
      unwrap({ ok: false, status: 401, json: async () => ({ error: 'INVALID_CREDENTIALS' }) }),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  test('JSON이 아닌 오류 응답은 INTERNAL 코드가 된다', async () => {
    await expect(
      unwrap({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

describe('errorMessage', () => {
  test('알려진 코드는 한국어 메시지로 변환된다', () => {
    expect(errorMessage(new ApiFailure(401, 'INVALID_CREDENTIALS'))).toBe(
      '아이디 또는 비밀번호가 올바르지 않아요.',
    );
    expect(errorMessage(new ApiFailure(409, 'USERNAME_TAKEN'))).toBe('이미 사용 중인 아이디예요.');
  });

  test('모르는 오류는 기본 메시지를 반환한다', () => {
    expect(errorMessage(new Error('boom'))).toBe(
      '문제가 발생했어요. 잠시 후 다시 시도해 주세요.',
    );
  });
});
