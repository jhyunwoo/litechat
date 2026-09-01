/**
 * 웹캠 촬영 — 노트북/PC 카메라로 즉석 사진을 찍어 전송한다.
 *
 * getUserMedia로 프리뷰를 띄우고, 촬영 시 현재 프레임을 canvas에 그려 JPEG Blob으로 콜백한다.
 * 서버가 sharp로 webp 변환하므로 클라이언트는 포맷을 신경 쓰지 않아도 된다.
 * 닫히거나 언마운트될 때 카메라 트랙을 반드시 정지한다(카메라 표시등 꺼짐).
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}

export function WebcamCapture({ open, onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');

  // 열릴 때 카메라 스트림을 시작하고, 닫힐 때 트랙을 정지한다.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError('카메라를 열 수 없어요. 권한을 확인해 주세요.'));
    return () => {
      cancelled = true;
      const stream = streamRef.current;
      if (stream) for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    };
  }, [open]);

  // Esc로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
      },
      'image/jpeg',
      0.9,
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-4"
          onClick={onClose}
        >
          <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            {error ? (
              <p className="max-w-xs text-center text-sm text-white">{error}</p>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="max-h-[70vh] max-w-full rounded-xl bg-black"
              />
            )}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="min-h-11 rounded-full bg-white/15 px-5 text-sm text-white backdrop-blur transition active:scale-95"
              >
                취소
              </button>
              {!error && (
                <button
                  onClick={capture}
                  aria-label="촬영"
                  className="flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-ink transition active:scale-95"
                >
                  <Icon name="camera" className="size-5" />
                  촬영
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
