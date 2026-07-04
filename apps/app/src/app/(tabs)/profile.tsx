/**
 * 프로필 탭 — 내 정보 + 푸시 알림 토글 + 로그아웃 (웹 ProfileTab 포팅)
 *
 * 네이티브 앱이므로 iOS PWA 온보딩은 필요 없다 — 토글이 곧바로
 * 권한 요청 → Expo 토큰 등록으로 이어진다.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/data/auth';
import { isPushEnabled, registerForPush, unregisterPush } from '@/lib/notifications';
import { colors, rounded, spacing, type } from '@/theme/tokens';

export default function ProfileTab() {
  const { me, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  // 이 기기의 등록 상태로 토글 초기값을 맞춘다.
  useEffect(() => {
    void isPushEnabled().then(setPushOn);
  }, []);

  async function togglePush(next: boolean) {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (next) {
        setPushOn(await registerForPush());
      } else {
        await unregisterPush();
        setPushOn(false);
      }
    } catch {
      setPushOn(false);
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.headerTitle}>프로필</Text>
      </View>

      <View style={styles.identity}>
        <Avatar nickname={me?.nickname ?? '?'} size={80} />
        <Text style={styles.nickname}>{me?.nickname}</Text>
        <Text style={styles.username}>@{me?.username}</Text>
      </View>

      <View style={styles.card}>
        {/* 푸시 알림 토글 */}
        <View style={styles.cardRow}>
          <View style={styles.cardRowText}>
            <Text style={styles.rowTitle}>푸시 알림</Text>
            <Text style={styles.rowHint}>접속 중이 아닐 때 새 메시지를 알려드려요</Text>
          </View>
          <Switch
            value={pushOn}
            onValueChange={(next) => void togglePush(next)}
            disabled={pushBusy}
            trackColor={{ true: colors.primary, false: colors.hairlineInput }}
          />
        </View>

        <View style={styles.divider} />

        {/* 로그아웃 */}
        <Pressable
          onPress={() => void logout()}
          style={({ pressed }) => [
            styles.cardRow,
            pressed && { backgroundColor: colors.canvasSoft },
          ]}
        >
          <Text style={styles.logout}>로그아웃</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>LiteChat</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerTitle: {
    ...type.displayMd,
  },
  identity: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  nickname: {
    fontSize: 18,
    fontWeight: '400',
    color: colors.ink,
  },
  username: {
    fontSize: 14,
    color: colors.inkMute,
  },
  card: {
    marginHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: rounded.lg,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    minHeight: 52,
  },
  cardRowText: { flex: 1 },
  rowTitle: {
    ...type.bodyMd,
    fontWeight: '400',
  },
  rowHint: {
    fontSize: 12,
    color: colors.inkMute,
    marginTop: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
  logout: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.ruby,
  },
  footer: {
    textAlign: 'center',
    paddingVertical: spacing.xxl,
    fontSize: 12,
    color: colors.inkMute,
    opacity: 0.6,
  },
});
