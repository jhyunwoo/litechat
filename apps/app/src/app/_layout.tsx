/**
 * 루트 레이아웃
 *
 * GestureHandler > Keyboard > Query > Auth 순서로 프로바이더를 쌓고,
 * Stack.Protected로 로그인 여부에 따라 화면 트리를 가른다.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthProvider, useAuth } from '@/data/auth';
import { useRealtimeSync } from '@/data/data';
import { useAppAnalytics } from '@/lib/analytics';
import { useNotificationDeepLink } from '@/lib/notifications';
import { useOTAUpdates } from '@/lib/ota';
import { bindAppState } from '@/lib/ws';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

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
  const { me, ready } = useAuth();

  // 실시간 프레임 → 캐시 반영 (로그인 트리 전체에서 한 번만)
  useRealtimeSync();
  // 알림 탭 → 대화방 딥링크 (콜드 스타트 포함)
  useNotificationDeepLink();
  // OTA 업데이트 — 포그라운드 복귀 시 백그라운드 다운로드, 다음 실행에 적용
  useOTAUpdates();
  // 사용자 분석 — 콜드 스타트/포그라운드 복귀/화면 전환마다 접속 정보를 기록한다
  useAppAnalytics();

  // 앱 백그라운드/활성 전환에 맞춰 소켓을 닫고/재연결한다.
  useEffect(() => bindAppState(), []);

  // 초기 세션 확인이 끝나면 스플래시를 걷는다.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

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
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Root />
          </AuthProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
