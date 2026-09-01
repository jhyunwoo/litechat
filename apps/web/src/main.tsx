/**
 * Full Chat 진입점
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
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
  </StrictMode>,
);
