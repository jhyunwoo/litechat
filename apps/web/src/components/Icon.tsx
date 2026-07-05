/**
 * SVG 라인 아이콘 세트 — OS/브라우저 독립적인 통일된 UI 아이콘
 *
 * 유니코드 이모지를 대체한다. stroke 1.5px + currentColor라
 * 부모의 `text-*` 색 클래스를 그대로 물려받고(활성 primary / 비활성 mute),
 * 크기는 `className`(예: size-6)으로 제어한다.
 */
import type { ReactElement, SVGProps } from 'react';

export type IconName =
  | 'chat'
  | 'friends'
  | 'profile'
  | 'camera'
  | 'smile'
  | 'send'
  | 'back'
  | 'search'
  | 'bell'
  | 'check'
  | 'close'
  | 'spinner';

/** 각 아이콘의 path/shape (24×24 뷰박스, stroke 기반) */
const PATHS: Record<Exclude<IconName, 'spinner'>, ReactElement> = {
  // 말풍선
  chat: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.7 8.7 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 4 11.5 8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />,
  // 사람 둘
  friends: (
    <>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M16.5 3.7a3.2 3.2 0 0 1 0 6.2M22 20v-1.5a4 4 0 0 0-3-3.87" />
    </>
  ),
  // 사람 하나
  profile: (
    <>
      <path d="M19 20v-1.6a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20" />
      <circle cx="12" cy="7" r="3.6" />
    </>
  ),
  // 카메라
  camera: (
    <>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h1.8l1-1.7A1.5 1.5 0 0 1 8.6 4.5h6.8a1.5 1.5 0 0 1 1.3.8l1 1.7h1.8A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </>
  ),
  // 스마일
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4 4 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  // 종이비행기(전송)
  send: <path d="M21.5 3.5 2.5 11l7 2.5m12-10-6.5 17-3-8.5m9.5-8.5-12 10.5" />,
  // 뒤로(‹)
  back: <path d="M15 5l-7 7 7 7" />,
  // 돋보기
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>
  ),
  // 종
  bell: (
    <>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </>
  ),
  // 체크
  check: <path d="m5 12.5 4.5 4.5L19 6.5" />,
  // 닫기(×)
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export function Icon({
  name,
  className = 'size-6',
  ...props
}: { name: IconName; className?: string } & SVGProps<SVGSVGElement>) {
  // 스피너는 회전 애니메이션 원호 — 로딩 표시용
  if (name === 'spinner') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} aria-hidden {...props}>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
