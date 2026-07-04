/**
 * 이모지 피커 — 외부 라이브러리 없이 자주 쓰는 이모지 그리드 (웹 포팅)
 */
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors, rounded, spacing } from '@/theme/tokens';

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
  return (
    <Animated.View entering={FadeInDown.duration(180)} style={styles.grid}>
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

const styles = StyleSheet.create({
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
    transform: [{ scale: 0.9 }],
  },
  emoji: {
    fontSize: 24,
  },
});

export default EmojiPicker;
