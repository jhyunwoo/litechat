/**
 * Full Chat (chat.moveto.kr) 빌드 설정
 *
 * - 개발 시 /api, /ws, /img, 문서 경로를 로컬 서버(:3000)로 프록시한다.
 * - PWA: injectManifest 전략으로 커스텀 서비스 워커(src/sw.ts)를 사용한다
 *   (프리캐시 + Web Push 수신을 한 워커에서 처리).
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'litechat',
        short_name: 'litechat',
        description: '가볍고 빠른 실시간 채팅',
        lang: 'ko',
        display: 'standalone',
        start_url: '/',
        theme_color: '#1d1d1f',
        background_color: '#ffffff',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/img': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    // 진입 청크를 작게 유지하기 위한 수동 분할 — 초기 로딩 속도 최우선
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
        },
      },
    },
  },
});
