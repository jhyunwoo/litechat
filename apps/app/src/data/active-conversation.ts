/**
 * 현재 열려 있는 대화방 ID 싱글턴
 *
 * 포그라운드 푸시 알림 억제에 사용한다 — 보고 있는 대화방의 알림은 띄우지 않는다.
 * (ChatRoomView가 포커스될 때 set, 벗어날 때 clear)
 */
let activeConversationId: number | null = null;

export function setActiveConversation(id: number | null): void {
  activeConversationId = id;
}

export function getActiveConversation(): number | null {
  return activeConversationId;
}
