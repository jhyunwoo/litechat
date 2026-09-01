/**
 * 알림 온보딩 — iOS 홈 화면 추가 → 알림 등록 안내
 *
 * iOS는 홈 화면에 추가한 PWA(standalone)에서만 Web Push를 허용한다. 그래서
 * 실행 컨텍스트에 따라 화면이 갈린다:
 *   - iOS Safari(미설치)  → 공유 → 홈 화면에 추가 안내 (알림 등록은 설치 후)
 *   - standalone(설치됨)  → 알림 켜기 버튼
 *   - 기타 브라우저       → 알림이 지원되면 바로 켜기, 아니면 미지원 안내
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { enablePush, getSubscription, pushSupported } from '../push';
import { isIos, isStandalone, notificationPermission } from '../pwa';
import { Icon } from '../components/Icon';

/** iOS 공유 버튼 글리프 (사각형 + 위로 향한 화살표) */
function ShareGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 3v11M8 7l4-4 4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 12H5.5A1.5 1.5 0 0 0 4 13.5v6A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18.5 12H18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "홈 화면에 추가" 글리프 (모서리 둥근 사각형 + 플러스) */
function AddToHomeGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="4.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 단계 카드 — 번호 배지 + 제목 + 설명 + 우측 글리프 */
function Step({
  n,
  title,
  desc,
  glyph,
  done,
}: {
  n: number;
  title: React.ReactNode;
  desc?: React.ReactNode;
  glyph?: React.ReactNode;
  done?: boolean;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-normal ${
          done ? 'bg-primary text-white' : 'bg-primary-subdued/40 text-primary-deep'
        }`}
      >
        {done ? <Icon name="check" className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-normal text-ink">{title}</p>
        {desc ? <p className="mt-0.5 text-sm text-ink-mute">{desc}</p> : null}
      </div>
      {glyph ? <span className="mt-0.5 shrink-0 text-primary">{glyph}</span> : null}
    </li>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const ios = isIos();
  const standalone = isStandalone();
  const supported = pushSupported();

  // 실행 컨텍스트에 따라 단계를 나눈다.
  const phase: 'install' | 'enable' | 'unsupported' =
    ios && !standalone ? 'install' : supported ? 'enable' : 'unsupported';

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'idle' | 'done' | 'denied'>('idle');

  // 이미 구독돼 있으면 완료로 표시한다.
  useEffect(() => {
    if (phase !== 'enable') return;
    void getSubscription().then((sub) => {
      if (sub) setResult('done');
    });
  }, [phase]);

  async function onEnable() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await enablePush();
      setResult(ok ? 'done' : 'denied');
    } catch {
      setResult('denied');
    } finally {
      setBusy(false);
    }
  }

  const permission = notificationPermission();

  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col overflow-y-auto scroll-thin px-6">
      {/* 닫기 */}
      <button
        onClick={() => navigate('/profile')}
        aria-label="닫기"
        className="pt-safe absolute top-2 right-4 z-10 flex size-11 items-center justify-center rounded-full text-ink-mute transition active:scale-95 active:bg-canvas-soft"
      >
        <Icon name="close" className="size-5" />
      </button>

      <div className="pt-safe pb-safe relative">
        <div className="pt-10" />
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-ink text-white">
            <Icon name="bell" className="size-8" />
          </div>
          <h1 className="display text-3xl text-ink">알림 받기</h1>
          <p className="mt-2 text-sm text-ink-mute">
            {phase === 'install'
              ? '홈 화면에 추가하면 접속 중이 아닐 때도 새 메시지를 알려드려요'
              : phase === 'enable'
                ? '접속 중이 아닐 때 새 메시지를 알림으로 받아보세요'
                : '이 브라우저에서는 알림이 지원되지 않아요'}
          </p>
        </div>

        {phase === 'install' && (
          <>
            <ol className="divide-y divide-hairline rounded-xl border border-hairline bg-white">
              <Step
                n={1}
                title={
                  <>
                    Safari 하단의 <span className="font-semibold text-primary">공유</span> 버튼을
                    누르세요
                  </>
                }
                desc="화살표가 위로 향한 네모 아이콘이에요"
                glyph={<ShareGlyph className="size-6" />}
              />
              <Step
                n={2}
                title={
                  <>
                    <span className="font-semibold text-primary">홈 화면에 추가</span>를 선택하세요
                  </>
                }
                desc="목록을 아래로 내리면 있어요"
                glyph={<AddToHomeGlyph className="size-6" />}
              />
              <Step
                n={3}
                title={
                  <>
                    홈 화면의 <span className="font-semibold">litechat</span> 아이콘으로 다시 여세요
                  </>
                }
                desc="그다음 이 안내가 알림 켜기 버튼으로 바뀌어요"
              />
            </ol>

            <div className="mt-4 rounded-xl bg-canvas-soft px-4 py-3 text-sm text-ink-secondary">
              iOS는 홈 화면에 추가한 뒤에만 알림을 보낼 수 있어요. Safari에서 열어야 &lsquo;홈
              화면에 추가&rsquo;가 보입니다.
            </div>

            <button
              onClick={() => navigate('/profile')}
              className="mt-6 w-full rounded-full py-3 font-normal text-ink-mute active:bg-canvas-soft"
            >
              나중에 하기
            </button>
          </>
        )}

        {phase === 'enable' && (
          <>
            <ol className="divide-y divide-hairline rounded-xl border border-hairline bg-white">
              {ios && (
                <>
                  <Step n={1} title="공유 → 홈 화면에 추가" desc="완료했어요" done />
                  <Step n={2} title="홈 화면 앱으로 실행" desc="완료했어요" done />
                </>
              )}
              <Step
                n={ios ? 3 : 1}
                title="알림 켜기"
                desc={
                  result === 'done' ? '알림이 켜졌어요' : '아래 버튼을 누르고 권한을 허용해 주세요'
                }
                done={result === 'done'}
              />
            </ol>

            {result === 'done' ? (
              <button
                onClick={() => navigate('/', { replace: true })}
                className="mt-6 w-full rounded-full bg-primary py-3 font-normal text-white transition active:scale-[0.98] active:bg-primary-press"
              >
                채팅으로 가기
              </button>
            ) : (
              <button
                onClick={() => void onEnable()}
                disabled={busy || permission === 'denied'}
                className="mt-6 w-full rounded-full bg-primary py-3 font-normal text-white transition active:scale-[0.98] active:bg-primary-press disabled:opacity-50"
              >
                {busy ? '잠시만요…' : '알림 켜기'}
              </button>
            )}

            {result === 'denied' && permission === 'denied' && (
              <p className="mt-3 text-center text-sm text-ruby">
                알림이 차단돼 있어요. 설정 → 알림에서 litechat 알림을 허용해 주세요.
              </p>
            )}
            {result === 'denied' && permission !== 'denied' && (
              <p className="mt-3 text-center text-sm text-ruby">
                알림을 켜지 못했어요. 잠시 후 다시 시도해 주세요.
              </p>
            )}
          </>
        )}

        {phase === 'unsupported' && (
          <>
            <div className="rounded-xl border border-hairline bg-white px-4 py-6 text-center text-sm text-ink-secondary">
              현재 브라우저에서는 푸시 알림을 사용할 수 없어요.
              {ios ? ' iOS 16.4 이상에서 홈 화면에 추가하면 사용할 수 있어요.' : ''}
            </div>
            <button
              onClick={() => navigate('/profile')}
              className="mt-6 w-full rounded-full py-3 font-normal text-ink-mute active:bg-canvas-soft"
            >
              돌아가기
            </button>
          </>
        )}
      </div>
    </div>
  );
}
