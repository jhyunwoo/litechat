/**
 * 채팅 탭 — 대화 목록 (웹 ChatsTab 포팅)
 *
 * iPad(폭 ≥768pt): 2-pane — 좌측 대화 목록 + 우측 인라인 채팅방.
 * iPhone: 목록만, 행 탭 → /chat/[id] 라우트로 push.
 */
import type { ConversationSummary, WireMessage } from '@litechat/types';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  Alert,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/avatar';
import { ChatRoomView } from '@/components/chat-room-view';
import { useAuth } from '@/data/auth';
import { useConversations } from '@/data/data';
import { formatTime } from '@/lib/format';
import { makeStyles, useTheme } from '@/theme/theme';
import { spacing } from '@/theme/tokens';
import { api, errorMessage, unwrap } from '@/lib/api';

/** iPad 2-pane 전환 기준 폭 */
const SPLIT_BREAKPOINT = 768;

/** 마지막 메시지 미리보기 텍스트 */
function preview(last: WireMessage | null): string {
  if (!last) return '대화를 시작해 보세요';
  if (last.k === 'i') return '📷 사진';
  return last.x;
}

function ConversationRow({
  conv,
  selected,
  onPress,
}: {
  conv: ConversationSummary;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        (pressed || selected) && { backgroundColor: colors.canvasSoft },
      ]}
    >
      <Avatar nickname={conv.peer.nickname} size={48} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.nickname} numberOfLines={1}>
            {conv.peer.nickname}
          </Text>
          {conv.last && <Text style={styles.time}>{formatTime(conv.last.ts)}</Text>}
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.preview} numberOfLines={1}>
            {preview(conv.last)}
          </Text>
          {conv.unread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{conv.unread > 99 ? '99+' : conv.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function ChatsTab() {
  const styles = useStyles();
  const { me } = useAuth();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const isSplit = width >= SPLIT_BREAKPOINT;

  const { data: conversations, isPending, refetch, isRefetching } = useConversations();
  // iPad 2-pane에서 우측에 열려 있는 대화방
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = conversations?.find((c) => c.id === selectedId);

  function safetyMenu() {
    if (!selected) return;
    Alert.alert(selected.peer.nickname, '안전 옵션', [
      {
        text: '사용자 신고',
        onPress: () =>
          void (async () => {
            try {
              await unwrap(
                await api.api.safety.reports.$post({
                  json: {
                    userId: selected.peer.id,
                    reason: 'other',
                    details: '사용자 프로필에서 신고',
                  },
                }),
              );
              Alert.alert('신고 접수', '신고가 접수되었어요. 운영팀이 검토합니다.');
            } catch (cause) {
              Alert.alert('신고 실패', errorMessage(cause));
            }
          })(),
      },
      {
        text: '사용자 차단',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            '이 사용자를 차단할까요?',
            '서로 검색, 친구 요청, 대화와 기존 메시지가 보이지 않게 됩니다.',
            [
              { text: '취소', style: 'cancel' },
              {
                text: '차단',
                style: 'destructive',
                onPress: () =>
                  void (async () => {
                    try {
                      await unwrap(
                        await api.api.safety.blocks.$post({ json: { userId: selected.peer.id } }),
                      );
                      setSelectedId(null);
                      await queryClient.invalidateQueries();
                    } catch (cause) {
                      Alert.alert('차단 실패', errorMessage(cause));
                    }
                  })(),
              },
            ],
          ),
      },
      { text: '취소', style: 'cancel' },
    ]);
  }

  const openConversation = useCallback(
    (id: number) => {
      if (isSplit) setSelectedId(id);
      else router.push(`/chat/${id}`);
    },
    [isSplit],
  );

  const list = (
    <View style={[styles.listPane, isSplit && styles.listPaneSplit]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.headerTitle}>채팅</Text>
      </View>

      {isPending ? (
        <Text style={styles.hint}>불러오는 중…</Text>
      ) : conversations?.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>💬</Text>
          <Text style={styles.hint}>
            아직 대화가 없어요.{'\n'}친구 탭에서 친구를 추가하고 대화를 시작해 보세요!
          </Text>
        </View>
      ) : (
        <Animated.View style={{ flex: 1 }} layout={LinearTransition.duration(200)}>
          <FlashList
            data={conversations}
            keyExtractor={(conv) => String(conv.id)}
            renderItem={({ item }) => (
              <ConversationRow
                conv={item}
                selected={isSplit && item.id === selectedId}
                onPress={() => openConversation(item.id)}
              />
            )}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
            }
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.huge }}
          />
        </Animated.View>
      )}
    </View>
  );

  if (!isSplit) return list;

  // iPad 2-pane
  return (
    <View style={styles.split}>
      {list}
      <View style={styles.detailPane}>
        {selected && me ? (
          <>
            <View style={[styles.detailHeader, { paddingTop: insets.top + spacing.sm }]}>
              <Avatar nickname={selected.peer.nickname} size={32} />
              <View>
                <Text style={styles.detailName}>{selected.peer.nickname}</Text>
                <Text style={styles.detailUsername}>@{selected.peer.username}</Text>
              </View>
              <Pressable
                onPress={safetyMenu}
                accessibilityRole="button"
                accessibilityLabel="대화 안전 옵션"
                style={styles.detailMenu}
              >
                <Text style={styles.detailMenuText}>•••</Text>
              </Pressable>
            </View>
            <ChatRoomView convId={selected.id} meId={me.id} />
          </>
        ) : (
          <View style={styles.detailEmpty}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.hint}>대화를 선택하세요</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  split: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.canvas,
  },
  listPane: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  listPaneSplit: {
    flexBasis: 360,
    flexGrow: 0,
    flexShrink: 0,
    width: 360,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.hairline,
  },
  detailPane: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  detailName: { ...type.bodyMd, fontWeight: '400' },
  detailUsername: { ...type.micro },
  detailMenu: {
    marginLeft: 'auto',
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailMenuText: { color: colors.primary, fontSize: 18, letterSpacing: 1 },
  detailEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.canvas,
  },
  headerTitle: {
    ...type.displayMd,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  nickname: {
    ...type.bodyLg,
    fontWeight: '400',
    flexShrink: 1,
  },
  time: {
    fontSize: 12,
    color: colors.inkMute,
    fontVariant: ['tabular-nums'],
  },
  rowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  preview: {
    fontSize: 14,
    color: colors.inkMute,
    flexShrink: 1,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    // 모노크롬 잉크 배지 — onPrimary 텍스트와 짝
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.huge,
  },
  emptyEmoji: { fontSize: 40 },
  hint: {
    paddingVertical: spacing.lg,
    textAlign: 'center',
    fontSize: 14,
    color: colors.inkMute,
    lineHeight: 20,
  },
}));
