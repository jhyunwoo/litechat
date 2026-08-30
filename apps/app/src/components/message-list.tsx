/**
 * 메시지 리스트 — FlashList v2 채팅 패턴 (성능 핵심)
 *
 * - maintainVisibleContentPosition + startRenderingFromBottom:
 *   최신 메시지가 하단에서 시작, 새 메시지 도착 시 하단 근처면 자동 스크롤
 * - onStartReached: 위(과거) 끝에 도달하면 이전 페이지 로드 (스크롤 위치 자동 유지)
 * - 셀 재활용 + React.memo 말풍선으로 대화가 길어져도 프레임을 유지한다
 * - 등장 애니메이션은 첫 렌더 이후 도착한 메시지에만 적용 (히스토리 제외)
 */
import type { ConversationSummary, WireMessage } from '@litechat/types';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  Text,
  View,
} from 'react-native';
import { KeyboardChatScrollView } from 'react-native-keyboard-controller';
import type { SharedValue } from 'react-native-reanimated';
import { loadOlderMessages } from '@/data/data';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';
import { MessageBubble } from './message-bubble';

/** 렌더 항목 — 파생 플래그를 미리 계산해 말풍선 memo가 잘 듣게 한다 */
export interface Row {
  message: WireMessage;
  mine: boolean;
  pending: boolean;
  read: boolean;
  isTail: boolean;
  animate: boolean;
}

interface Props {
  convId: number;
  meId: number;
  messages: WireMessage[];
  conversation: ConversationSummary | undefined;
  onImagePress: (message: WireMessage) => void;
  onMessageLongPress?: (message: WireMessage) => void;
  /** 키보드가 열릴 때 부모가 바닥으로 스크롤하기 위한 ref */
  listRef?: React.Ref<FlashListRef<Row>>;
  /** 입력창이 메시지를 가리지 않도록 확보할 동적 하단 높이 */
  composerHeight: SharedValue<number>;
  /** 최신 메시지 영역에서 벗어났는지 부모에 알린다. */
  onAwayFromBottomChange?: (away: boolean) => void;
  /** 과거 메시지 로드 실패를 채팅방 오류 UI로 전달한다. */
  onLoadError?: (cause: unknown) => void;
}

export function MessageList({
  convId,
  meId,
  messages,
  conversation,
  onImagePress,
  onMessageLongPress,
  listRef,
  composerHeight,
  onAwayFromBottomChange,
  onLoadError,
}: Props) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const loadingOlder = useRef(false);
  const exhausted = useRef(false);
  const awayFromBottom = useRef(false);
  // 첫 렌더에 존재한 메시지 id 집합 — 이후 도착분에만 등장 애니메이션을 준다.
  const [initialIds] = useState(() => new Set(messages.map((m) => m.id)));

  const peerRead = conversation?.peerRead ?? 0;

  // 오름차순 메시지 → 파생 플래그를 포함한 렌더 행
  const rows = useMemo<Row[]>(
    () =>
      messages.map((message, index) => {
        const next = messages[index + 1];
        return {
          message,
          mine: message.s === meId,
          pending: message.id < 0,
          read: message.s === meId && message.id > 0 && peerRead >= message.id,
          // 같은 사람의 연속 메시지 묶음에서 마지막인지 (꼬리와 시간 표시는 마지막에만)
          isTail: !next || next.s !== message.s || next.ts - message.ts > 60,
          animate: !initialIds.has(message.id),
        };
      }),
    [messages, meId, peerRead, initialIds],
  );

  /** 위(과거) 끝에 도달 — 이전 페이지 로드 */
  const onStartReached = useCallback(async () => {
    if (loadingOlder.current || exhausted.current || messages.length < 30) return;
    loadingOlder.current = true;
    try {
      const loaded = await loadOlderMessages(queryClient, convId);
      if (!loaded) exhausted.current = true;
    } catch (cause) {
      onLoadError?.(cause);
    } finally {
      loadingOlder.current = false;
    }
  }, [messages.length, queryClient, convId, onLoadError]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const next = contentSize.height - layoutMeasurement.height - contentOffset.y >= 80;
      if (awayFromBottom.current === next) return;
      awayFromBottom.current = next;
      onAwayFromBottomChange?.(next);
    },
    [onAwayFromBottomChange],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Row>) => (
      <MessageBubble
        message={item.message}
        mine={item.mine}
        pending={item.pending}
        read={item.read}
        isTail={item.isTail}
        animate={item.animate}
        onImagePress={onImagePress}
        onLongPress={item.mine ? undefined : onMessageLongPress}
      />
    ),
    [onImagePress, onMessageLongPress],
  );

  // FlashList의 가상화를 유지하면서 키보드 높이와 스크롤 inset을 UI 스레드에서 동기화한다.
  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <KeyboardChatScrollView
        {...props}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        extraContentPadding={composerHeight}
        keyboardLiftBehavior="always"
        testID="chat-messages"
      />
    ),
    [composerHeight],
  );

  if (messages.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>첫 메시지를 보내 대화를 시작해 보세요 👋</Text>
      </View>
    );
  }

  return (
    <FlashList
      ref={listRef}
      data={rows}
      renderItem={renderItem}
      keyExtractor={(row) => String(row.message.id)}
      maintainVisibleContentPosition={{
        startRenderingFromBottom: true,
        // 하단 근처에 있을 때 새 메시지가 오면 자동으로 따라 내려간다.
        autoscrollToBottomThreshold: 0.2,
      }}
      onStartReached={() => void onStartReached()}
      onStartReachedThreshold={0.3}
      onScroll={onScroll}
      scrollEventThrottle={16}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      renderScrollComponent={renderScrollComponent}
    />
  );
}

const useStyles = makeStyles(({ colors }) => ({
  content: {
    paddingVertical: spacing.md,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  emptyText: {
    fontSize: 14,
    color: colors.inkMute,
    textAlign: 'center',
  },
}));
