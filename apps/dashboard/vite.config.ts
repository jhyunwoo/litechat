/**
 * 관리자 대시보드 (dash.moveto.kr) 빌드 설정
 *
 * apps/web과 달리 오프라인/푸시가 필요 없는 내부 도구라 PWA 플러그인은 제외한다.
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
