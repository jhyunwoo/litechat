/**
 * 프로필 탭 — 내 정보 + 푸시 알림 토글 + 로그아웃 (웹 ProfileTab 포팅)
 *
 * 네이티브 앱이므로 iOS PWA 온보딩은 필요 없다 — 토글이 곧바로
 * 권한 요청 → Expo 토큰 등록으로 이어진다.
 */
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/data/auth';
import { isPushEnabled, registerForPush, unregisterPush } from '@/lib/notifications';
import type { ThemePreference } from '@/lib/theme-pref';
import { makeStyles, useTheme } from '@/theme/theme';
import { rounded, spacing } from '@/theme/tokens';
import { WEB_URL } from '@/lib/env';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
];

export default function ProfileTab() {
  const styles = useStyles();
  const { colors, pref, setPref } = useTheme();
  const { me, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  // 이 기기의 등록 상태로 토글 초기값을 맞춘다.
  useEffect(() => {
    void isPushEnabled()
      .then(setPushOn)
      .catch(() => setPushOn(false));
  }, []);

  async function openLegalPage(path: string) {
    try {
      await Linking.openURL(`${WEB_URL}${path}`);
    } catch {
      Alert.alert('페이지를 열 수 없어요', '인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    }
  }

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

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
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

          <Pressable
            onPress={() => router.push('/blocked-users')}
            accessibilityRole="button"
            style={styles.cardRow}
          >
            <Text style={styles.rowTitle}>차단한 사용자</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <View style={styles.divider} />

          <Pressable
            onPress={() => router.push('/account')}
            accessibilityRole="button"
            style={styles.cardRow}
          >
            <Text style={styles.rowTitle}>계정 관리</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <View style={styles.divider} />

          <Pressable
            onPress={() => void openLegalPage('/privacy')}
            accessibilityRole="link"
            style={styles.cardRow}
          >
            <Text style={styles.rowTitle}>개인정보처리방침</Text>
            <Text style={styles.chevron}>↗</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            onPress={() => void openLegalPage('/terms')}
            accessibilityRole="link"
            style={styles.cardRow}
          >
            <Text style={styles.rowTitle}>이용약관</Text>
            <Text style={styles.chevron}>↗</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            onPress={() => void openLegalPage('/support')}
            accessibilityRole="link"
            style={styles.cardRow}
          >
            <Text style={styles.rowTitle}>지원 및 문의</Text>
            <Text style={styles.chevron}>↗</Text>
          </Pressable>
          <View style={styles.divider} />

          {/* 화면 테마 — 시스템 추종 또는 수동 고정 */}
          <View style={styles.cardRow}>
            <View style={styles.cardRowText}>
              <Text style={styles.rowTitle}>화면 테마</Text>
            </View>
            <View style={styles.segments}>
              {THEME_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setPref(option.value)}
                  style={[styles.segment, pref === option.value && styles.segmentOn]}
                >
                  <Text
                    style={[styles.segmentLabel, pref === option.value && styles.segmentLabelOn]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.divider} />

          {/* 로그아웃 */}
          <Pressable
            onPress={() =>
              void logout().catch(() =>
                Alert.alert('로그아웃할 수 없어요', '잠시 후 다시 시도해 주세요.'),
              )
            }
            style={({ pressed }) => [
              styles.cardRow,
              pressed && { backgroundColor: colors.canvasSoft },
            ]}
          >
            <Text style={styles.logout}>로그아웃</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>litechat</Text>
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
  chevron: { fontSize: 20, color: colors.inkMute },
  segments: {
    flexDirection: 'row',
    backgroundColor: colors.canvasSoft,
    borderRadius: rounded.pill,
    padding: 2,
  },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: rounded.pill,
  },
  segmentOn: {
    backgroundColor: colors.primary,
  },
  segmentLabel: {
    fontSize: 13,
    color: colors.inkMute,
  },
  segmentLabelOn: {
    color: colors.onPrimary,
    fontWeight: '500',
  },
  footer: {
    textAlign: 'center',
    paddingVertical: spacing.xxl,
    fontSize: 12,
    color: colors.inkMute,
    opacity: 0.6,
  },
}));
