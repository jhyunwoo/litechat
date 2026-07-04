/**
 * 글래스 표면 래퍼 — iOS 26 Liquid Glass, 미지원 기기는 반투명 폴백
 *
 * 채팅 헤더/컴포저 바 등 콘텐츠 위에 떠 있는 표면에 사용한다.
 */
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/theme/tokens';

const glassAvailable = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

interface Props {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export function Glass({ style, children }: Props) {
  if (glassAvailable) {
    return <GlassView style={style}>{children}</GlassView>;
  }
  // 폴백 — 반투명 캔버스 + 헤어라인 (구형 iOS)
  return <View style={[styles.fallback, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: colors.hairline,
  },
});
