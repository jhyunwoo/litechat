/**
 * 데스크탑 2-pane 디테일 컬럼의 빈 상태
 *
 * 대화를 아직 선택하지 않았을 때(`/`, `/friends`, `/profile`) 우측 컬럼에 표시한다.
 * 모바일에서는 Shell이 디테일 컬럼 자체를 숨기므로 노출되지 않는다.
 */
export default function ChatDetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-mute">
      <span className="text-5xl">💬</span>
      <p className="text-sm">왼쪽에서 대화를 선택하세요</p>
    </div>
  );
}
