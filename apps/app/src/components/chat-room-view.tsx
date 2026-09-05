/**
 * 채팅방 본문 — 메시지 목록 + 입력 바 (웹 ChatRoom 포팅)
 *
 * 폰에서는 /chat/[id] 라우트가, iPad에서는 채팅 탭의 2-pane 우측이 사용한다.
 *
 * - 낙관적 전송 + ack 확정, 읽음 표시, 이미지/이모지 전송
 * - 화면이 보이는 동안 새 메시지가 오면 자동으로 읽음 처리
 * - 보고 있는 동안 이 방의 푸시 알림을 억제 (activeConversation)
 * - 키보드: keyboard-controller로 프레임 동기 이동 + 인터랙티브 내리기
 */
import type { MessageKind, WireMessage } from '@litechat/types';
import type { FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, type LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import {
  KeyboardStickyView,
  useKeyboardHandler,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setActiveConversation } from '@/data/active-conversation';
import { loadOlderMessages, markRead, sendMessage, useConversations, useMessages } from '@/data/data';
import { api, errorMessage, unwrap } from '@/lib/api';
import { quoteText } from '@/lib/format';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';
import { COMPOSER_BAR_HEIGHT, Composer } from './composer';
import { ImageViewer } from './image-viewer';
import { MessageList, type Row } from './message-list';

/** 인용 원본을 찾으러 과거로 되짚을 최대 페이지 수 — 저속 회선에서 왕복이 무한정 늘지 않게 한다 */
const MAX_JUMP_PAGES = 10;

interface Props {
  convId: number;
  meId: number;
}

export function ChatRoomView({ convId, meId }: Props) {
  return <ChatRoomViewContent key={convId} convId={convId} meId={meId} />;
}

function ChatRoomViewContent({ convId, meId }: Props) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const { data: conversations } = useConversations();
  const conversation = conversations?.find((c) => c.id === convId);
  const { data: messages } = useMessages(convId);

  const [viewing, setViewing] = useState<WireMessage | null>(null);
  const [error, setError] = useState('');
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  /**
   * 입력 바 높이 — 메시지 리스트의 하단 여백(contentInset)이자 "최신으로" 버튼의 기준.
   *
   * 0이 아니라 토큰으로 계산한 값에서 시작한다. 0에서 시작하면 FlashList가 여백이
   * 아직 0인 상태로 바닥을 잡아 버려서, 방에 들어온 순간 마지막 메시지들이 딱
   * 입력 바 높이만큼 그 뒤에 깔린다. 실측(onLayout)이 오면 그 값으로 덮는다.
   */
  const estimatedComposerHeight = COMPOSER_BAR_HEIGHT + insets.bottom;
  const [composerLayoutHeight, setComposerLayoutHeight] = useState(estimatedComposerHeight);
  /** 지금 답장 중인 메시지 (없으면 null) */
  const [replyTo, setReplyTo] = useState<WireMessage | null>(null);
  /** 점프 직후 잠깐 밝힐 메시지 ID */
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const focused = useRef(false);
  const listRef = useRef<FlashListRef<Row>>(null);
  const composerHeight = useSharedValue(estimatedComposerHeight);
  /** 첫 실측이 끝났는지 — 추정이 빗나갔을 때 딱 한 번만 바닥을 다시 잡기 위해 */
  const composerMeasured = useRef(false);

  // 키보드가 열리면 최신 메시지가 컴포저 위에 보이도록 바닥으로 스크롤한다.
  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);
  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        if (e.height > 0) runOnJS(scrollToEnd)();
      },
    },
    [scrollToEnd],
  );

  // 컴포저 하단 여백: 키보드가 닫혀 있을 때만 홈 인디케이터 인셋을 채운다.
  // 컴포저 전체 높이는 메시지 리스트의 동적 하단 inset으로도 전달한다.
  const { progress } = useReanimatedKeyboardAnimation();
  const composerPad = useAnimatedStyle(() => ({
    paddingBottom: insets.bottom * (1 - progress.value),
  }));
  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      const drifted = Math.abs(height - composerHeight.get()) > 0.5;
      composerHeight.set(height);
      setComposerLayoutHeight(height);
      // 추정과 실측이 다르면(큰 글씨 설정 등) 첫 실측 때 한 번만 바닥을 다시 잡는다.
      // 이후의 높이 변화(답장 바, 여러 줄 입력)는 keyboard-controller가 스크롤을 함께 옮기므로
      // 여기서 또 끌어내리면 과거를 읽는 중인 사용자를 아래로 채 간다.
      if (!composerMeasured.current) {
        composerMeasured.current = true;
        if (drifted) listRef.current?.scrollToEnd({ animated: false });
      }
    },
    [composerHeight],
  );

  // 화면이 보이는 동안: 이 방의 푸시 알림 억제 + 읽음 처리 활성화
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setActiveConversation(convId);
      return () => {
        focused.current = false;
        setActiveConversation(null);
      };
    }, [convId]),
  );

  // 화면에 보이는 마지막 수신 메시지를 읽음 처리한다.
  // 배열 복사·역순 정렬 대신 뒤에서부터 찾는다 — 메시지 도착마다 실행되는 경로라
  // 히스토리가 길수록 복사 비용이 JS 스레드 프레임 예산을 그대로 깎는다.
  const lastId = messages?.at(-1)?.id;
  useEffect(() => {
    if (!messages || !focused.current) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if (message.s !== meId && message.id > 0) {
        markRead(queryClient, convId, message.id);
        break;
      }
    }
  }, [lastId, convId, meId, messages, queryClient]);

  const onSend = useCallback(
    async (kind: MessageKind, content: string) => {
      await sendMessage(queryClient, meId, convId, kind, content, replyTo?.id);
      setReplyTo(null); // 성공했을 때만 해제한다 (실패하면 Composer가 입력을 되돌리고 답장 대상은 유지)
    },
    [queryClient, meId, convId, replyTo],
  );

  /**
   * 인용 원본으로 이동한다.
   *
   * 로드된 범위에 없으면 과거 페이지를 되짚어 불러오되 MAX_JUMP_PAGES에서 멈춘다.
   * around= 같은 새 엔드포인트를 쓰지 않는 이유는 메시지 배열에 구멍이 생기면
   * 페이지네이션과 읽음 워터마크 계산이 모두 복잡해지기 때문이다.
   */
  const jumpTo = useCallback(
    async (messageId: number) => {
      for (let page = 0; page <= MAX_JUMP_PAGES; page += 1) {
        const loaded = queryClient.getQueryData<WireMessage[]>(['messages', convId]);
        const index = loaded?.findIndex((message) => message.id === messageId) ?? -1;
        if (index >= 0) {
          setHighlighted(messageId);
          setTimeout(
            () => setHighlighted((current) => (current === messageId ? null : current)),
            1200,
          );
          listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
          return;
        }
        if (page === MAX_JUMP_PAGES) break;
        try {
          if (!(await loadOlderMessages(queryClient, convId))) break;
        } catch (cause) {
          setError(errorMessage(cause));
          return;
        }
      }
      setError('원본 메시지를 찾을 수 없습니다');
    },
    [queryClient, convId],
  );
  const onLoadError = useCallback((cause: unknown) => setError(errorMessage(cause)), []);

  const reportMessage = useCallback(
    (message: WireMessage) => {
      if (!conversation || message.s === meId) return;
      const choices: {
        text: string;
        reason?: 'harassment' | 'hate' | 'sexual' | 'violence' | 'spam';
      }[] = [
        { text: '괴롭힘', reason: 'harassment' },
        { text: '혐오 표현', reason: 'hate' },
        { text: '성적 콘텐츠', reason: 'sexual' },
        { text: '폭력적 콘텐츠', reason: 'violence' },
        { text: '스팸', reason: 'spam' },
        { text: '취소' },
      ];
      Alert.alert(
        '메시지 신고',
        '신고 사유를 선택해 주세요. 운영팀이 해당 메시지와 계정을 검토합니다.',
        choices.map((choice) => ({
          text: choice.text,
          style: choice.reason ? 'default' : 'cancel',
          onPress: choice.reason
            ? () =>
                void (async () => {
                  try {
                    await unwrap(
                      await api.api.safety.reports.$post({
                        json: {
                          userId: conversation.peer.id,
                          messageId: message.id,
                          reason: choice.reason!,
                        },
                      }),
                    );
                    Alert.alert('신고 접수', '신고가 접수되었어요. 운영팀이 검토합니다.');
                  } catch (cause) {
                    setError(errorMessage(cause));
                  }
                })()
            : undefined,
        })),
      );
    },
    [conversation, meId],
  );

  return (
    <View style={styles.container}>
      <View style={styles.list}>
        {messages && (
          <MessageList
            key={convId}
            convId={convId}
            meId={meId}
            messages={messages}
            conversation={conversation}
            onImagePress={setViewing}
            onMessageLongPress={reportMessage}
            listRef={listRef}
            composerHeight={composerHeight}
            onAwayFromBottomChange={setAwayFromBottom}
            onLoadError={onLoadError}
            highlightedId={highlighted}
            onReply={setReplyTo}
            onQuotePress={(id) => void jumpTo(id)}
          />
        )}

        {awayFromBottom && (
          <Animated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
            style={[styles.latestAnchor, { bottom: composerLayoutHeight + spacing.md }]}
          >
            <Pressable
              onPress={scrollToEnd}
              accessibilityRole="button"
              accessibilityLabel="최신 메시지로 이동"
              hitSlop={8}
              style={({ pressed }) => [styles.latestButton, pressed && styles.latestButtonPressed]}
            >
              <Text style={styles.latestButtonText} aria-hidden>
                ↓
              </Text>
            </Pressable>
          </Animated.View>
        )}
      </View>

      <KeyboardStickyView
        style={styles.composer}
        testID="chat-composer"
        onLayout={onComposerLayout}
      >
        {error !== '' && (
          <Pressable onPress={() => setError('')}>
            <Text style={styles.error}>{error}</Text>
          </Pressable>
        )}

        <Animated.View style={composerPad}>
          <Composer
            onSend={onSend}
            onError={(err) => setError(errorMessage(err))}
            replyPreview={
              replyTo
                ? {
                    name: replyTo.s === meId ? '나' : (conversation?.peer.nickname ?? '상대'),
                    text: quoteText(replyTo.k, replyTo.x),
                  }
                : undefined
            }
            onCancelReply={() => setReplyTo(null)}
          />
        </Animated.View>
      </KeyboardStickyView>

      <ImageViewer message={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  composer: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
  },
  latestAnchor: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 2,
  },
  latestButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    // 크롬에는 그림자를 쓰지 않는다 — 표면 색 + 헤어라인으로만 떠오르게 한다 (DESIGN.md)
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  latestButtonPressed: {
    backgroundColor: colors.canvasSoft,
    transform: [{ scale: 0.95 }],
  },
  latestButtonText: {
    fontSize: 21,
    lineHeight: 24,
    color: colors.ink,
  },
  error: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    textAlign: 'center',
    fontSize: 12,
    color: colors.ruby,
  },
}));
