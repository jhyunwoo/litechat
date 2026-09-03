/**
 * 답장 스와이프 판정 — 제스처 바인딩(터치 이벤트 / Pan 제스처)과 분리한 순수 함수.
 *
 * 웹과 앱이 같은 감도를 갖도록 규칙을 한곳에 모았다.
 * apps/web/src/lib/gesture.ts에 동일한 사본이 있다 (저장소의 format.ts와 같은 관례).
 * apps/lite는 zod가 번들에 딸려오는 것을 막으려고 main.ts에 같은 규칙을 인라인으로 둔다.
 * 규칙이나 임계값을 고칠 때는 세 곳을 함께 고칠 것.
 *
 * 함수 안의 'worklet' 지시자는 reanimated가 이 함수를 UI 스레드에서 부를 수 있게 한다
 * (Pan 제스처 콜백은 UI 스레드에서 돈다). 웹 사본에서는 아무 일도 하지 않는 문자열이라
 * 두 파일을 글자 그대로 같게 유지하려고 그대로 둔다 — 사본이 어긋나는 쪽이 더 위험하다.
 */

/** 이만큼 끌면 답장으로 확정된다 (px) */
export const REPLY_SWIPE_THRESHOLD = 56;
/** 아무리 끌어도 이 이상 밀리지 않는다 (px) */
export const REPLY_SWIPE_MAX = 72;

/**
 * 스와이프 진행 상태를 계산한다.
 *
 * - 상대 메시지(mine=false)는 왼쪽→오른쪽(+x)으로만, 내 메시지(mine=true)는
 *   오른쪽→왼쪽(-x)으로만 끌린다. 반대 방향은 무시한다.
 * - 가로 이동이 세로보다 뚜렷할 때만 인정한다. 그러지 않으면 메시지 목록의 세로
 *   스크롤과 다투게 된다.
 *
 * @returns offset 화면에 적용할 부호 있는 이동량(내 메시지는 음수), ready 답장 확정 여부
 */
export function replySwipe(
  dx: number,
  dy: number,
  mine: boolean,
): { offset: number; ready: boolean } {
  'worklet';
  // 허용 방향으로의 이동량 (반대 방향이면 음수가 되어 아래에서 걸러진다)
  const along = mine ? -dx : dx;
  if (along <= 0) return { offset: 0, ready: false };
  if (along <= Math.abs(dy) * 1.5) return { offset: 0, ready: false };

  const distance = Math.min(along, REPLY_SWIPE_MAX);
  return { offset: mine ? -distance : distance, ready: along >= REPLY_SWIPE_THRESHOLD };
}
