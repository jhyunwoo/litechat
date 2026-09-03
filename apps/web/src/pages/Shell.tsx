/**
 * 앱 셸 — 반응형 메신저 레이아웃 + 데스크탑 단축키
 *
 * 데스크탑(md≥768px): 세로 네비 레일 │ 리스트 컬럼(활성 섹션) │ 디테일 컬럼(대화/플레이스홀더)
 * 모바일(<md): 단일 컬럼 + 하단 탭 바. 대화(/chat/:id)는 전체화면.
 *
 * 단축키: Alt+1 채팅 / Alt+2 친구 / Alt+3 프로필 / Ctrl(Cmd)+K 검색 포커스
 */
import { m } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** 활성 표시(밑줄/필)가 섹션 사이를 미끄러지는 스프링 — 탭 바와 레일이 공유한다 */
const INDICATOR_SPRING = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 } as const;

/** 네비게이션 섹션 정의 — 탭 바와 레일이 같은 순서를 공유해야 표시 위치가 맞는다 */
const SECTIONS = [
  { key: 'chats', to: '/', label: '채팅', icon: 'chat' },
  { key: 'friends', to: '/friends', label: '친구', icon: 'friends' },
  { key: 'profile', to: '/profile', label: '프로필', icon: 'profile' },
] as const satisfies readonly { key: string; to: string; label: string; icon: IconName }[];

type SectionKey = (typeof SECTIONS)[number]['key'];

/** 좌측 세로 배치의 배지 (탭/레일 공용) — 모노크롬 잉크 칩 */
function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <m.span
      key={count}
      initial={{ scale: 0.6 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 600, damping: 22, mass: 0.5 }}
      className="tnum min-w-4 rounded-full bg-ink px-1 text-center text-[10px] leading-4 font-normal text-white"
    >
      {count > 99 ? '99+' : count}
    </m.span>
  );
}

