/**
 * Full Chat 진입점
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { bootstrapAnalytics } from './analytics';
import { AuthProvider } from './auth';
import './styles.css';

bootstrapAnalytics();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 채팅 데이터는 WS 프레임으로 갱신되므로 자동 refetch를 줄여 트래픽을 아낀다.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/*
      LazyMotion features={domAnimation}: 애니메이션 + 탭/호버 제스처만 싣는다.
      드래그와 공유 레이아웃(projection)은 앱에서 쓰지 않으므로 번들에서 제외된다
      (vendor 청크 −11.9 KB brotli). strict는 무거운 `motion.*` 대신 `m.*`만
      쓰도록 강제해, 나중에 실수로 전체 기능 번들이 다시 딸려 들어오는 것을 막는다.
    */}
    <LazyMotion features={domAnimation} strict>
      {/* reducedMotion="user" — OS의 '동작 줄이기'를 켠 사용자에게는 모든 모션을 끈다 */}
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
);
