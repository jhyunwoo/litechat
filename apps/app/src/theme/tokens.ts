/**
 * 디자인 토큰 — DESIGN.md(Stripi 디자인 언어)의 네이티브 전사
 *
 * 핵심 규칙:
 *   - 인디고(primary)는 CTA/링크 전용, 화면당 채워진 버튼 하나
 *   - 본문은 ink(딥 네이비), 절대 순수 검정 아님
 *   - 디스플레이 타이포는 300 웨이트 + 음수 자간 (iOS SF Pro가 폴백 스택과 일치)
 *   - 버튼은 필(9999) 형태, 카드 라운드는 12
 */
import { Platform } from 'react-native';

export const colors = {
  primary: '#533afd',
  primaryDeep: '#4434d4',
  primaryPress: '#2e2b8c',
  primarySoft: '#665efd',
  primarySubdued: '#b9b9f9',
  brandDark: '#1c1e54',
  ink: '#0d253d',
  inkSecondary: '#273951',
  inkMute: '#64748d',
  onPrimary: '#ffffff',
  canvas: '#ffffff',
  canvasSoft: '#f6f9fc',
  canvasCream: '#f5e9d4',
  hairline: '#e3e8ee',
  hairlineInput: '#a8c3de',
  ruby: '#ea2261',
  magenta: '#f96bee',
  shadowBlue: '#003770',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 64,
} as const;

export const rounded = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

/** 300 웨이트 디스플레이/본문 타입 스케일 (음수 자간은 브랜드 시그니처) */
export const type = {
  displayLg: {
    fontSize: 32,
    fontWeight: '300' as const,
    letterSpacing: -0.64,
    lineHeight: 35,
    color: colors.ink,
  },
  displayMd: {
    fontSize: 26,
    fontWeight: '300' as const,
    letterSpacing: -0.26,
    lineHeight: 29,
    color: colors.ink,
  },
  headingLg: {
    fontSize: 22,
    fontWeight: '300' as const,
    letterSpacing: -0.22,
    lineHeight: 24,
    color: colors.ink,
  },
  headingMd: {
    fontSize: 20,
    fontWeight: '300' as const,
    letterSpacing: -0.2,
    lineHeight: 28,
    color: colors.ink,
  },
  bodyLg: {
    fontSize: 16,
    fontWeight: '300' as const,
    lineHeight: 22,
    color: colors.ink,
  },
  bodyMd: {
    fontSize: 15,
    fontWeight: '300' as const,
    lineHeight: 21,
    color: colors.ink,
  },
  buttonMd: {
    fontSize: 16,
    fontWeight: '400' as const,
    color: colors.onPrimary,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    letterSpacing: -0.39,
    lineHeight: 18,
    color: colors.inkMute,
  },
  micro: {
    fontSize: 11,
    fontWeight: '300' as const,
    lineHeight: 15,
    color: colors.inkMute,
  },
} as const;

/** 카드 lift 그림자 (Level 1) — DESIGN.md rgba(0,55,112,0.08) 0 1px 3px */
export const shadowCard = Platform.select({
  ios: {
    shadowColor: colors.shadowBlue,
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  default: { elevation: 1 },
});

/** 플로팅 패널 그림자 (Level 2) */
export const shadowPanel = Platform.select({
  ios: {
    shadowColor: colors.shadowBlue,
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  default: { elevation: 4 },
});

/** 그라디언트 메시 스톱 — 마케팅/히어로 배경 (로그인 화면 상단) */
export const meshStops = ['#f5e9d4', '#f96bee', '#b9b9f9', '#533afd', '#ea2261'] as const;
