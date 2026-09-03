/**
 * 프로필 탭 — 내 정보 + 알림 토글 + 로그아웃
 */
import { m } from 'motion/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { disablePush, enablePush, getSubscription, pushSupported } from '../push';
import { isIos, isStandalone } from '../pwa';

export default function ProfileTab() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const supported = pushSupported();
  // iOS는 홈 화면에 추가(standalone)해야만 알림을 켤 수 있다.
  // 이 경우 토글 대신 온보딩으로 안내한다.
  const needsInstall = isIos() && !isStandalone();

  // 현재 브라우저의 구독 상태를 확인해 토글 초기값을 맞춘다.
  useEffect(() => {
    void getSubscription().then((sub) => setPushOn(Boolean(sub)));
  }, []);

  async function togglePush() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
      } else {
        setPushOn(await enablePush());
      }
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div>
      <header className="pt-safe frosted sticky top-0 z-10 border-b border-hairline">
        <h1 className="px-4 py-3 display text-2xl">프로필</h1>
      </header>

      <div className="flex flex-col items-center gap-2 py-8">
        <div className="flex size-20 items-center justify-center rounded-full bg-ink text-3xl font-semibold text-white">
          {me?.nickname.charAt(0)}
        </div>
        <p className="text-lg font-normal">{me?.nickname}</p>
        <p className="text-sm text-ink-mute">@{me?.username}</p>
      </div>

      <div className="mx-4 divide-y divide-hairline rounded-xl border border-hairline">
        {needsInstall ? (
          /* iOS 미설치 — 토글 대신 홈 화면 추가 + 알림 등록 온보딩으로 안내 */
          <button
            onClick={() => navigate('/onboarding')}
            className="flex w-full items-center justify-between px-4 py-3 text-left active:bg-canvas-soft"
          >
            <div>
              <p className="font-normal">푸시 알림</p>
              <p className="text-xs text-ink-mute">홈 화면에 추가하고 알림 받기</p>
            </div>
            <span className="text-lg text-ink-mute">›</span>
          </button>
        ) : (
          /* 푸시 알림 토글 */
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-normal">푸시 알림</p>
              <p className="text-xs text-ink-mute">
                {supported
                  ? '접속 중이 아닐 때 새 메시지를 알려드려요'
                  : '이 브라우저에서는 지원되지 않아요'}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={pushOn}
              disabled={!supported || pushBusy}
              onClick={() => void togglePush()}
              className={`h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors disabled:opacity-40 ${
                pushOn ? 'bg-primary' : 'bg-hairline-input'
              }`}
            >
              <m.span
                animate={{ x: pushOn ? 20 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.6 }}
                className="block size-6 rounded-full bg-white"
              />
            </button>
          </div>
        )}

        {/* 로그아웃 */}
        <button
          onClick={() => navigate('/account-deletion')}
          className="flex min-h-12 w-full items-center justify-between px-4 py-3 text-left active:bg-canvas-soft"
        >
          <span>계정 삭제</span>
          <span aria-hidden="true">›</span>
        </button>
        <a
          href="/privacy"
          className="flex min-h-12 items-center justify-between px-4 py-3 active:bg-canvas-soft"
        >
          <span>개인정보처리방침</span>
          <span aria-hidden="true">↗</span>
        </a>
        <a
          href="/terms"
          className="flex min-h-12 items-center justify-between px-4 py-3 active:bg-canvas-soft"
        >
          <span>이용약관</span>
          <span aria-hidden="true">↗</span>
        </a>
        <a
          href="/support"
          className="flex min-h-12 items-center justify-between px-4 py-3 active:bg-canvas-soft"
        >
          <span>지원 및 문의</span>
          <span aria-hidden="true">↗</span>
        </a>

        {/* 로그아웃 */}
        <button
          onClick={() => {
            void logout().then(() => navigate('/login', { replace: true }));
          }}
          className="w-full px-4 py-3 text-left font-semibold text-ruby active:bg-canvas-soft"
        >
          로그아웃
        </button>
      </div>

      <p className="py-8 text-center text-xs text-ink-mute/60">
        litechat · 단축키: Alt+1/2/3 탭 이동 · Ctrl+K 검색
        <br />
        서비스 개선을 위해 접속 IP·기기 정보 등을 수집해요.
      </p>
    </div>
  );
}
