/**
 * 디자인 토큰 — DESIGN.md(Stripi 디자인 언어)의 네이티브 전사 + 다크 팔레트
 *
 * 핵심 규칙:
 *   - 인디고(primary)는 CTA/링크 전용, 화면당 채워진 버튼 하나
 *   - 본문은 ink(딥 네이비), 절대 순수 검정 아님 (다크에선 옅은 블루-화이트)
 *   - 디스플레이 타이포는 300 웨이트 + 음수 자간 (iOS SF Pro가 폴백 스택과 일치)
 *   - 버튼은 필(9999) 형태, 카드 라운드는 12
 *
 * 색을 쓰는 코드는 이 모듈을 직접 import하지 않고 theme/theme.tsx의
 * useTheme()/makeStyles()를 통해 현재 스킴의 팔레트를 받는다.
 */
import { Platform } from 'react-native';

export const lightColors = {
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

export type Palette = Record<keyof typeof lightColors, string>;

/** 다크 팔레트 — 딥 네이비 캔버스 위 살짝 밝힌 인디고 (대비 확보) */
export const darkColors: Palette = {
  primary: '#665efd',
  primaryDeep: '#5747f0',
  primaryPress: '#8d85ff',
  primarySoft: '#7d74ff',
  primarySubdued: '#4a4680',
  brandDark: '#b9b9f9',
  ink: '#e8ecf6',
  inkSecondary: '#c4cddc',
  inkMute: '#8b96ac',
  onPrimary: '#ffffff',
  canvas: '#0e1220',
  canvasSoft: '#171c2e',
  canvasCream: '#2a2438',
  hairline: '#262c40',
  hairlineInput: '#3a4560',
  ruby: '#ff5d8a',
  magenta: '#f96bee',
  shadowBlue: '#000000',
};

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

/** 300 웨이트 디스플레이/본문 타입 스케일 (음수 자간은 브랜드 시그니처)
    — 색이 팔레트에 따라 달라지므로 팩토리로 생성한다 */
export function makeType(c: Palette) {
  return {
    displayLg: {
      fontSize: 32,
      fontWeight: '300' as const,
      letterSpacing: -0.64,
      lineHeight: 35,
      color: c.ink,
    },
    displayMd: {
      fontSize: 26,
      fontWeight: '300' as const,
      letterSpacing: -0.26,
      lineHeight: 29,
      color: c.ink,
    },
    headingLg: {
      fontSize: 22,
      fontWeight: '300' as const,
      letterSpacing: -0.22,
      lineHeight: 24,
      color: c.ink,
    },
    headingMd: {
      fontSize: 20,
      fontWeight: '300' as const,
      letterSpacing: -0.2,
      lineHeight: 28,
      color: c.ink,
    },
    bodyLg: {
      fontSize: 16,
      fontWeight: '300' as const,
      lineHeight: 22,
      color: c.ink,
    },
    bodyMd: {
      fontSize: 15,
      fontWeight: '300' as const,
      lineHeight: 21,
      color: c.ink,
    },
    buttonMd: {
      fontSize: 16,
      fontWeight: '400' as const,
      color: c.onPrimary,
    },
    caption: {
      fontSize: 13,
      fontWeight: '400' as const,
      letterSpacing: -0.39,
      lineHeight: 18,
      color: c.inkMute,
    },
    micro: {
      fontSize: 11,
      fontWeight: '300' as const,
      lineHeight: 15,
      color: c.inkMute,
    },
  } as const;
}

export type TypeScale = ReturnType<typeof makeType>;

/** 그림자 — 라이트: 블루 틴트 lift / 다크: 검정 (팔레트의 shadowBlue를 따른다) */
export function makeShadows(c: Palette) {
  return {
    /** 카드 lift 그림자 (Level 1) — DESIGN.md rgba(0,55,112,0.08) 0 1px 3px */
    shadowCard: Platform.select({
      ios: {
        shadowColor: c.shadowBlue,
        shadowOpacity: 0.08,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
      },
      default: { elevation: 1 },
    }),
    /** 플로팅 패널 그림자 (Level 2) */
    shadowPanel: Platform.select({
      ios: {
        shadowColor: c.shadowBlue,
        shadowOpacity: 0.08,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
      },
      default: { elevation: 4 },
    }),
  };
}

/** 그라디언트 메시 스톱 — 마케팅/히어로 배경 (로그인 화면 상단, 스킴 공통) */
export const meshStops = ['#f5e9d4', '#f96bee', '#b9b9f9', '#533afd', '#ea2261'] as const;
