/**
 * 이모지 피커 — 외부 라이브러리 없이 자주 쓰는 이모지 그리드 (웹 포팅)
 */
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { makeStyles } from '@/theme/theme';
import { rounded, spacing } from '@/theme/tokens';

// prettier-ignore
const EMOJIS = [
  '😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎',
  '🤔', '😅', '😭', '😢', '😡', '🥺', '😴', '🤗',
  '👍', '👎', '👏', '🙏', '💪', '🤝', '✌️', '🫶',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💕',
  '🎉', '🎂', '🎁', '🔥', '✨', '⭐', '💯', '✅',
  '😉', '🙈', '🤫', '🫠', '😇', '🤩', '😋', '😜',
];

interface Props {
  onPick: (emoji: string) => void;
}

export function EmojiPicker({ onPick }: Props) {
  const styles = useStyles();
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOutDown.duration(140)}
      style={styles.grid}
    >
      {EMOJIS.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPick(emoji);
          }}
          style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
        >
          <Text style={styles.emoji}>{emoji}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.canvas,
    padding: spacing.sm,
  },
  cell: {
    width: '12.5%',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    borderRadius: rounded.md,
  },
  cellPressed: {
    backgroundColor: colors.canvasSoft,
    // DESIGN.md의 시스템 공통 눌림 스케일
    transform: [{ scale: 0.95 }],
  },
  emoji: {
    fontSize: 24,
  },
}));

export default EmojiPicker;
