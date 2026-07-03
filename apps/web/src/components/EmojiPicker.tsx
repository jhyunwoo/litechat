/**
 * 이모지 피커 — 외부 라이브러리 없이 자주 쓰는 이모지 그리드
 * (네이티브 이모지 렌더링이라 추가 다운로드가 전혀 없다)
 */
import { motion } from 'motion/react';

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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-8 gap-1 border-t border-hairline bg-white p-2"
    >
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onPick(emoji)}
          className="rounded-lg p-1.5 text-2xl transition hover:bg-canvas-soft active:scale-90"
        >
          {emoji}
        </button>
      ))}
    </motion.div>
  );
}
