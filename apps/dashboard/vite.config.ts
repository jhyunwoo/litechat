/**
 * 관리자 대시보드 (dash.moveto.kr) 빌드 설정
 *
 * apps/web과 달리 오프라인/푸시가 필요 없는 내부 도구라 PWA 플러그인은 제외한다.
 * 산출물은 web/lite와 동일하게 빌드 시점에 brotli/gzip으로 사전 압축한다 —
 * 서버(static.ts)가 그대로 전송하므로 요청마다의 압축 CPU가 0이다.
 */
import { litechatBuild } from '@litechat/build-tools';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * 초기 전송량 예산 (brotli). recharts(85 KB)와 Google Maps 래퍼는 각각의 라우트에서만
 * 로드돼야 하며, 진입 청크로 다시 새어 들어오면 이 예산에서 즉시 걸린다.
 */
const INITIAL_TRANSFER_BUDGET = 78 * 1024;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...litechatBuild({ label: '대시보드', initialBrotliBytes: INITIAL_TRANSFER_BUDGET }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        // web과 같은 이유로 프레임워크 코어를 앱 코드와 분리해 배포 간 캐시를 유지한다.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) return 'react';
        },
      },
    },
  },
});
