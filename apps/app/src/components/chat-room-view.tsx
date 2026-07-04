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
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setActiveConversation } from '@/data/active-conversation';
import { markRead, sendMessage, useConversations, useMessages } from '@/data/data';
import { errorMessage } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';
import { Composer } from './composer';
import { ImageViewer } from './image-viewer';
import { MessageList } from './message-list';

interface Props {
  convId: number;
  meId: number;
}

export function ChatRoomView({ convId, meId }: Props) {
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const { data: conversations } = useConversations();
  const conversation = conversations?.find((c) => c.id === convId);
  const { data: messages } = useMessages(convId);

  const [viewing, setViewing] = useState<WireMessage | null>(null);
  const [error, setError] = useState('');
  const focused = useRef(false);

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

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.container}>
      <View style={styles.list}>
        {messages && (
          <MessageList
            convId={convId}
            meId={meId}
            messages={messages}
            conversation={conversation}
            onImagePress={setViewing}
          />
        )}
      </View>

      {error !== '' && (
        <Pressable onPress={() => setError('')}>
          <Text style={styles.error}>{error}</Text>
        </Pressable>
      )}

      <View style={{ paddingBottom: insets.bottom }}>
        <Composer onSend={onSend} onError={(err) => setError(errorMessage(err))} />
      </View>

      <ImageViewer message={viewing} onClose={() => setViewing(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  error: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    textAlign: 'center',
    fontSize: 12,
    color: colors.ruby,
  },
});
