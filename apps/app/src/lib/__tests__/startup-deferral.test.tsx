/**
 * 시작 경로 보호 테스트
 *
 * OTA 업데이트 확인은 초기 세션 확인이 끝난 뒤(ready)에만 시작해야 한다.
 * 확인/다운로드는 번들 전체를 받을 수도 있는 작업이라, 마운트 즉시 실행하면 느린
 * 회선에서 /api/auth/me와 WebSocket 연결 같은 진짜 급한 요청과 대역폭을 다툰다.
 */
import { render } from '@testing-library/react-native';
import * as Updates from 'expo-updates';
import { useOTAUpdates } from '../ota';

jest.mock('expo-updates', () => ({
  isEnabled: true,
  checkForUpdateAsync: jest.fn(async () => ({ isAvailable: false })),
  fetchUpdateAsync: jest.fn(async () => ({})),
}));

// fetchUpdateInBackground는 __DEV__에서 즉시 반환한다 (Expo Go/개발 빌드 보호).
// 프로덕션 동작을 검증해야 하므로 이 파일에서만 릴리스 모드로 바꾼다.
const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;
beforeAll(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
afterAll(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
});

function OtaHost({ ready }: { ready: boolean }) {
  useOTAUpdates(ready);
  return null;
}

beforeEach(() => jest.clearAllMocks());

describe('useOTAUpdates 콜드 스타트 지연', () => {
  test('ready 이전에는 업데이트를 확인하지 않는다', async () => {
    await render(<OtaHost ready={false} />);
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  test('ready가 되면 확인한다', async () => {
    const view = await render(<OtaHost ready={false} />);
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();

    await view.rerender(<OtaHost ready />);
    expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  });
});
