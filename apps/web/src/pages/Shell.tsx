/**
 * 앱 셸 — 반응형 메신저 레이아웃 + 데스크탑 단축키
 *
 * 데스크탑(md≥768px): 세로 네비 레일 │ 리스트 컬럼(활성 섹션) │ 디테일 컬럼(대화/플레이스홀더)
 * 모바일(<md): 단일 컬럼 + 하단 탭 바. 대화(/chat/:id)는 전체화면.
 *
 * 단축키: Alt+1 채팅 / Alt+2 친구 / Alt+3 프로필 / Ctrl(Cmd)+K 검색 포커스
 */
import { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useConversations, useFriendRequests, useRealtimeSync } from '../data';
import { getSubscription, pushSupported } from '../push';
import { isIos, isStandalone } from '../pwa';
import ChatsTab from './ChatsTab';
import FriendsTab from './FriendsTab';
import ProfileTab from './ProfileTab';
import { Icon, type IconName } from '../components/Icon';

/** iOS 알림 온보딩을 한 번 자동 안내했는지 기억하는 localStorage 키 */
const IOS_ONBOARD_SEEN = 'lc:ios-onboard-seen';

/** 검색 입력 포커스를 요청하는 전역 커스텀 이벤트 이름 */
export const SEARCH_EVENT = 'lc:focus-search';

/** 좌측 세로 배치의 배지 (탭/레일 공용) — 모노크롬 잉크 칩 */
function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="tnum min-w-4 rounded-full bg-ink px-1 text-center text-[10px] leading-4 font-normal text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** 하단 탭(모바일) 항목 */
function Tab({ to, label, icon, active, badge }: { to: string; label: string; icon: IconName; active: boolean; badge?: number }) {
  return (
    <Link
      to={to}
      className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
        active ? 'font-semibold text-primary' : 'text-ink-mute hover:text-ink-secondary'
      }`}
    >
      <Icon name={icon} className="size-6" />
      <span>{label}</span>
      {badge ? (
        <span className="absolute top-1 right-[calc(50%-1.6rem)]">
          <Badge count={badge} />
        </span>
      ) : null}
    </Link>
  );
}

/** 네비 레일(데스크탑) 항목 — 세로 배치 */
function RailItem({ to, label, icon, active, badge }: { to: string; label: string; icon: IconName; active: boolean; badge?: number }) {
  return (
    <Link
      to={to}
      className={`relative flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] transition-colors ${
        // 활성 = 잉크 블랙 필 — 파치먼트 레일 위의 유일한 강조
        active ? 'bg-ink text-white' : 'text-ink-mute hover:bg-white/70 hover:text-ink-secondary'
      }`}
    >
      <Icon name={icon} className="size-7" />
      <span>{label}</span>
      {badge ? (
        <span className="absolute top-1.5 right-[calc(50%-1.4rem)]">
          <Badge count={badge} />
        </span>
      ) : null}
    </Link>
  );
}

export function Shell() {
  // 실시간 동기화는 항상 마운트되는 이 셸 한 곳에서만 구독한다.
  // (ChatRoom과 동시에 구독하면 handleFrame이 두 번 실행돼 메시지·안읽음이 2배가 된다.)
  useRealtimeSync();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: conversations } = useConversations();
  const { data: requests } = useFriendRequests();

  // 배지: 안읽은 메시지 총합 / 받은 친구 요청 수
  const unreadTotal = conversations?.reduce((sum, c) => sum + c.unread, 0) ?? 0;
  const incomingCount = requests?.incoming.length ?? 0;

  // 경로에서 현재 섹션과 대화 열림 여부를 파생한다.
  const inChat = pathname.startsWith('/chat/');
  const section = pathname.startsWith('/friends')
    ? 'friends'
    : pathname.startsWith('/profile')
      ? 'profile'
      : 'chats'; // '/' 및 '/chat/*'

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
    <div className="flex h-full w-full flex-col bg-white md:flex-row">
      {/* 네비 레일 — 데스크탑 전용, 파치먼트 표면 */}
      <nav className="hidden w-20 shrink-0 flex-col gap-1 border-r border-hairline bg-canvas-soft p-2 md:flex">
        <RailItem to="/" label="채팅" icon="chat" active={section === 'chats'} badge={unreadTotal} />
        <RailItem to="/friends" label="친구" icon="friends" active={section === 'friends'} badge={incomingCount} />
        <RailItem to="/profile" label="프로필" icon="profile" active={section === 'profile'} />
      </nav>

      {/* 리스트 컬럼 — 활성 섹션. 모바일에서 대화 중이면 숨긴다. */}
      <aside
        className={`min-h-0 min-w-0 overflow-y-auto scroll-thin border-hairline md:w-[320px] md:shrink-0 md:border-r lg:w-[360px] ${
          inChat ? 'hidden md:block' : 'block flex-1 md:flex-none'
        }`}
      >
        {section === 'chats' ? <ChatsTab /> : section === 'friends' ? <FriendsTab /> : <ProfileTab />}
      </aside>

      {/* 디테일 컬럼 — 대화(Outlet). 모바일에서는 대화 중일 때만 표시한다. */}
      <main className={`min-h-0 min-w-0 flex-1 ${inChat ? 'flex' : 'hidden md:flex'}`}>
        <Outlet />
      </main>

      {/* 하단 탭 바 — 모바일 전용. 대화 중에는 숨긴다(ChatRoom 자체 뒤로가기 사용). */}
      {!inChat && (
        <nav className="frosted pb-safe flex shrink-0 border-t border-hairline md:hidden">
          <Tab to="/" label="채팅" icon="chat" active={section === 'chats'} badge={unreadTotal} />
          <Tab to="/friends" label="친구" icon="friends" active={section === 'friends'} badge={incomingCount} />
          <Tab to="/profile" label="프로필" icon="profile" active={section === 'profile'} />
        </nav>
      )}
    </div>
  );
}
