/**
 * 표시용 포맷 유틸리티
 */

/** unix epoch 초 → 채팅 시간 표시 (오늘이면 시:분, 아니면 날짜) */
export function formatTime(ts: number): string {
  const date = new Date(ts * 1000);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('ko-KR', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  });
}

/** 바이트 수 → 사람이 읽는 크기 (예: 1.2MB) */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 문자열이 이모지 1~3개로만 이루어졌는지 (대형 이모지 렌더링 판단) */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Extended_Pictographic + ZWJ/변형 선택자/스킨톤만 허용
  const emojiPattern =
    /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*){1,3}$/u;
  return emojiPattern.test(trimmed);
}
