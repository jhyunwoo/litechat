/**
 * Full Chat (chat.moveto.kr) 빌드 설정
 *
 * - 개발 시 /api, /ws, /img, 문서 경로를 로컬 서버(:3000)로 프록시한다.
 * - PWA: injectManifest 전략으로 커스텀 서비스 워커(src/sw.ts)를 사용한다
 *   (프리캐시 + Web Push 수신을 한 워커에서 처리).
 * - 산출물은 빌드 시점에 brotli/gzip으로 사전 압축한다 — 서버가 그대로 전송하므로
 *   요청마다의 압축 CPU가 0이다 (프로덕션은 2 OCPU).
 */
import { litechatBuild } from '@litechat/build-tools';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 초기 전송량 예산 (brotli). 현재 실측치(≈121.7 KB)에 약 6%의 여유만 둔다 —
 * 의존성이 조용히 불어나면 빌드가 실패해야 한다.
 * 예산을 올릴 때는 무엇이 늘었고 왜 받아들이는지 함께 남길 것.
 */
const INITIAL_TRANSFER_BUDGET = 128 * 1024;

export default defineConfig({
  plugins: [
    /**
     * React Compiler — 컴포넌트를 자동 메모이제이션한다.
     *
     * 켠 채로 측정한 근거(CPU 4배 스로틀, 실시간 메시지 60개 수신 시나리오, 3회 중앙값):
     *   ScriptDuration 4967 → 4068 ms (−18%)
     *   TaskDuration  11701 → 8681 ms (−26%)
     *   long task 수      64 → 39     (−39%)
     *   60개 수신 완료  10563 → 7550 ms (−28%)
     * 비용은 초기 전송량 +2.4 KB(brotli). 메시지 수신이 앱의 가장 뜨거운 경로라
     * 이 교환은 명백히 이득이다. (네이티브 앱은 app.json의 experiments.reactCompiler로 이미 켜져 있다)
     *
     * MessageBubble의 React.memo는 그대로 둔다 — 컴파일러가 있어도 리스트 항목의
     * 얕은 비교는 여전히 유효하고, 제거해서 좋아진다는 측정 근거가 없다.
     */
    react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } }),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        /**
         * 사전 압축 산출물(.br/.gz)은 반드시 프리캐시에서 제외한다. 포함하면 같은 내용을
         * 세 벌 프리캐시하게 되고(설치 전송량 3배), 서비스 워커가 fetch할 때 어차피
         * Accept-Encoding 협상으로 압축본을 받으므로 아무 이득이 없다.
         * 프리캐시 대상 자체는 기존과 동일하게 둔다(js/css/html + 매니페스트/아이콘) —
         * 라우트 청크까지 포함해야 오프라인에서 로그인/대화 화면이 열린다.
         */
        globPatterns: ['**/*.{js,css,html}'],
        globIgnores: ['**/*.br', '**/*.gz'],
      },
      manifest: {
        name: 'litechat',
        short_name: 'litechat',
        description: '친구와 가볍게 이어지는 1:1 실시간 채팅',
        lang: 'ko',
        display: 'standalone',
        start_url: '/',
        theme_color: '#272729',
        background_color: '#FFFFFF',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
    ...litechatBuild({ label: 'Full Chat', initialBrotliBytes: INITIAL_TRANSFER_BUDGET }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/img': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * 프레임워크 코어를 앱 코드와 분리한다 — 배포마다 바뀌는 것은 앱 청크뿐이라
         * 재방문자는 프레임워크 청크를 캐시에서 그대로 쓴다.
         *
         * 주의: 이전에는 `{ react: ['react','react-dom','react-router'] }` 형태였는데,
         * 이 표기는 패키지의 **진입 모듈만** 매칭한다. 실제 렌더러인
         * react-dom/client(react-dom-client.production.js, 553 KB)는 별개 모듈이라
         * 분리되지 않고 앱 청크에 그대로 들어가 있었다. 모듈 경로로 판정해 확실히 가른다.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
