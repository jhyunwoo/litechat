import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/data/auth';
import { errorMessage } from '@/lib/api';
import { makeStyles, useTheme } from '@/theme/theme';
import { rounded, spacing } from '@/theme/tokens';

export default function AccountScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { deleteAccount } = useAuth();
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function confirmDeletion() {
    if (password.length < 8 || busy) return;
    Alert.alert(
      '계정을 영구 삭제할까요?',
      '프로필, 친구 관계, 대화와 메시지, 업로드한 사진, 알림 토큰 및 계정에 연결된 분석 데이터가 삭제됩니다. 이 작업은 되돌릴 수 없어요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '영구 삭제',
          style: 'destructive',
          onPress: () => void performDeletion(),
        },
      ],
    );
  }

  async function performDeletion() {
    setBusy(true);
    setError('');
    try {
      await deleteAccount(password);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          hitSlop={8}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>계정 관리</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>계정 삭제</Text>
        <Text style={styles.body}>
          로그아웃이나 비활성화가 아닌 영구 삭제입니다. 프로필, 친구 관계, 대화와 메시지, 업로드한
          사진, 푸시 토큰 및 계정에 연결된 분석 데이터가 삭제됩니다.
        </Text>
        <Text style={styles.label}>현재 비밀번호로 확인</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          placeholder="비밀번호"
          placeholderTextColor={colors.inkMute}
          maxLength={72}
          style={styles.input}
          accessibilityLabel="현재 비밀번호"
        />
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Pressable
          onPress={confirmDeletion}
          disabled={busy || password.length < 8}
          accessibilityRole="button"
          accessibilityLabel="계정 영구 삭제"
          style={[styles.deleteButton, (busy || password.length < 8) && styles.disabled]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.deleteLabel}>계정 영구 삭제</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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
  content: { padding: spacing.xl, maxWidth: 560, width: '100%', alignSelf: 'center' },
  heading: { ...type.headingLg },
  body: { ...type.bodyMd, color: colors.inkSecondary, marginTop: spacing.md, lineHeight: 23 },
  label: { ...type.caption, color: colors.ink, marginTop: spacing.xl, marginBottom: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.hairlineInput,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.ink,
  },
  error: { color: colors.ruby, marginTop: spacing.sm, fontSize: 13 },
  deleteButton: {
    minHeight: 50,
    marginTop: spacing.xl,
    borderRadius: rounded.pill,
    backgroundColor: colors.ruby,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45 },
  deleteLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
}));