/** 하단 탭(모바일) 항목 */
function Tab({
  to,
  label,
  icon,
  active,
  badge,
}: {
  to: string;
  label: string;
  icon: IconName;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
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
function RailItem({
  to,
  label,
  icon,
  active,
  badge,
}: {
  to: string;
  label: string;
  icon: IconName;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      className={`relative isolate flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] transition-colors ${
        // 활성 = 잉크 블랙 필 — 파치먼트 레일 위의 유일한 강조
        active ? 'text-white' : 'text-ink-mute hover:bg-white/70 hover:text-ink-secondary'
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

/**
 * 하단 탭 바의 활성 밑줄 — 항목마다 하나씩 두고 layoutId로 잇는 대신,
 * 탭 바가 밑줄 하나만 그리고 transform으로 옮긴다.
 *
 * 이렇게 하면 motion의 공유 레이아웃(projection) 기능이 필요 없어져
 * 번들에서 통째로 빠진다(초기 전송량 −11.9 KB brotli). 세 탭은 flex-1로 폭이 같으므로
 * 래퍼를 정확히 탭 하나 폭(w-1/3)으로 두면 x를 100%씩 옮기는 것이 곧 한 칸 이동이다.
 * 안쪽 막대는 래퍼 폭의 40%를 가운데 정렬해 원래의 inset-x-[30%]와 같은 기하를 만든다.
 */
function TabIndicator({ index }: { index: number }) {
  return (
    <m.span
      aria-hidden
      initial={false}
      animate={{ x: `${index * 100}%` }}
      transition={INDICATOR_SPRING}
      className="pointer-events-none absolute top-0 left-0 flex w-1/3 justify-center"
    >
      {/* w-2/5 + 가운데 정렬 = 원래 밑줄의 inset-x-[30%](좌우 30%, 폭 40%)와 동일한 기하 */}
      <span className="block h-0.5 w-2/5 rounded-full bg-primary" />
    </m.span>
  );
}

/** 레일 활성 항목의 세로 위치/높이 (레이아웃에서 실측) */
interface RailBox {
  top: number;
  height: number;
}

/**
 * 레일의 활성 필 — 탭 바와 같은 이유로 하나만 그려 transform으로 옮긴다.
 *
 * 레일 항목 높이는 내용(아이콘+레이블)에 따라 정해지므로 활성 항목의 위치를 Shell이
 * 레이아웃 확정 직후 한 번 실측해 넘겨준다. 섹션이 바뀔 때만 읽으므로 프레임마다의
 * 레이아웃 강제 계산은 없고, 애니메이션 자체는 transform(y)만 쓴다.
 */
function RailIndicator({ box }: { box: RailBox | null }) {
  if (!box) return null;
  return (
    <m.span
      aria-hidden
      initial={false}
      animate={{ y: box.top }}
      transition={INDICATOR_SPRING}
      style={{ height: box.height }}
      className="pointer-events-none absolute inset-x-2 top-0 -z-10 rounded-xl bg-ink"
    />
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
  const section: SectionKey = pathname.startsWith('/friends')
    ? 'friends'
    : pathname.startsWith('/profile')
      ? 'profile'
      : 'chats'; // '/' 및 '/chat/*'
  const sectionIndex = SECTIONS.findIndex((entry) => entry.key === section);

  // 레일 활성 필의 위치 실측. 측정을 Shell에서 하는 이유: 자식 컴포넌트의 레이아웃
  // 이펙트는 부모 호스트 노드(<nav>)의 ref가 붙기 **전에** 실행되므로, 자식 안에서
  // 컨테이너 ref를 읽으면 최초 마운트 때 항상 null이다.
  const railRef = useRef<HTMLElement>(null);
  const [railBox, setRailBox] = useState<RailBox | null>(null);
  useLayoutEffect(() => {
    const active = railRef.current?.querySelector<HTMLElement>('[data-active]');
    if (active) setRailBox({ top: active.offsetTop, height: active.offsetHeight });
  }, [section]);
  const badgeOf: Record<SectionKey, number | undefined> = {
    chats: unreadTotal,
    friends: incomingCount,
    profile: undefined,
  };

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
        navigate('/friends', { state: { focusSearch: true } });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-full w-full flex-col bg-white md:flex-row">
      {/* 네비 레일 — 데스크탑 전용, 파치먼트 표면 */}
      <nav
        ref={railRef}
        className="relative isolate hidden w-20 shrink-0 flex-col gap-1 border-r border-hairline bg-canvas-soft p-2 md:flex"
      >
        <RailIndicator box={railBox} />
        {SECTIONS.map((entry) => (
          <RailItem
            key={entry.key}
            to={entry.to}
            label={entry.label}
            icon={entry.icon}
            active={section === entry.key}
            badge={badgeOf[entry.key]}
          />
        ))}
      </nav>

      {/* 리스트 컬럼 — 활성 섹션. 모바일에서 대화 중이면 숨긴다. */}
      <aside
        className={`min-h-0 min-w-0 overflow-y-auto scroll-thin border-hairline md:w-[320px] md:shrink-0 md:border-r lg:w-[360px] ${
          inChat ? 'hidden md:block' : 'block flex-1 md:flex-none'
        }`}
      >
        {section === 'chats' ? (
          <ChatsTab />
        ) : section === 'friends' ? (
          <FriendsTab />
        ) : (
          <ProfileTab />
        )}
      </aside>

      {/* 디테일 컬럼 — 대화(Outlet). 모바일에서는 대화 중일 때만 표시한다. */}
      <main className={`min-h-0 min-w-0 flex-1 ${inChat ? 'flex' : 'hidden md:flex'}`}>
        <Outlet />
      </main>

      {/* 하단 탭 바 — 모바일 전용. 대화 중에는 숨긴다(ChatRoom 자체 뒤로가기 사용). */}
      {!inChat && (
        <nav className="frosted pb-safe relative flex shrink-0 border-t border-hairline md:hidden">
          <TabIndicator index={sectionIndex} />
          {SECTIONS.map((entry) => (
            <Tab
              key={entry.key}
              to={entry.to}
              label={entry.label}
              icon={entry.icon}
              active={section === entry.key}
              badge={badgeOf[entry.key]}
            />
          ))}
        </nav>
      )}
    </div>
  );
}
