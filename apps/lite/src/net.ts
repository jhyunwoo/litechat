/**
 * 네트워크 계층 + 데이터 사용량 측정기
 *
 * 사용량 측정 방식:
 *  - 페이지/자산/fetch/이미지: Resource Timing API의 transferSize(실제 전송 바이트,
 *    헤더 포함)를 PerformanceObserver로 합산한다. 캐시 히트는 0바이트 = 정확히 반영.
 *  - WebSocket: 프레임 문자열의 UTF-8 길이 + 프레임 오버헤드(약 6B)를 직접 더한다.
 *  - 합계는 localStorage에 누적 저장되어 앱을 껐다 켜도 유지된다.
 */

const STORAGE_KEY = 'lc_bytes';

/** 누적 사용량 (bytes) */
let total = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
let listeners: (() => void)[] = [];

function save(): void {
  localStorage.setItem(STORAGE_KEY, String(total));
  for (const listener of listeners) listener();
}

/** 수동 가산 (WS 프레임 등 Resource Timing 밖의 트래픽) */
export function addBytes(bytes: number): void {
  total += bytes;
  save();
}

/** 현재 누적 사용량 */
export function totalBytes(): number {
  return total;
}

/** 사용량 변경 구독 (헤더 카운터 갱신용) */
export function onBytesChange(listener: () => void): void {
  listeners.push(listener);
}

/** 사용량 초기화 (프로필 탭) */
export function resetBytes(): void {
  total = 0;
  save();
}

// 최초 페이지 로드(HTML)와 이후 모든 리소스의 실제 전송 바이트를 수집한다.
// buffered: true 로 관찰 시작 이전 항목(HTML, CSS, JS)도 놓치지 않는다.
const observer = new PerformanceObserver((entries) => {
  let sum = 0;
  for (const entry of entries.getEntries()) {
    sum += (entry as PerformanceResourceTiming).transferSize || 0;
  }
  if (sum > 0) addBytes(sum);
});
observer.observe({ type: 'navigation', buffered: true });
observer.observe({ type: 'resource', buffered: true });

/** 바이트 → 사람이 읽는 표기 */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(2)}MB`;
}

/** JSON API 호출 — 실패 시 서버 오류 코드를 담아 throw */
export async function req<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'INTERNAL');
  return data;
}

/** 서버 오류 코드 → 한국어 안내 */
export function errMsg(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const map: Record<string, string> = {
    USERNAME_TAKEN: '이미 사용 중인 아이디예요',
    INVALID_CREDENTIALS: '아이디 또는 비밀번호가 틀려요',
    ALREADY_RELATED: '이미 친구이거나 요청 중이에요',
    CANNOT_FRIEND_SELF: '자신에게는 보낼 수 없어요',
    NOT_FOUND: '찾을 수 없어요',
    INVALID_IMAGE: '지원하지 않는 이미지예요',
  };
  return map[code] ?? '오류가 발생했어요';
}
