/**
 * 프로필 탭 — 내 정보 + 푸시 알림 토글 + 로그아웃 (웹 ProfileTab 포팅)
 *
 * 네이티브 앱이므로 iOS PWA 온보딩은 필요 없다 — 토글이 곧바로
 * 권한 요청 → Expo 토큰 등록으로 이어진다.
 */
import { useTranslation } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/data/auth';
import { isPushEnabled, registerForPush, unregisterPush } from '@/lib/notifications';
import type { ThemePreference } from '@/lib/theme-pref';
import { makeStyles, useTheme } from '@/theme/theme';
import { rounded, spacing } from '@/theme/tokens';
import { WEB_URL } from '@/lib/env';

const THEME_OPTIONS: { value: ThemePreference; label: '시스템' | '라이트' | '다크' }[] = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
];

/** 선택 필이 미끄러지는 스프링 — iOS 세그먼트 컨트롤 감각 */
const SEGMENT_SPRING = { stiffness: 420, damping: 34, mass: 0.7 } as const;

/** 화면 테마 세그먼트 — 선택된 칸으로 Action Blue 필이 미끄러진다 */
function ThemeSegments({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
}) {
  const t = useTranslation();
  const styles = useStyles();
  // 각 칸의 실제 위치/폭을 측정해 그 위로 필을 옮긴다 (라벨 길이가 언어마다 다르다).
  const [frames, setFrames] = useState<{ x: number; width: number }[]>([]);
  const x = useSharedValue(0);
  const width = useSharedValue(0);

  const index = THEME_OPTIONS.findIndex((option) => option.value === value);
  const frame = frames[index];

  useEffect(() => {
    if (!frame) return;
    // 첫 측정에는 애니메이션 없이 자리를 잡고, 이후 전환만 스프링으로 움직인다.
    if (width.value === 0) {
      x.set(frame.x);
      width.set(frame.width);
      return;
    }
    x.set(withSpring(frame.x, SEGMENT_SPRING));
    width.set(withSpring(frame.width, SEGMENT_SPRING));
  }, [frame, x, width]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: width.value,
  }));

  const onSegmentLayout = useCallback((event: LayoutChangeEvent, position: number) => {
    const { x: left, width: size } = event.nativeEvent.layout;
    setFrames((previous) => {
      const next = [...previous];
      next[position] = { x: left, width: size };
      return next;
    });
  }, []);

  return (
    <View style={styles.segments}>
      {frames.length > 0 && <Animated.View style={[styles.segmentPill, pillStyle]} />}
      {THEME_OPTIONS.map((option, position) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          onLayout={(event) => onSegmentLayout(event, position)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option.value }}
          style={styles.segment}
        >
          <Text style={[styles.segmentLabel, value === option.value && styles.segmentLabelOn]}>
            {t(option.label)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function ProfileTab() {
  const t = useTranslation();
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
      Alert.alert(t('페이지를 열 수 없어요'), t('인터넷 연결을 확인한 뒤 다시 시도해 주세요.'));
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
        <Text style={styles.headerTitle}>{t('프로필')}</Text>
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
              <Text style={styles.rowTitle}>{t('푸시 알림')}</Text>
              <Text style={styles.rowHint}>{t('접속 중이 아닐 때 새 메시지를 알려드려요')}</Text>
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
            <Text style={styles.rowTitle}>{t('차단한 사용자')}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <View style={styles.divider} />

          <Pressable
            onPress={() => router.push('/account')}
            accessibilityRole="button"
            style={styles.cardRow}
          >
            <Text style={styles.rowTitle}>{t('계정 관리')}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <View style={styles.divider} />

          <Pressable
            onPress={() => void openLegalPage('/privacy')}
            accessibilityRole="link"
            style={styles.cardRow}
          >
            <Text style={styles.rowTitle}>{t('개인정보처리방침')}</Text>
            <Text style={styles.chevron}>↗</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            onPress={() => void openLegalPage('/terms')}
            accessibilityRole="link"
            style={styles.cardRow}
          >
            <Text style={styles.rowTitle}>{t('이용약관')}</Text>
            <Text style={styles.chevron}>↗</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            onPress={() => void openLegalPage('/support')}
            accessibilityRole="link"
            style={styles.cardRow}
          >
            <Text style={styles.rowTitle}>{t('지원 및 문의')}</Text>
            <Text style={styles.chevron}>↗</Text>
          </Pressable>
          <View style={styles.divider} />

          {/* 화면 테마 — 시스템 추종 또는 수동 고정 */}
          <View style={styles.cardRow}>
            <View style={styles.cardRowText}>
              <Text style={styles.rowTitle}>{t('화면 테마')}</Text>
            </View>
            <ThemeSegments value={pref} onChange={setPref} />
          </View>

          <View style={styles.divider} />

          {/* 로그아웃 */}
          <Pressable
            onPress={() =>
              void logout().catch(() =>
                Alert.alert(t('로그아웃할 수 없어요'), t('잠시 후 다시 시도해 주세요.')),
              )
            }
            style={({ pressed }) => [
              styles.cardRow,
              pressed && { backgroundColor: colors.canvasSoft },
            ]}
          >
            <Text style={styles.logout}>{t('로그아웃')}</Text>
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
    fontWeight: '600',
    color: colors.ruby,
  },
  chevron: { fontSize: 20, color: colors.inkMute },
  segments: {
    flexDirection: 'row',
    backgroundColor: colors.canvasSoft,
    borderRadius: rounded.pill,
    padding: 2,
  },
  /** 선택 표시 — 칸 위를 미끄러지는 Action Blue 필 */
  segmentPill: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: rounded.pill,
    backgroundColor: colors.primary,
  },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: rounded.pill,
  },
  segmentLabel: {
    fontSize: 13,
    color: colors.inkMute,
  },
  segmentLabelOn: {
    color: colors.onPrimary,
    // 웨이트 사다리는 300/400/600/700 — 500은 시스템에 없다
    fontWeight: '600',
  },
  footer: {
    textAlign: 'center',
    paddingVertical: spacing.xxl,
    fontSize: 12,
    color: colors.inkMute,
    opacity: 0.6,
  },
}));
