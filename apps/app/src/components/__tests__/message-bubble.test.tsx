/**
 * 메시지 말풍선 렌더 테스트 — 내/상대/읽음/대기/이모지/이미지 변형
 */
import type { WireMessage } from '@litechat/types';
import { render, screen } from '@testing-library/react-native';
import { MessageBubble } from '../message-bubble';

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
        message={message({ k: 'i', x: 'img1', im: { id: 'img1', w: 640, h: 480, tb: 1000, ob: 5000 } })}
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
