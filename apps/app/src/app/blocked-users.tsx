import type { BlockedUser } from '@litechat/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { api, errorMessage, unwrap } from '@/lib/api';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';

export default function BlockedUsersScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['blocked-users'],
    queryFn: async () =>
      (await unwrap<{ blocks: BlockedUser[] }>(await api.api.safety.blocks.$get())).blocks,
  });

  async function unblock(item: BlockedUser) {
    try {
      await unwrap(
        await api.api.safety.blocks[':userId'].$delete({ param: { userId: String(item.user.id) } }),
      );
      await queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
    } catch (cause) {
      Alert.alert('차단 해제 실패', errorMessage(cause));
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          hitSlop={8}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>차단한 사용자</Text>
      </View>
      <View style={styles.content}>
        {query.isPending ? <Text style={styles.hint}>불러오는 중…</Text> : null}
        {query.isError ? (
          <Pressable onPress={() => void query.refetch()}>
            <Text style={styles.error}>목록을 불러오지 못했어요. 다시 시도</Text>
          </Pressable>
        ) : null}
        {query.data?.length === 0 ? <Text style={styles.hint}>차단한 사용자가 없어요.</Text> : null}
        {query.data?.map((item) => (
          <View key={item.user.id} style={styles.row}>
            <Avatar nickname={item.user.nickname} size={40} />
            <View style={styles.identity}>
              <Text style={styles.nickname}>{item.user.nickname}</Text>
              <Text style={styles.username}>@{item.user.username}</Text>
            </View>
            <Pressable
              onPress={() => void unblock(item)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.unblock, pressed && styles.unblockPressed]}
            >
              <Text style={styles.unblockLabel}>차단 해제</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  back: { width: 40, fontSize: 32, lineHeight: 36, color: colors.link },
  title: { ...type.headingMd },
  content: { padding: spacing.lg, maxWidth: 620, width: '100%', alignSelf: 'center' },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  identity: { flex: 1 },
  nickname: { color: colors.ink, fontSize: 15 },
  username: { color: colors.inkMute, fontSize: 12 },
  unblock: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center' },
  unblockPressed: { opacity: 0.5, transform: [{ scale: 0.95 }] },
  unblockLabel: { color: colors.link, textDecorationLine: 'underline' },
  hint: { color: colors.inkMute, textAlign: 'center', marginTop: spacing.xl },
  error: { color: colors.ruby, textAlign: 'center', marginTop: spacing.xl },
}));
