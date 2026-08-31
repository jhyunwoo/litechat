/**
 * 디자인 토큰 — DESIGN.md의 Action Blue + 중립 표면을 네이티브로 전사한다.
 *
 * 핵심 규칙:
 *   - 모든 인터랙션은 Action Blue 하나로 통일하고, 다크 위 링크만 Sky Blue를 쓴다.
 *   - 라이트 본문은 Near-Black Ink, 다크 캔버스는 Near-Black Tile을 쓴다.
 *   - 디스플레이 타이포는 600 웨이트 + 음수 자간 ("Apple tight"), 본문은 400
 *   - 버튼은 필(9999) 형태, 카드 라운드는 12. 장식 그라디언트 금지
 *
 * 색을 쓰는 코드는 이 모듈을 직접 import하지 않고 theme/theme.tsx의
 * useTheme()/makeStyles()를 통해 현재 스킴의 팔레트를 받는다.
 */
import { Platform } from 'react-native';

export const lightColors = {
  primary: '#0066CC',
  primaryFocus: '#0071E3',
  primaryOnDark: '#2997FF',
  link: '#0066CC',
  primaryDeep: '#1D1D1F',
  primaryPress: '#0066CC',
  primarySoft: '#0066CC',
  primarySubdued: '#D2D2D7',
  brandDark: '#272729',
  ink: '#1D1D1F',
  inkSecondary: '#333333',
  inkMute: '#7A7A7A',
  onPrimary: '#FFFFFF',
  canvas: '#FFFFFF',
  canvasSoft: '#F5F5F7',
  canvasCream: '#FAFAFC',
  hairline: '#E0E0E0',
  hairlineInput: '#E0E0E0',
  /* 에러/파괴적 동작 전용 기능색 — 모노크롬 시스템의 유일한 유채색 */
  ruby: '#d64545',
  /* 이전 API 호환용 키 — 두 번째 브랜드 액센트를 만들지 않고 primary와 동일하게 둔다. */
  magenta: '#0066CC',
  shadowBlue: '#000000',
} as const;

export type Palette = Record<keyof typeof lightColors, string>;

/** 다크 팔레트 — Near-Black Tile 위 Action/Sky Blue 인터랙티브 */
export const darkColors: Palette = {
  primary: '#0066CC',
  primaryFocus: '#0071E3',
  primaryOnDark: '#2997FF',
  link: '#2997FF',
  primaryDeep: '#FFFFFF',
  primaryPress: '#0066CC',
  primarySoft: '#2997FF',
  primarySubdued: '#333333',
  brandDark: '#2997FF',
  ink: '#FFFFFF',
  inkSecondary: '#CCCCCC',
  inkMute: '#CCCCCC',
  onPrimary: '#FFFFFF',
  canvas: '#272729',
  canvasSoft: '#2A2A2C',
  canvasCream: '#252527',
  hairline: '#333333',
  hairlineInput: '#7A7A7A',
  ruby: '#ff6b6b',
  magenta: '#2997FF',
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

/** 타입 스케일 — 디스플레이/헤딩 600 + 음수 자간("Apple tight"), 본문 400
    — 색이 팔레트에 따라 달라지므로 팩토리로 생성한다 */
export function makeType(c: Palette) {
  return {
    displayLg: {
      fontSize: 32,
      fontWeight: '600' as const,
      letterSpacing: -0.64,
      lineHeight: 35,
      color: c.ink,
    },
    displayMd: {
      fontSize: 26,
      fontWeight: '600' as const,
      letterSpacing: -0.26,
      lineHeight: 29,
      color: c.ink,
    },
    headingLg: {
      fontSize: 22,
      fontWeight: '600' as const,
      letterSpacing: -0.22,
      lineHeight: 24,
      color: c.ink,
    },
    headingMd: {
      fontSize: 20,
      fontWeight: '600' as const,
      letterSpacing: -0.2,
      lineHeight: 28,
      color: c.ink,
    },
    bodyLg: {
      fontSize: 17,
      fontWeight: '400' as const,
      letterSpacing: -0.37,
      lineHeight: 25,
      color: c.ink,
    },
    bodyMd: {
      fontSize: 15,
      fontWeight: '400' as const,
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
      fontWeight: '400' as const,
      lineHeight: 15,
      color: c.inkMute,
    },
  } as const;
}

export type TypeScale = ReturnType<typeof makeType>;

/** 그림자 — 검정 저불투명 lift (양 스킴 공통, 팔레트의 shadowBlue를 따른다) */
export function makeShadows(c: Palette) {
  return {
    /** 카드 lift 그림자 (Level 1) */
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
