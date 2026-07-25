/**
 * 접속 로그 상세 모달 — 접속 기록 패널 **오른쪽**에 붙는 별도 표면.
 *
 * 목록 안에 상세 카드를 끼워 넣던 이전 방식은 카드가 스크롤 영역 맨 위에 생겨
 * 시야 밖이었고 목록을 아래로 밀었다. 그래서 별도 표면으로 분리한다.
 *  - lg+: 로그 패널 오른쪽에 도킹. 배경 딤이 없어 지도 팬/줌과 목록 클릭이 계속 된다
 *    (목록에서 다른 행을 누르면 이 모달의 내용만 교체된다 — 비교하며 보는 흐름).
 *  - lg 미만: 폭이 모자라 겹치므로 배경 딤 + 시트로 전환한다.
 *
 * 무료/유료를 표면에서 분리한다: 세션 자체 필드(UA/리퍼러/방문자 ID 등)는 열자마자
 * 무료로 보여주고, 쿼리당 과금되는 GeoIP2 Insights는 이 안의 버튼으로만 호출된다.
 *
 * position은 fixed지만 portal은 쓰지 않는다 — App의 <main>이 z-index:auto라
 * 스택 컨텍스트를 만들지 않아서, 여기의 z-30/z-40이 z-20 헤더 위에 그려진다.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import type { InsightsResult, SessionRow } from '../../api';
import { InsightsCard } from './InsightsCard';
import { formatDate, isPrivateIp } from './shared';

interface SessionDetailModalProps {
  /** 사용자 탭의 수집된 Insights 칩으로 열면 세션 없이 Insights만 표시된다 */
  session: SessionRow | null;
  insights: InsightsResult | null;
  insightsBusy: boolean;
  insightsError: string;
  onLookupInsights: (ip: string) => void;
  onClose: () => void;
}

const TITLE_ID = 'session-detail-title';

export function SessionDetailModal({
  session,
  insights,
  insightsBusy,
  insightsError,
  onLookupInsights,
  onClose,
}: SessionDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Escape로 닫기 — 캡처 단계에서 먹고 전파를 끊어, MapPage의 "선택 해제"보다 먼저 처리된다
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // 열릴 때 모달로 포커스를 옮기고, 닫힐 때 원래 트리거로 되돌린다.
  // 포커스 트랩은 넣지 않는다 — lg+ 도킹 변형은 비차단이라 트랩이 오히려 틀린 동작이다.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const ip = session?.ip ?? insights?.insights.ip ?? '';
  // 다른 IP의 Insights가 남아 있으면 이 로그의 것이 아니다
  const ownInsights =
    insights !== null && (session === null || insights.insights.ip === session.ip)
      ? insights
      : null;

  return (
    <>
      {/* 딤은 좁은 화면에서만 — lg+에서는 지도와 목록을 계속 쓸 수 있어야 한다 */}
      <div
        onClick={onClose}
        className="animate-fade-in fixed inset-0 z-30 bg-black/50 lg:hidden"
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        className={
          // lg 도킹 위치는 패널을 접어도 그대로 둔다 — left-4로 당기면 패널 재열기
          // 버튼('› 접속 기록')과 정확히 겹쳐 패널을 다시 열 수 없게 된다.
          // 높이는 내용에 맞추고 넘칠 때만 스크롤한다 (bottom을 고정하면 짧은 내용에도 빈 통이 된다)
          'glass animate-sheet-in fixed inset-x-2 bottom-2 z-40 flex max-h-[80dvh] flex-col ' +
          'overflow-hidden rounded-2xl border border-hairline/70 outline-none ' +
          'sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-24 sm:w-[420px] sm:max-h-[calc(100dvh-7rem)] ' +
          'lg:left-[27rem] lg:right-auto lg:top-16 lg:w-[440px] lg:max-h-[calc(100dvh-5rem)]'
        }
      >
        <div className="flex items-center gap-2 border-b border-hairline/60 px-4 py-3">
          <h2 id={TITLE_ID} className="tnum display truncate text-sm">
            {ip || '상세 정보'}
          </h2>
          {session && (
            <span className="shrink-0 rounded-full border border-hairline/70 px-1.5 py-0.5 text-[10px] text-ink-mute">
              {session.platform}
            </span>
          )}
          {isPrivateIp(ip) && (
            <span
              className="shrink-0 rounded-full border border-danger/40 px-1.5 py-0.5 text-[10px] text-danger"
              title="프록시가 X-Forwarded-For를 넘기지 않아 사설 IP가 기록됐습니다"
            >
              사설 IP
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto shrink-0 rounded-full px-2 py-1 text-ink-mute hover:text-white focus-visible:ring-1 focus-visible:ring-primary-soft"
            title="닫기 (Esc)"
            aria-label="상세 정보 닫기"
          >
            ×
          </button>
        </div>

        <div className="scroll-thin flex flex-1 flex-col gap-4 overflow-y-auto p-4 text-xs">
          {session && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-ink-mute">접속 정보</h3>
              <Field label="접속 시각">
                <span className="tnum">{formatDate(session.createdAt)}</span>
              </Field>
              <Field label="최근 활동">
                <span className="tnum">{formatDate(session.lastSeenAt)}</span>
              </Field>
              <Field label="사용자">
                {session.nickname ? `${session.nickname} @${session.username}` : '비로그인'}
              </Field>
              <Field label="위치">
                {[session.city, session.region, session.country].filter(Boolean).join(', ') ||
                  (session.lat !== null ? '좌표만 있음' : '위치 없음')}
              </Field>
              <Field label="정확도 반경">
                <span className="tnum">
                  {session.accuracyKm !== null ? `${session.accuracyKm}km` : '—'}
                </span>
              </Field>
              <Field label="좌표">
                <span className="tnum">
                  {session.lat !== null && session.lon !== null
                    ? `${session.lat}, ${session.lon}`
                    : '—'}
                </span>
              </Field>
              <Field label="방문자 ID">
                <span className="tnum">{session.visitorId}</span>
              </Field>
              <Field label="리퍼러">{session.referrer || '—'}</Field>
              <Field label="User-Agent">
                <span className="text-[11px]">{session.userAgent || '—'}</span>
              </Field>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-ink-mute">GeoIP2 Insights</h3>
            {insightsError !== '' && (
              <p className="rounded-md border border-danger/40 px-3 py-2 text-xs text-danger">
                Insights 조회 실패: {insightsError}
              </p>
            )}
            {ownInsights ? (
              <InsightsCard result={ownInsights} />
            ) : (
              <>
                <button
                  onClick={() => onLookupInsights(ip)}
                  disabled={insightsBusy || ip === ''}
                  className="self-start rounded-md border border-hairline px-3 py-1.5 text-xs hover:text-white focus-visible:ring-1 focus-visible:ring-primary-soft disabled:opacity-40"
                >
                  {insightsBusy ? '조회 중…' : 'GeoIP2 정밀 조회'}
                </button>
                <p className="text-[11px] text-ink-mute">
                  쿼리당 과금되는 유료 API입니다 · 같은 IP는 1주간 캐시를 재사용합니다.
                  <br />
                  조회하면 ISP/조직/정확도 반경이 나오고, 지도의 핀과 반경 원이 이 정밀 위치로
                  대체됩니다.
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/** 라벨/값 한 줄 — 값이 길어도(UA, 리퍼러) 줄바꿈되며 라벨 폭은 유지된다 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-ink-mute">{label}</span>
      <span className="min-w-0 flex-1 break-all">{children}</span>
    </div>
  );
}
