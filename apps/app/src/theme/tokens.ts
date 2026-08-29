/**
 * 디자인 토큰 — 따뜻한 litechat 브랜드 팔레트의 네이티브 전사 + 다크 팔레트
 *
 * 핵심 규칙:
 *   - 인터랙티브(primary)는 코코아(다크에선 피치), 화면당 채워진 버튼 하나
 *   - 본문은 코코아 잉크(#3B2823), 다크 캔버스는 나이트(#211A19)
 *   - 디스플레이 타이포는 600 웨이트 + 음수 자간 ("Apple tight"), 본문은 400
 *   - 버튼은 필(9999) 형태, 카드 라운드는 12. 장식 그라디언트 금지
 *
 * 색을 쓰는 코드는 이 모듈을 직접 import하지 않고 theme/theme.tsx의
 * useTheme()/makeStyles()를 통해 현재 스킴의 팔레트를 받는다.
 */
import { Platform } from 'react-native';

export const lightColors = {
  primary: '#3B2823',
  primaryDeep: '#211A19',
  primaryPress: '#211A19',
  primarySoft: '#E8785D',
  primarySubdued: '#F4C5B7',
  brandDark: '#211A19',
  ink: '#3B2823',
  inkSecondary: '#5B433C',
  inkMute: '#75645E',
  onPrimary: '#FFF8F0',
  canvas: '#FFFDF9',
  canvasSoft: '#FFF8F0',
  canvasCream: '#F8EEE6',
  hairline: '#E9DCD3',
  hairlineInput: '#D8C7BD',
  /* 에러/파괴적 동작 전용 기능색 — 모노크롬 시스템의 유일한 유채색 */
  ruby: '#d64545',
  /* 모노크롬 전환으로 시각적 용도가 사라진 키 — Palette 타입 보존용 중간 회색 */
  magenta: '#E8785D',
  shadowBlue: '#3B2823',
} as const;

export type Palette = Record<keyof typeof lightColors, string>;

/** 다크 팔레트 — 나이트 캔버스 위 피치 인터랙티브 */
export const darkColors: Palette = {
  primary: '#F4C5B7',
  primaryDeep: '#FFF8F0',
  primaryPress: '#E9AE9D',
  primarySoft: '#E8785D',
  primarySubdued: '#5B3830',
  brandDark: '#F4C5B7',
  ink: '#FFF8F0',
  inkSecondary: '#E9DCD3',
  inkMute: '#BBA9A1',
  onPrimary: '#211A19',
  canvas: '#211A19',
  canvasSoft: '#2B2220',
  canvasCream: '#352925',
  hairline: '#4D3B36',
  hairlineInput: '#604B45',
  ruby: '#ff6b6b',
  magenta: '#E8785D',
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

/** 그림자 — 모노크롬: 검정 저불투명 lift (양 스킴 공통, 팔레트의 shadowBlue를 따른다) */
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
