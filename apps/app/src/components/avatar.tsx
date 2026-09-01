/**
 * 아바타 — 닉네임 첫 글자 + 잉크 단색 원 (모노크롬: 장식 그라디언트 금지)
 *
 * Action Blue는 '누를 수 있는 것' 전용이라 아바타에는 쓰지 않는다 (웹과 동일한 잉크 칩).
 */
import { Text, View } from 'react-native';
import { makeStyles } from '@/theme/theme';

interface Props {
  nickname: string;
  size?: number;
  /** 예전 그라디언트 시절의 변형 구분 — 모노크롬에선 동일하게 그린다 (호출부 호환용) */
  variant?: 'primary' | 'dark';
}

export function Avatar({ nickname, size = 48 }: Props) {
  const styles = useStyles();
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.letter, { fontSize: size * 0.38 }]}>{nickname.charAt(0) || '?'}</Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip,
  },
  letter: {
    color: colors.onChip,
    fontWeight: '600',
  },
}));
