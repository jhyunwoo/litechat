/**
 * 친구 탭 — 아이디 검색 → 친구 요청 → 수락/거절 → 친구 목록 (웹 FriendsTab 포팅)
 */
import type { PublicUser } from '@litechat/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { useFriendRequests, useFriends } from '@/data/data';
import { api, errorMessage, unwrap } from '@/lib/api';
import { makeStyles, useTheme } from '@/theme/theme';
import { rounded, spacing } from '@/theme/tokens';

type SearchUser = PublicUser & { rel: string };

/** 검색 결과의 관계 상태 → 버튼/라벨 */
function RelationAction({ user, onAdd }: { user: SearchUser; onAdd: (id: number) => void }) {
  const styles = useStyles();
  switch (user.rel) {
    case 'self':
      return <Text style={styles.relLabel}>나</Text>;
    case 'friends':
      return <Text style={styles.relLabel}>친구</Text>;
    case 'pending_out':
      return <Text style={styles.relLabel}>요청됨</Text>;
    case 'pending_in':
      return <Text style={styles.relLink}>받은 요청 확인</Text>;
    default:
      return (
        <Pressable
          onPress={() => onAdd(user.id)}
          style={({ pressed }) => [styles.pillButton, pressed && styles.pillPressed]}
        >
          <Text style={styles.pillLabel}>친구 추가</Text>
        </Pressable>
      );
  }
}

export default function FriendsTab() {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [notice, setNotice] = useState('');

  const { data: friends } = useFriends();
  const { data: requests } = useFriendRequests();

  // 입력 250ms 디바운스 — 타이핑마다 요청하지 않는다.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: searchResults } = useQuery({
    queryKey: ['search', debounced],
    queryFn: async () => {
      const res = await api.api.friends.search.$get({ query: { q: debounced } });
      return (await unwrap<{ users: SearchUser[] }>(res)).users;
    },
    enabled: debounced.length > 0,
  });

  const addFriend = useMutation({
    mutationFn: async (userId: number) => {
      const res = await api.api.friends.requests.$post({ json: { userId } });
      await unwrap(res);
    },
    onSuccess: () => {
      setNotice('친구 요청을 보냈어요!');
      void queryClient.invalidateQueries({ queryKey: ['search'] });
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  const respond = useMutation({
    mutationFn: async ({ id, accept }: { id: number; accept: boolean }) => {
      const res = await api.api.friends.requests[':id'].respond.$post({
        param: { id: String(id) },
        json: { accept },
      });
      await unwrap(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.headerTitle}>친구</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="아이디로 검색"
          placeholderTextColor={colors.inkMute}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.huge }}
      >
        {notice !== '' && (
          <Pressable onPress={() => setNotice('')}>
            <Text style={styles.notice}>{notice}</Text>
          </Pressable>
        )}

        {/* 검색 결과 */}
        {debounced !== '' && (
          <Animated.View entering={FadeIn.duration(150)} style={styles.section}>
            <Text style={styles.sectionTitle}>검색 결과</Text>
            {searchResults?.length === 0 && (
              <Text style={styles.sectionHint}>‘{debounced}’ 사용자를 찾지 못했어요.</Text>
            )}
            {searchResults?.map((user) => (
              <View key={user.id} style={styles.personRow}>
                <View style={styles.personInfo}>
                  <Text style={styles.personName}>{user.nickname}</Text>
                  <Text style={styles.personUsername}>@{user.username}</Text>
                </View>
                <RelationAction user={user} onAdd={(id) => addFriend.mutate(id)} />
              </View>
            ))}
          </Animated.View>
        )}

        {/* 받은 친구 요청 */}
        {requests && requests.incoming.length > 0 && (
          <Animated.View layout={LinearTransition.duration(200)} style={styles.section}>
            <Text style={styles.sectionTitle}>받은 요청</Text>
            {requests.incoming.map((request) => (
              <View key={request.id} style={styles.personRow}>
                <View style={styles.personInfo}>
                  <Text style={styles.personName}>{request.user.nickname}</Text>
                  <Text style={styles.personUsername}>@{request.user.username}</Text>
                </View>
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => respond.mutate({ id: request.id, accept: true })}
                    style={({ pressed }) => [styles.pillButton, pressed && styles.pillPressed]}
                  >
                    <Text style={styles.pillLabel}>수락</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => respond.mutate({ id: request.id, accept: false })}
                    style={({ pressed }) => [styles.pillGhost, pressed && styles.pillGhostPressed]}
                  >
                    <Text style={styles.pillGhostLabel}>거절</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </Animated.View>
        )}

        {/* 친구 목록 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>친구 {friends?.length ?? 0}</Text>
          {friends?.length === 0 && (
            <Text style={styles.sectionHint}>위 검색창에서 아이디로 친구를 찾아보세요.</Text>
          )}
          {friends?.map(({ user, c }) => (
            <Pressable
              key={user.id}
              onPress={() => router.push(`/chat/${c}`)}
              style={({ pressed }) => [
                styles.friendRow,
                pressed && { backgroundColor: colors.canvasSoft },
              ]}
            >
              <Avatar nickname={user.nickname} size={40} variant="dark" />
              <View style={styles.personInfo}>
                <Text style={styles.personName} numberOfLines={1}>
                  {user.nickname}
                </Text>
                <Text style={styles.personUsername}>@{user.username}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    gap: spacing.md,
  },
  headerTitle: {
    ...type.displayMd,
  },
  search: {
    backgroundColor: colors.canvasSoft,
    borderRadius: rounded.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    minHeight: 40,
  },
  notice: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    textAlign: 'center',
    fontSize: 14,
    color: colors.primary,
  },
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    fontSize: 12,
    fontWeight: '500',
    color: colors.inkMute,
  },
  sectionHint: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 14,
    color: colors.inkMute,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  personInfo: { flex: 1, minWidth: 0 },
  personName: {
    ...type.bodyMd,
    fontWeight: '400',
  },
  personUsername: {
    fontSize: 12,
    color: colors.inkMute,
  },
  relLabel: {
    fontSize: 12,
    color: colors.inkMute,
  },
  relLink: {
    fontSize: 12,
    color: colors.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pillButton: {
    backgroundColor: colors.primary,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 32,
    justifyContent: 'center',
  },
  pillPressed: { backgroundColor: colors.primaryPress },
  pillLabel: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '400',
  },
  pillGhost: {
    backgroundColor: colors.hairline,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 32,
    justifyContent: 'center',
  },
  pillGhostPressed: { opacity: 0.7 },
  pillGhostLabel: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '400',
  },
}));
