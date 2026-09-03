/**
 * 입력 바 레이아웃 회귀 테스트
 *
 * 사진/이모지/입력창/전송 버튼의 높이가 서로 어긋나면 입력 바가 들쭉날쭉해 보인다.
 * (실제로 입력창 40 vs 전송 버튼 48로 어긋난 적이 있어 그 회귀를 막는다.)
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Composer } from '../composer';

/** 호스트 엘리먼트에 최종 적용된 스타일 */
function styleOf(element: { props: { style?: unknown } }): Record<string, number> {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Record<string, number>;
}

async function setup() {
  await render(<Composer onSend={jest.fn()} onError={jest.fn()} onCancelReply={jest.fn()} />);
  return {
    input: styleOf(screen.getByPlaceholderText('메시지 보내기')),
    send: styleOf(screen.getByLabelText('전송')),
    photo: styleOf(screen.getByLabelText('사진 보내기')),
    emoji: styleOf(screen.getByLabelText('이모지')),
  };
}

describe('Composer 입력 바', () => {
  test('한 줄 입력창과 전송 버튼의 높이가 같다', async () => {
    const { input, send } = await setup();
    expect(input.minHeight).toBe(send.height);
  });

  test('세로 패딩과 줄 높이의 합이 컨트롤 높이와 정확히 맞는다', async () => {
    const { input, send } = await setup();
    expect(input.paddingTop + input.lineHeight + input.paddingBottom).toBe(send.height);
  });

  test('사진/이모지 버튼도 같은 높이를 쓴다', async () => {
    const { photo, emoji, send } = await setup();
    expect(photo.height).toBe(send.height);
    expect(emoji.height).toBe(send.height);
  });

  test('모든 컨트롤이 최소 터치 타깃(44) 이상이다', async () => {
    const { input, send, photo } = await setup();
    for (const size of [input.minHeight, send.height, send.width, photo.height, photo.width]) {
      expect(size).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('Composer 답장 바', () => {
  test('답장 대상이 없으면 답장 바가 없다', async () => {
    await render(<Composer onSend={jest.fn()} onError={jest.fn()} onCancelReply={jest.fn()} />);
    expect(screen.queryByLabelText('답장 취소')).toBeNull();
  });

  test('답장 대상이 있으면 보낸이와 인용 한 줄, 취소 버튼을 보여준다', async () => {
    await render(
      <Composer
        onSend={jest.fn()}
        onError={jest.fn()}
        replyPreview={{ name: '앨리스', text: '원본입니다' }}
        onCancelReply={jest.fn()}
      />,
    );
    expect(screen.getByText('앨리스에게 답장')).toBeTruthy();
    expect(screen.getByText('원본입니다')).toBeTruthy();
    // 취소 버튼도 다른 컨트롤과 같은 44pt 터치 타깃이어야 한다 (DESIGN.md)
    expect(styleOf(screen.getByLabelText('답장 취소')).height).toBe(44);
  });
});
