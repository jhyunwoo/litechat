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
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setActiveConversation } from '@/data/active-conversation';
import { markRead, sendMessage, useConversations, useMessages } from '@/data/data';
import { api, errorMessage, unwrap } from '@/lib/api';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';
import { Composer } from './composer';
import { ImageViewer } from './image-viewer';
import { MessageList, type Row } from './message-list';

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
  const [composerLayoutHeight, setComposerLayoutHeight] = useState(0);
  const focused = useRef(false);
  const listRef = useRef<FlashListRef<Row>>(null);
  const composerHeight = useSharedValue(0);

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
      composerHeight.set(height);
      setComposerLayoutHeight(height);
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
  const lastId = messages?.at(-1)?.id;
  useEffect(() => {
    if (!messages || !focused.current) return;
    const lastIncoming = [...messages].reverse().find((m) => m.s !== meId && m.id > 0);
    if (lastIncoming) markRead(queryClient, convId, lastIncoming.id);
  }, [lastId, convId, meId, messages, queryClient]);

  const onSend = useCallback(
    (kind: MessageKind, content: string) => sendMessage(queryClient, meId, convId, kind, content),
    [queryClient, meId, convId],
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
          />
        )}

        {awayFromBottom && (
          <Pressable
            onPress={scrollToEnd}
            accessibilityRole="button"
            accessibilityLabel="최신 메시지로 이동"
            hitSlop={8}
            style={({ pressed }) => [
              styles.latestButton,
              { bottom: composerLayoutHeight + spacing.md },
              pressed && styles.latestButtonPressed,
            ]}
          >
            <Text style={styles.latestButtonText} aria-hidden>
              ↓
            </Text>
          </Pressable>
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
          <Composer onSend={onSend} onError={(err) => setError(errorMessage(err))} />
        </Animated.View>
      </KeyboardStickyView>

      <ImageViewer message={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

const useStyles = makeStyles(({ colors, shadowPanel }) => ({
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
  latestButton: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
    ...shadowPanel,
  },
  latestButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
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
