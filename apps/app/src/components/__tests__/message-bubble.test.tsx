/**
 * 메시지 말풍선 렌더 테스트 — 내/상대/읽음/대기/이모지/이미지 변형
 */
import type { WireMessage } from '@litechat/types';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MessageBubble } from '../message-bubble';

// 제스처 설정(방향/엣지 제외 영역)을 검사할 수 있도록 GestureDetector를 통과 View로 바꾼다.
// 실제 제스처 객체를 그대로 prop에 실어 보내므로, 검사 대상은 말풍선이 만든 진짜 설정이다.
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    ...actual,
    GestureDetector: ({ gesture, children }: { gesture: unknown; children: unknown }) =>
      React.createElement(View, { testID: 'message-gesture', gesture }, children),
  };
});

/** 렌더된 말풍선이 RNGH에 넘긴 Pan 제스처 설정 (Race로 묶였으면 그 안의 Pan) */
function panConfig(): Record<string, number | undefined> {
  const gesture = screen.getByTestId('message-gesture').props.gesture;
  const pan = Array.isArray(gesture?.gestures) ? gesture.gestures[0] : gesture;
  return pan.config;
}

/** 제스처가 실제로 덮는 영역의 스타일 — 행 전체인지 말풍선 묶음인지 구분한다 */
function gestureAreaStyle(): Record<string, unknown> {
  const area = screen.getByTestId('message-gesture');
  const child = area.children[0] as { props: { style?: unknown } };
  return StyleSheet.flatten(child.props.style as never) as Record<string, unknown>;
}

function message(overrides: Partial<WireMessage> = {}): WireMessage {
  return { id: 1, c: 10, s: 1, k: 't', x: '안녕하세요', ts: 1_700_000_000, ...overrides };
}

const base = {
  mine: true,
  pending: false,
  read: false,
  isTail: true,
  animate: false,
  highlighted: false,
  onImagePress: jest.fn(),
  onReply: jest.fn(),
  onQuotePress: jest.fn(),
};

describe('MessageBubble', () => {
  test('텍스트 메시지 본문을 렌더링한다', async () => {
    await render(<MessageBubble {...base} message={message()} />);
    expect(screen.getByText('안녕하세요')).toBeTruthy();
  });

  test('내 메시지가 읽히면 "읽음"을 표시한다', async () => {
    await render(<MessageBubble {...base} message={message()} read />);
    expect(screen.getByText('읽음')).toBeTruthy();
  });

  test('상대 메시지에는 "읽음"이 없다', async () => {
    await render(<MessageBubble {...base} message={message({ s: 2 })} mine={false} />);
    expect(screen.queryByText('읽음')).toBeNull();
  });

  test('묶음 중간(isTail=false)에는 시간이 없다', async () => {
    await render(<MessageBubble {...base} message={message()} isTail={false} />);
    // formatTime 결과가 없어야 한다 — 시간/읽음 메타 영역 자체가 없다.
    expect(screen.queryByText('읽음')).toBeNull();
  });

  test('이모지 전용 메시지는 말풍선 없이 크게 렌더링한다', async () => {
    await render(<MessageBubble {...base} message={message({ k: 'e', x: '🎉' })} />);
    const emoji = screen.getByText('🎉');
    expect(emoji.props.style).toMatchObject({ fontSize: 48 });
  });

  test('이미지 메시지는 사진을 렌더링한다', async () => {
    await render(
      <MessageBubble
        {...base}
        message={message({
          k: 'i',
          x: 'img1',
          im: { id: 'img1', w: 640, h: 480, tb: 1000, ob: 5000 },
        })}
      />,
    );
    expect(screen.getByLabelText('사진')).toBeTruthy();
  });
});

describe('MessageBubble — 답장', () => {
  test('인용문이 있으면 보낸이와 본문을 함께 보여준다', async () => {
    await render(
      <MessageBubble
        {...base}
        message={message({ r: 7 })}
        quote={{ id: 7, name: '앨리스', text: '원본입니다' }}
      />,
    );
    expect(screen.getByText('앨리스')).toBeTruthy();
    expect(screen.getByText('원본입니다')).toBeTruthy();
  });

  test('인용 원본을 못 찾으면 플레이스홀더를 보여준다', async () => {
    await render(<MessageBubble {...base} message={message({ r: 7 })} />);
    expect(screen.getByText('메시지')).toBeTruthy();
  });

  test('답장이 아니면 인용 영역이 없다', async () => {
    await render(<MessageBubble {...base} message={message()} />);
    expect(screen.queryByText('메시지')).toBeNull();
  });
});

describe('MessageBubble — 뒤로가기 엣지 스와이프와의 공존', () => {
  test('내 메시지는 답장 방향(←)으로만 활성화된다', async () => {
    await render(<MessageBubble {...base} message={message()} />);
    const config = panConfig();
    expect(config.activeOffsetXStart).toBeLessThan(0);
    // 오른쪽(=뒤로가기 방향)으로 끌 때는 답장이 될 수 없으므로 활성화 임계값이 없어야 한다.
    expect(config.activeOffsetXEnd).toBeUndefined();
  });

  test('상대 메시지는 답장 방향(→)으로만 활성화된다', async () => {
    await render(<MessageBubble {...base} message={message({ s: 2 })} mine={false} />);
    const config = panConfig();
    expect(config.activeOffsetXEnd).toBeGreaterThan(0);
    expect(config.activeOffsetXStart).toBeUndefined();
  });

  test.each([
    ['내', true, 1],
    ['상대', false, 2],
  ])('%s 메시지의 제스처 영역은 행 전체가 아니라 말풍선 묶음이다', async (_label, mine, sender) => {
    await render(<MessageBubble {...base} message={message({ s: sender })} mine={mine} />);
    const style = gestureAreaStyle();
    // 말풍선 묶음(maxWidth 78%)이어야 하고, 화면 폭을 채우는 행(paddingHorizontal)이면 안 된다.
    expect(style.maxWidth).toBe('78%');
    expect(style.paddingHorizontal).toBeUndefined();
  });

  test('오른쪽 끝에 있는 내 말풍선에는 엣지 여백이 없다', async () => {
    await render(<MessageBubble {...base} message={message()} />);
    expect(panConfig().hitSlop).toBeUndefined();
  });

  test('왼쪽 끝과 겹치는 상대 말풍선은 그만큼 터치를 받지 않는다', async () => {
    await render(<MessageBubble {...base} message={message({ s: 2 })} mine={false} />);
    // 음수 hitSlop = 활성 영역을 그만큼 좁힌다. 겹치는 폭은 뒤로가기 제스처 몫으로 남긴다.
    expect((panConfig().hitSlop as unknown as { left: number })?.left).toBeLessThan(0);
  });

  test('길게 눌러 신고와 묶여도(Race) 엣지 영역 제외는 유지된다', async () => {
    await render(
      <MessageBubble {...base} message={message({ s: 2 })} mine={false} onLongPress={jest.fn()} />,
    );
    expect((panConfig().hitSlop as unknown as { left: number })?.left).toBeLessThan(0);
  });
});
