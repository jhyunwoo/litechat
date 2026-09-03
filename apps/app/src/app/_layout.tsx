/**
 * 루트 레이아웃
 *
 * GestureHandler > Keyboard > Query > Auth 순서로 프로바이더를 쌓고,
 * Stack.Protected로 로그인 여부에 따라 화면 트리를 가른다.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { AuthProvider, useAuth } from '@/data/auth';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { useRealtimeSync } from '@/data/data';
import { useAppAnalytics } from '@/lib/analytics';
import { useNotificationDeepLink, useNotificationReceivedAck } from '@/lib/notifications';
import { useOTAUpdates } from '@/lib/ota';
import { bindAppState } from '@/lib/ws';
import { ThemeProvider, useTheme } from '@/theme/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Root() {
  const { me, ready, bootstrapError, retryBootstrap } = useAuth();
  const { colors } = useTheme();

  // 실시간 프레임 → 캐시 반영 (로그인 트리 전체에서 한 번만)
  useRealtimeSync();
  // 알림 탭 → 대화방 딥링크 (콜드 스타트 포함) — Stack이 마운트된 뒤에만 push
  useNotificationDeepLink(ready);
  // 알림 수신 ACK — 프로세스가 살아있는 동안 도착한 알림은 서버에 수신 시각을 기록한다
  useNotificationReceivedAck();
  // OTA 업데이트 — 포그라운드 복귀 시 백그라운드 다운로드, 다음 실행에 적용.
  // 콜드 스타트 확인은 ready 이후로 미뤄 인증/실시간 연결과 대역폭을 다투지 않게 한다.
  useOTAUpdates(ready);
  // 사용자 분석 — 콜드 스타트/포그라운드 복귀/화면 전환마다 접속 정보를 기록한다 (ready 이후)
  useAppAnalytics(ready);

  // 앱 백그라운드/활성 전환에 맞춰 소켓을 닫고/재연결한다.
  useEffect(() => bindAppState(), []);

  // 초기 세션 확인이 끝나면 스플래시를 걷는다.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // 세션 확인이 끝나기 전에는 Stack을 렌더하지 않는다 — 네이티브 스플래시가
  // 화면을 덮은 채 대기하므로, sign-in을 미리 마운트해 생기는 로그인 화면
  // 플래시가 사라진다. ready 이후 곧바로 올바른 브랜치로 마운트된다.
  if (!ready) return null;

  if (bootstrapError) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          backgroundColor: colors.canvas,
        }}
        accessibilityRole="alert"
      >
        <Text style={{ fontSize: 20, fontWeight: '600', color: colors.ink }}>
          서버에 연결할 수 없어요
        </Text>
        <Text style={{ marginTop: 8, color: colors.inkMute, textAlign: 'center' }}>
          인터넷 연결을 확인한 뒤 다시 시도해 주세요.
        </Text>
        <Pressable
          onPress={retryBootstrap}
          style={{
            marginTop: 24,
            minHeight: 48,
            borderRadius: 999,
            paddingHorizontal: 28,
            backgroundColor: colors.primary,
            justifyContent: 'center',
          }}
          accessibilityRole="button"
        >
          <Text style={{ color: colors.onPrimary, fontSize: 16 }}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Protected guard={!!me}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="account" />
        <Stack.Screen name="blocked-users" />
      </Stack.Protected>
      <Stack.Protected guard={!me}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* 접근성 '동작 줄이기'를 켠 기기에서는 모든 애니메이션을 끈다 */}
      <ReducedMotionConfig mode={ReduceMotion.System} />
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <AppErrorBoundary>
            <AuthProvider>
              <ThemeProvider>
                {/* auto — Appearance 유효 스킴(수동 오버라이드 포함)을 따라간다 */}
                <StatusBar style="auto" />
                <Root />
              </ThemeProvider>
            </AuthProvider>
          </AppErrorBoundary>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
