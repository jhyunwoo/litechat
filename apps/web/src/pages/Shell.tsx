/**
 * 앱 셸 — 하단 탭 바(친구/채팅/프로필) + 데스크탑 단축키
 *
 * 단축키: Alt+1 채팅 / Alt+2 친구 / Alt+3 프로필 / Ctrl(Cmd)+K 검색 포커스
 */
import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useConversations, useFriendRequests, useRealtimeSync } from '../data';
import { getSubscription, pushSupported } from '../push';
import { isIos, isStandalone } from '../pwa';

/** iOS 알림 온보딩을 한 번 자동 안내했는지 기억하는 localStorage 키 */
const IOS_ONBOARD_SEEN = 'lc:ios-onboard-seen';

/** 검색 입력 포커스를 요청하는 전역 커스텀 이벤트 이름 */
export const SEARCH_EVENT = 'lc:focus-search';

/** 하단 탭 항목 */
function Tab({ to, label, icon, badge }: { to: string; label: string; icon: string; badge?: number }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
          isActive ? 'text-primary' : 'text-ink-mute hover:text-ink-secondary'
        }`
      }
    >
      <span className="text-xl leading-none">{icon}</span>
      <span>{label}</span>
      {badge ? (
        <span className="absolute top-1 right-[calc(50%-1.6rem)] tnum min-w-4 rounded-full bg-ruby px-1 text-center text-[10px] leading-4 font-normal text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </NavLink>
  );
}

export function Shell() {
  useRealtimeSync();
  const navigate = useNavigate();
  const { data: conversations } = useConversations();
  const { data: requests } = useFriendRequests();

  // 배지: 안읽은 메시지 총합 / 받은 친구 요청 수
  const unreadTotal = conversations?.reduce((sum, c) => sum + c.unread, 0) ?? 0;
  const incomingCount = requests?.incoming.length ?? 0;

  // iOS 사용자에게 알림 온보딩을 최초 1회 자동 안내한다.
  //  - Safari(미설치)      → 홈 화면 추가 흐름을 보여준다
  //  - 설치된 PWA(미구독)  → 알림 켜기 단계를 보여준다
  // localStorage는 Safari와 standalone이 분리돼 있어 각 컨텍스트에서 한 번씩 뜬다.
  useEffect(() => {
    if (!isIos() || localStorage.getItem(IOS_ONBOARD_SEEN)) return;
    if (!isStandalone()) {
      localStorage.setItem(IOS_ONBOARD_SEEN, '1');
      navigate('/onboarding');
      return;
    }
    if (pushSupported()) {
      void getSubscription().then((sub) => {
        if (!sub && !localStorage.getItem(IOS_ONBOARD_SEEN)) {
          localStorage.setItem(IOS_ONBOARD_SEEN, '1');
          navigate('/onboarding');
        }
      });
    }
  }, [navigate]);

  // 데스크탑 단축키
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const routes: Record<string, string> = { '1': '/', '2': '/friends', '3': '/profile' };
        const to = routes[e.key];
        if (to) {
          e.preventDefault();
          navigate(to);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/friends');
        // 렌더 후 검색 입력에 포커스를 요청한다.
        setTimeout(() => window.dispatchEvent(new CustomEvent(SEARCH_EVENT)), 50);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col bg-white">
      <main className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <Outlet />
      </main>
      <nav className="pb-safe flex border-t border-hairline bg-white/95 backdrop-blur">
        <Tab to="/" label="채팅" icon="💬" badge={unreadTotal} />
        <Tab to="/friends" label="친구" icon="👥" badge={incomingCount} />
        <Tab to="/profile" label="프로필" icon="👤" />
      </nav>
    </div>
  );
}
