/**
 * litechat 모노 버블 로고 — 말풍선 + 펀치아웃 타이핑 도트 3개.
 * 앱 아이콘(apps/app/scripts/generate-icons.ts)과 같은 글리프를 인라인 SVG로 쓴다.
 * currentColor를 채움색으로 써서 놓인 표면(블랙 타일/화이트 캔버스)을 따라간다.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="232 252 580 574" className={className} aria-hidden fill="currentColor">
      <path
        fillRule="evenodd"
        d="M232 408 C232 333, 293 272, 368 272 L656 272 C731 272, 792 333, 792 408 L792 536 C792 611, 731 672, 656 672 L430 672 C392 742, 330 786, 246 806 C298 762, 324 716, 330 668 C273 654, 232 600, 232 536 Z
           M402 430 a42 42 0 1 0 0.0001 0 Z M512 430 a42 42 0 1 0 0.0001 0 Z M622 430 a42 42 0 1 0 0.0001 0 Z"
      />
    </svg>
  );
}
