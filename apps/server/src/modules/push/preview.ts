/**
 * 알림 본문 미리보기 — Web Push와 Expo Push가 공유한다.
 */
import type { WireMessage } from '@litechat/types';

/** 이미지/장문은 텍스트 대체 표시로 줄인다 */
export function previewOf(message: WireMessage): string {
  if (message.k === 'i') return '📷 사진';
  return message.x.length > 80 ? `${message.x.slice(0, 80)}…` : message.x;
}
