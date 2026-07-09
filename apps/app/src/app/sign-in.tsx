/**
 * 로그인 / 회원가입 화면 (웹 AuthPage 포팅 — 한 화면에서 모드 전환)
 *
 * 상단 1/3에 그라디언트 메시 밴드 — DESIGN.md의 브랜드 시그니처.
 */
import { LinearGradient } from 'expo-linear-gradient';
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
import { meshStops, rounded, spacing } from '@/theme/tokens';

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
      {/* 그라디언트 메시 밴드 — 상단 1/3 */}
      <LinearGradient
        colors={meshStops}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.mesh}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.huge, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>litechat</Text>
        <Text style={styles.subtitle}>가볍고 빠른 채팅</Text>

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
  mesh: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '33%',
    opacity: 0.35,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    ...type.displayLg,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...type.caption,
    textAlign: 'center',
    marginBottom: spacing.xxl,
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
    fontSize: 14,
    color: colors.primary,
    fontWeight: '400',
  },
  notice: {
    ...type.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
}));
