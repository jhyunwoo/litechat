/**
 * 이미지 뷰어 — 탭하면 전체 화면으로 확대, 저화질/원본 다운로드 제공
 */
import type { WireMessage } from '@litechat/types';
import { AnimatePresence, m } from 'motion/react';
import { useEffect } from 'react';
import { formatBytes } from '../lib/format';

interface Props {
  message: WireMessage | null;
  onClose: () => void;
}

export function ImageViewer({ message, onClose }: Props) {
  // Esc로 닫기
  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [message, onClose]);

  const image = message?.im;

  return (
    <AnimatePresence>
      {message && image && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
          onClick={onClose}
        >
          <m.img
            initial={{ scale: 0.85 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            src={`/img/${image.id}/thumb?cache=private-v2`}
            alt="사진"
            className="m-auto max-h-[80vh] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {/* 다운로드 옵션 — 파일 크기를 보여줘 데이터 사용량을 예측하게 한다 */}
          <div
            className="pb-safe flex justify-center gap-3 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <a
              href={`/img/${image.id}/thumb?cache=private-v2`}
              download={`litechat-${image.id}.webp`}
              className="tnum flex min-h-11 items-center rounded-full bg-white/15 px-5 text-sm text-white backdrop-blur transition active:scale-95"
            >
              저화질 저장 ({formatBytes(image.tb)})
            </a>
            <a
              href={`/img/${image.id}/orig?cache=private-v2`}
              className="tnum flex min-h-11 items-center rounded-full bg-white/15 px-5 text-sm text-white backdrop-blur transition active:scale-95"
            >
              원본 저장 ({formatBytes(image.ob)})
            </a>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
