/**
 * 이모지 피커 — 외부 라이브러리 없이 자주 쓰는 이모지 그리드
 * (네이티브 이모지 렌더링이라 추가 다운로드가 전혀 없다)
 *
 * 열고 닫는 연출은 호출부의 AnimatePresence가 담당한다.
 */
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
  return (
    <div className="grid grid-cols-8 gap-1 border-t border-hairline bg-white p-2">
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onPick(emoji)}
          className="rounded-lg p-1.5 text-2xl transition hover:bg-canvas-soft active:scale-95"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
