/**
 * 채팅방 전송 흐름 통합 테스트 (RNTL)
 *
 * 입력 → 전송 → 낙관적 말풍선 표시 → ack 프레임 → 실제 ID로 확정.
 * WS 소켓은 모킹, 캐시는 실제 QueryClient.
 */
import type { ConversationSummary } from '@litechat/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { handleFrame } from '@/data/data';
import { socket } from '@/lib/ws';
import { ChatRoomView } from '../chat-room-view';
import { COMPOSER_BAR_HEIGHT } from '../composer';

/** 테스트용 세이프 에어리어 값 */
const INITIAL_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

jest.mock('@/lib/ws', () => ({
  socket: { send: jest.fn(() => true), onFrame: jest.fn(), onReconnect: jest.fn() },
}));

const ME = 1;
const CONV = 10;

async function setup(messages: object[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const conversation: ConversationSummary = {
    id: CONV,
    peer: { id: 2, username: 'peer', nickname: '상대' },
    last: null,
    unread: 0,
    peerRead: 0,
  };
  queryClient.setQueryData(['conversations'], [conversation]);
  queryClient.setQueryData(['messages', CONV], messages);

  await render(
    <SafeAreaProvider initialMetrics={INITIAL_METRICS}>
      <QueryClientProvider client={queryClient}>
        <ChatRoomView convId={CONV} meId={ME} />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(socket.send).mockReturnValue(true);
});

describe('ChatRoomView 전송 흐름', () => {
  test('메시지가 없으면 빈 상태 안내를 보여준다', async () => {
    await setup([]);
    expect(screen.getByText(/첫 메시지를 보내/)).toBeTruthy();
  });

  test('메시지 목록과 입력창을 키보드 대응 레이어에 배치한다', async () => {
    await setup([{ id: 1, c: CONV, s: 2, k: 't', x: '최근 메시지', ts: 100 }]);

    expect(screen.getByTestId('chat-messages')).toBeTruthy();
    expect(screen.getByTestId('chat-composer')).toBeTruthy();
  });

  test('과거 메시지를 보는 동안 최신 메시지 이동 버튼을 표시한다', async () => {
    await setup([{ id: 1, c: CONV, s: 2, k: 't', x: '최근 메시지', ts: 100 }]);

    await fireEvent.scroll(screen.getByTestId('chat-messages'), {
      nativeEvent: {
        contentOffset: { x: 0, y: 100 },
        contentSize: { width: 390, height: 1_000 },
        layoutMeasurement: { width: 390, height: 600 },
      },
    });
    expect(screen.getByLabelText('최신 메시지로 이동')).toBeTruthy();

    await fireEvent.scroll(screen.getByTestId('chat-messages'), {
      nativeEvent: {
        contentOffset: { x: 0, y: 400 },
        contentSize: { width: 390, height: 1_000 },
        layoutMeasurement: { width: 390, height: 600 },
      },
    });
    expect(screen.queryByLabelText('최신 메시지로 이동')).toBeNull();
  });

  test('입력 → 전송: WS 프레임 발송 + 낙관적 말풍선 표시', async () => {
    await setup([]);

    await fireEvent.changeText(screen.getByPlaceholderText('메시지 보내기'), '테스트 메시지');
    await fireEvent.press(screen.getByLabelText('전송'));

    // WS로 m 프레임이 나간다.
    await waitFor(() => {
      expect(socket.send).toHaveBeenCalledWith(
        expect.objectContaining({ t: 'm', c: CONV, k: 't', x: '테스트 메시지' }),
      );
    });
    // 낙관적 말풍선이 즉시 뜬다.
    expect(screen.getByText('테스트 메시지')).toBeTruthy();
  });

  test('ack 수신 시 임시 메시지가 실제 ID로 확정된다', async () => {
    const queryClient = await setup([]);

    await fireEvent.changeText(screen.getByPlaceholderText('메시지 보내기'), '확정 테스트');
    await fireEvent.press(screen.getByLabelText('전송'));
    await waitFor(() => expect(socket.send).toHaveBeenCalled());

    const frame = jest
      .mocked(socket.send)
      .mock.calls.find(([f]) => (f as { t: string }).t === 'm')![0] as { i: string };
    handleFrame(queryClient, ME, { t: 'a', i: frame.i, id: 55, ts: 123 });

    await waitFor(() => {
      const cached = queryClient.getQueryData<{ id: number }[]>(['messages', CONV])!;
      expect(cached[0]).toMatchObject({ id: 55 });
    });
    expect(screen.getByText('확정 테스트')).toBeTruthy();
  });

  test('이모지만 입력하면 kind가 e로 전송된다', async () => {
    await setup([]);
    await fireEvent.changeText(screen.getByPlaceholderText('메시지 보내기'), '🎉');
    await fireEvent.press(screen.getByLabelText('전송'));
    await waitFor(() => {
      expect(socket.send).toHaveBeenCalledWith(
        expect.objectContaining({ t: 'm', k: 'e', x: '🎉' }),
      );
    });
  });

  test('사진 보관함을 열 수 없으면 설정 안내를 표시한다', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockRejectedValueOnce(new Error('denied'));
    await setup([]);

    await fireEvent.press(screen.getByLabelText('사진 보내기'));

    await waitFor(() => {
      expect(screen.getByText(/기기 설정에서 litechat의 사진 접근/)).toBeTruthy();
    });
  });

  test('화면에 들어오면 마지막 수신 메시지를 읽음 처리한다', async () => {
    await setup([{ id: 3, c: CONV, s: 2, k: 't', x: '읽어줘', ts: 100 }]);
    await waitFor(() => {
      expect(socket.send).toHaveBeenCalledWith({ t: 'r', c: CONV, m: 3 });
    });
  });
});

describe('입력 바 아래로 메시지가 숨지 않는다', () => {
  test('첫 프레임부터 입력 바 높이만큼 리스트 하단 여백을 확보한다', async () => {
    // 하단 여백을 onLayout 이후에야 채우면, FlashList가 그 사이에 끝으로 스크롤하면서
    // 마지막 메시지가 입력 바 뒤로 들어간다 (재진입하면 사라지는 그 증상).
    await setup([{ id: 1, c: CONV, s: 2, k: 't', x: '마지막 메시지', ts: 100 }]);

    const list = screen.getByTestId('chat-messages');
    expect(list.props.extraContentPadding.value).toBeCloseTo(
      COMPOSER_BAR_HEIGHT + INITIAL_METRICS.insets.bottom,
      1,
    );
  });
});
