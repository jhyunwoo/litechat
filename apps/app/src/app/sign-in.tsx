/**
 * 로그인 / 회원가입 화면 (웹 AuthPage 포팅 — 한 화면에서 모드 전환)
 *
 * 상단은 잉크 블랙 히어로 밴드(워드마크) — 웹 AuthPage의 블랙 타일과 같은 문법.
 * 밴드 색은 스킴과 무관한 브랜드 블랙이라 팔레트가 아닌 상수로 둔다.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/data/auth';
import { errorMessage } from '@/lib/api';
import { makeStyles, useTheme } from '@/theme/theme';
import { rounded, spacing } from '@/theme/tokens';

/* 브랜드 히어로 타일 — 라이트/다크 공통 (DESIGN.md 잉크 블랙 + 화이트) */
const HERO_BG = '#1d1d1f';
const HERO_INK = '#ffffff';
const HERO_INK_MUTE = 'rgba(255, 255, 255, 0.7)';

export default function SignIn() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { login, register } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  async function submit() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (isRegister) await register({ username, password, nickname });
      else await login({ username, password });
      // 성공하면 Stack.Protected 가드가 (tabs)로 전환한다.
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      {/* 브랜드 히어로 — 잉크 블랙 타일 (표면 색 전환이 곧 구획) */}
      <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
        <Text style={styles.heroTitle}>litechat</Text>
        <Text style={styles.heroTagline}>가볍고 빠른 채팅</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="아이디 (영문 소문자/숫자/_)"
            placeholderTextColor={colors.inkMute}
            value={username}
            onChangeText={(text) => setUsername(text.toLowerCase())}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            maxLength={20}
          />
          {isRegister && (
            <Animated.View entering={FadeIn.duration(180)}>
              <TextInput
                style={styles.input}
                placeholder="닉네임"
                placeholderTextColor={colors.inkMute}
                value={nickname}
                onChangeText={setNickname}
                maxLength={20}
              />
            </Animated.View>
          )}
          <TextInput
            style={styles.input}
            placeholder="비밀번호 (8자 이상)"
            placeholderTextColor={colors.inkMute}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            maxLength={72}
            onSubmitEditing={() => void submit()}
          />

          {error !== '' && <Text style={styles.error}>{error}</Text>}

          {/* button-primary-pill — 밴드당 하나뿐인 채워진 인디고 CTA */}
          <Pressable
            onPress={() => void submit()}
            disabled={busy}
            style={({ pressed }) => [
              styles.cta,
              pressed && styles.ctaPressed,
              busy && styles.ctaBusy,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.ctaLabel}>{isRegister ? '가입하기' : '로그인'}</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchHint}>
            {isRegister ? '이미 계정이 있나요? ' : '처음이신가요? '}
          </Text>
          <Pressable
            onPress={() => {
              setMode(isRegister ? 'login' : 'register');
              setError('');
            }}
            hitSlop={8}
          >
            <Text style={styles.switchLink}>{isRegister ? '로그인' : '가입하기'}</Text>
          </Pressable>
        </View>

        <Text style={styles.notice}>서비스 개선을 위해 접속 IP·기기 정보 등을 수집해요.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  hero: {
    backgroundColor: HERO_BG,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },
  heroTitle: {
    ...type.displayLg,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1,
    color: HERO_INK,
  },
  heroTagline: {
    /* 드문 300 웨이트 — 히어로 태그라인 전용 (DESIGN.md lead-airy) */
    fontSize: 15,
    fontWeight: '300',
    color: HERO_INK_MUTE,
    marginTop: spacing.xs,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  form: {
    gap: spacing.md,
  },
  input: {
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.hairlineInput,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    minHeight: 44,
  },
  error: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.ruby,
  },
  cta: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: rounded.pill,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  ctaPressed: { backgroundColor: colors.primaryPress },
  ctaBusy: { opacity: 0.6 },
  ctaLabel: {
    ...type.buttonMd,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  switchHint: {
    fontSize: 14,
    color: colors.inkMute,
  },
  switchLink: {
    /* 모노크롬에선 색만으로 링크가 안 드러나서 웨이트+밑줄로 신호를 준다 */
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  notice: {
    ...type.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
}));
