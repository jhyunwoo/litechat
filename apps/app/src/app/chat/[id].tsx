/**
 * 채팅방 라우트 (iPhone) — 글래스 헤더 + ChatRoomView
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { ChatRoomView } from '@/components/chat-room-view';
import { Glass } from '@/components/glass';
import { useAuth } from '@/data/auth';
import { useConversations } from '@/data/data';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';

export default function ChatRoomScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = Number(id);
  const { me } = useAuth();
  const insets = useSafeAreaInsets();

  const { data: conversations } = useConversations();
  const conversation = conversations?.find((c) => c.id === convId);

  if (!me || !Number.isFinite(convId)) return null;

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
    color: colors.primary,
  },
  headerText: { flex: 1, minWidth: 0 },
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
