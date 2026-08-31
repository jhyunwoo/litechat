/**
 * recharts 공용 상수 — 모노크롬 차트 팔레트/스타일.
 *
 * recharts는 SVG 속성에 CSS 변수를 못 쓰는 곳이 있어 hex를 여기 한 곳에만 둔다
 * (styles.css의 --color-series-* 토큰과 항상 같은 값으로 유지할 것).
 * 시리즈 2는 색(회색)에 더해 점선(dash)으로도 구분한다 — 색각 이상/인쇄 대비.
 */
export const chart = {
  grid: '#333333',
  axis: '#CCCCCC',
  /** 시리즈 1 — 흰색 실선 */
  series1: '#ffffff',
  /** 시리즈 2 — 중간 회색 + 점선 (색만으로 구분하지 않는다) */
  series2: '#7A7A7A',
  series2Dash: '6 3',
} as const;

/** Tooltip contentStyle — 카드 표면/헤어라인과 동일한 다크 팝오버 */
export const tooltipStyle = {
  background: '#2A2A2C',
  border: '1px solid #333333',
  borderRadius: 8,
} as const;

export const tooltipLabelStyle = { color: '#ffffff' } as const;
