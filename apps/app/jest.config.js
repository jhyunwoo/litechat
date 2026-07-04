/** Jest 설정 — jest-expo 프리셋 (Linux CI에서 시뮬레이터 없이 실행 가능) */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  transformIgnorePatterns: [
    // bun 워크스페이스는 node_modules/.bun/<pkg>@<ver>/node_modules/<pkg> 구조라
    // .bun 프리픽스를 허용한 뒤 실제 패키지명으로 allowlist를 검사한다.
    'node_modules/(?!(\\.bun/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|@litechat|@tanstack|@shopify|sf-symbols-typescript))',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // reanimated 4는 jest 환경에서 worklets 네이티브 모듈을 로드할 수 없다 → 공식 mock
    '^react-native-reanimated$': 'react-native-reanimated/mock',
    '^react-native-worklets$': 'react-native-worklets/src/mock',
  },
};
