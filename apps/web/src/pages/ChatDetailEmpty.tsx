/**
 * 데스크탑 2-pane 디테일 컬럼의 빈 상태
 *
 * 대화를 아직 선택하지 않았을 때(`/`, `/friends`, `/profile`) 우측 컬럼에 표시한다.
 * 모바일에서는 Shell이 디테일 컬럼 자체를 숨기므로 노출되지 않는다.
 */
import { m } from 'motion/react';
import { Icon } from '../components/Icon';

export default function ChatDetailEmpty() {
  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      className="flex h-full w-full flex-col items-center justify-center gap-5 p-8 text-center"
    >
      <div className="flex size-20 items-center justify-center rounded-full bg-canvas-soft text-primary-subdued">
        <Icon name="chat" className="size-10" />
      </div>
      <div className="space-y-1.5">
        <p className="text-lg font-normal text-ink-secondary">왼쪽에서 대화를 선택하세요</p>
        <p className="text-sm text-ink-mute">친구와 대화를 시작해 보세요</p>
      </div>
    </m.div>
  );
}
