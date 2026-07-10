/**
 * 알림 딥링크 테스트 — 콜드 스타트 중복 발화(expo/expo#34850) 대응
 *
 * iOS는 리스너가 붙기 전에 도착한 알림 응답을, 리스너가 붙는 순간 다시 쏜다.
 * getLastNotificationResponse + 리스너를 함께 쓰는 우리 훅은 같은 방을 두 번
 * push하게 되고, 두 번째 push의 리마운트가 막 입력을 시작한 컴포저를 날린다.
 */
import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useNotificationDeepLink } from '../notifications';

function response(id: string, convId: unknown) {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: Date.now(),
      request: { identifier: id, content: { data: { c: convId } } },
    },
  } as unknown as Notifications.NotificationResponse;
}

function DeepLinkHost({ ready }: { ready: boolean }) {
  useNotificationDeepLink(ready);
  return null;
}

/** 마지막으로 등록된 응답 리스너를 꺼낸다 */
function lastListener(): (r: Notifications.NotificationResponse) => void {
  const { calls } = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock;
  return calls[calls.length - 1]![0] as (r: Notifications.NotificationResponse) => void;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(null);
});

describe('useNotificationDeepLink', () => {
  test('콜드 스타트 응답이 리스너로 다시 와도 한 번만 연다', async () => {
    const first = response('n1', 5);
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(first);

    await render(<DeepLinkHost ready />);
    // iOS가 보류 중이던 같은 응답을 새 리스너에 다시 발화 (expo/expo#34850)
    await act(async () => lastListener()(first));

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/chat/5');
  });

  test('다른 알림을 탭하면 다시 연다', async () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response('n1', 5));

    await render(<DeepLinkHost ready />);
    await act(async () => lastListener()(response('n2', 8)));

    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenLastCalledWith('/chat/8');
  });

  test('내비게이션 준비 전에는 열지 않고, 준비되면 연다', async () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response('n1', 5));

    const screen = await render(<DeepLinkHost ready={false} />);
    expect(router.push).not.toHaveBeenCalled();

    await screen.rerender(<DeepLinkHost ready />);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/chat/5');
  });

  test('대화 ID가 없는 알림은 무시한다', async () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response('n1', undefined));

    await render(<DeepLinkHost ready />);

    expect(router.push).not.toHaveBeenCalled();
  });
});
