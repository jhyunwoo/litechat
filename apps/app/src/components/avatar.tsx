/**
 * 아바타 — 닉네임 첫 글자 + 인디고 그라디언트 원
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from 'react-native';
import { makeStyles, useTheme } from '@/theme/theme';

interface Props {
  nickname: string;
  size?: number;
  /** 친구 목록 등에서 쓰는 어두운 변형 */
  variant?: 'primary' | 'dark';
}

export function Avatar({ nickname, size = 48, variant = 'primary' }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const gradient =
    variant === 'dark'
      ? ([colors.brandDark, colors.primaryDeep] as const)
      : ([colors.primarySoft, colors.primaryDeep] as const);
  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.letter, { fontSize: size * 0.38 }]}>
        {nickname.charAt(0) || '?'}
      </Text>
    </LinearGradient>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    color: colors.onPrimary,
    fontWeight: '300',
  },
}));
