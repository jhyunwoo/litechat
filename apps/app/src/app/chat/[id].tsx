/**
 * 채팅방 라우트 (iPhone) — 글래스 헤더 + ChatRoomView
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { ChatRoomView } from '@/components/chat-room-view';
import { Glass } from '@/components/glass';
import { useAuth } from '@/data/auth';
import { useConversations } from '@/data/data';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';
import { api, errorMessage, unwrap } from '@/lib/api';

export default function ChatRoomScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = Number(id);
  const { me } = useAuth();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: conversations } = useConversations();
  const conversation = conversations?.find((c) => c.id === convId);

  if (!me || !Number.isFinite(convId)) return null;

  function safetyMenu() {
    if (!conversation) return;
    Alert.alert(conversation.peer.nickname, '안전 옵션', [
      {
        text: '사용자 신고',
        onPress: () =>
          void (async () => {
            try {
              await unwrap(
                await api.api.safety.reports.$post({
                  json: {
                    userId: conversation.peer.id,
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
                        await api.api.safety.blocks.$post({
                          json: { userId: conversation.peer.id },
                        }),
                      );
                      await queryClient.invalidateQueries();
                      router.replace('/');
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

  return (
    <View style={styles.screen}>
      {/* 글래스 헤더 — 콘텐츠가 뒤로 비쳐 보인다 */}
      <Glass style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityLabel="뒤로"
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.5 }]}
        >
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Avatar nickname={conversation?.peer.nickname ?? '?'} size={36} />
        <View style={styles.headerText}>
          <Text style={styles.peerName} numberOfLines={1}>
            {conversation?.peer.nickname ?? '대화'}
          </Text>
          {conversation && <Text style={styles.peerUsername}>@{conversation.peer.username}</Text>}
        </View>
        <Pressable
          onPress={safetyMenu}
          accessibilityRole="button"
          accessibilityLabel="대화 안전 옵션"
          hitSlop={8}
          style={({ pressed }) => [styles.menu, pressed && styles.menuPressed]}
        >
          <Text style={styles.menuText}>•••</Text>
        </Pressable>
      </Glass>

      <ChatRoomView convId={convId} meId={me.id} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    zIndex: 1,
  },
  back: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backArrow: {
    fontSize: 30,
    lineHeight: 32,
    color: colors.link,
  },
  headerText: { flex: 1, minWidth: 0 },
  menu: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  menuPressed: { opacity: 0.5, transform: [{ scale: 0.95 }] },
  menuText: { color: colors.link, fontSize: 18, letterSpacing: 1 },
  peerName: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.ink,
  },
  peerUsername: {
    fontSize: 12,
    color: colors.inkMute,
  },
}));
