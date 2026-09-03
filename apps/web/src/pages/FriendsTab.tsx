/**
 * 친구 탭 — 아이디 검색 → 친구 요청 → 수락/거절 → 친구 목록
 */
import type { PublicUser } from '@litechat/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api, errorMessage, unwrap } from '../api';
import { useFriendRequests, useFriends } from '../data';

type SearchUser = PublicUser & { rel: string };

/** 검색 결과의 관계 상태 → 버튼/라벨 */
function RelationAction({ user, onAdd }: { user: SearchUser; onAdd: (id: number) => void }) {
  switch (user.rel) {
    case 'self':
      return <span className="text-xs text-ink-mute">나</span>;
    case 'friends':
      return <span className="text-xs text-ink-mute">친구</span>;
    case 'pending_out':
      return <span className="text-xs text-ink-mute">요청됨</span>;
    case 'pending_in':
      return <span className="text-xs text-primary">받은 요청 확인</span>;
    default:
      return (
        <button
          onClick={() => onAdd(user.id)}
          className="min-h-11 shrink-0 rounded-full bg-primary px-5 text-sm font-normal text-white transition active:scale-95"
        >
          친구 추가
        </button>
      );
  }
}

export default function FriendsTab() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [notice, setNotice] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();

  const { data: friends } = useFriends();
  const { data: requests } = useFriendRequests();

  // Ctrl/Cmd+K → 라우트가 마운트된 후 검색 입력을 포커스한다.
  useEffect(() => {
    if ((location.state as { focusSearch?: boolean } | null)?.focusSearch) {
      searchRef.current?.focus();
    }
  }, [location.state]);

  // 입력 250ms 디바운스 — 타이핑마다 요청하지 않는다.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: searchResults } = useQuery({
    queryKey: ['search', debounced],
    queryFn: async () => {
      const res = await api.api.friends.search.$get({ query: { q: debounced } });
      return (await unwrap<{ users: SearchUser[] }>(res)).users;
    },
    enabled: debounced.length > 0,
  });

  const addFriend = useMutation({
    mutationFn: async (userId: number) => {
      const res = await api.api.friends.requests.$post({ json: { userId } });
      await unwrap(res);
    },
    onSuccess: () => {
      setNotice('친구 요청을 보냈어요!');
      void queryClient.invalidateQueries({ queryKey: ['search'] });
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  const respond = useMutation({
    mutationFn: async ({ id, accept }: { id: number; accept: boolean }) => {
      const res = await api.api.friends.requests[':id'].respond.$post({
        param: { id: String(id) },
        json: { accept },
      });
      await unwrap(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  return (
    <div>
      <header className="pt-safe frosted sticky top-0 z-10 border-b border-hairline">
        <h1 className="px-4 pt-3 display text-2xl">친구</h1>
        <div className="p-3">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="아이디로 검색 (Ctrl+K)"
            className="h-11 w-full rounded-full bg-canvas-soft px-5 text-[16px]"
            autoCapitalize="none"
          />
        </div>
      </header>

      <AnimatePresence>
        {notice && (
          <m.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden px-4 py-2 text-center text-sm text-primary"
            onClick={() => setNotice('')}
          >
            {notice}
          </m.p>
        )}
      </AnimatePresence>

      {/* 검색 결과 */}
      <AnimatePresence initial={false}>
        {debounced && (
          <m.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden border-b border-hairline pb-2"
          >
            <h2 className="px-4 pt-2 pb-1 text-xs font-semibold text-ink-mute">검색 결과</h2>
            {searchResults?.length === 0 && (
              <p className="px-4 py-3 text-sm text-ink-mute">
                ‘{debounced}’ 사용자를 찾지 못했어요.
              </p>
            )}
            {searchResults?.map((user, index) => (
              <m.div
                key={user.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 6) * 0.03, duration: 0.2 }}
                className="flex items-center justify-between gap-3 px-4 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-normal">{user.nickname}</p>
                  <p className="truncate text-xs text-ink-mute">@{user.username}</p>
                </div>
                <RelationAction user={user} onAdd={(id) => addFriend.mutate(id)} />
              </m.div>
            ))}
          </m.section>
        )}
      </AnimatePresence>

      {/* 받은 친구 요청 — 수락/거절하면 행이 접히며 사라진다 */}
      <AnimatePresence initial={false}>
        {requests && requests.incoming.length > 0 && (
          <m.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-b border-hairline pb-2"
          >
            <h2 className="px-4 pt-2 pb-1 text-xs font-semibold text-ink-mute">받은 요청</h2>
            <AnimatePresence initial={false}>
              {requests.incoming.map((request) => (
                <m.div
                  key={request.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-normal">{request.user.nickname}</p>
                      <p className="truncate text-xs text-ink-mute">@{request.user.username}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => respond.mutate({ id: request.id, accept: true })}
                        className="min-h-11 rounded-full bg-primary px-5 text-sm font-normal text-white transition active:scale-95"
                      >
                        수락
                      </button>
                      {/* button-secondary-pill — 두 번째 CTA는 고스트 필 */}
                      <button
                        onClick={() => respond.mutate({ id: request.id, accept: false })}
                        className="min-h-11 rounded-full border border-primary px-5 text-sm font-normal text-primary transition active:scale-95 active:bg-canvas-soft"
                      >
                        거절
                      </button>
                    </div>
                  </div>
                </m.div>
              ))}
            </AnimatePresence>
          </m.section>
        )}
      </AnimatePresence>

      {/* 친구 목록 */}
      <section>
        <h2 className="px-4 pt-3 pb-1 text-xs font-semibold text-ink-mute">
          친구 {friends?.length ?? 0}
        </h2>
        {friends?.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-ink-mute">
            위 검색창에서 아이디로 친구를 찾아보세요.
          </p>
        )}
        {friends?.map(({ user, c }, index) => (
          <m.div
            key={user.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.22 }}
          >
            <Link
              to={`/chat/${c}`}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-canvas-soft active:bg-canvas-soft"
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-ink font-semibold text-white">
                {user.nickname.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="truncate font-normal">{user.nickname}</p>
                <p className="text-xs text-ink-mute">@{user.username}</p>
              </div>
            </Link>
          </m.div>
        ))}
      </section>
    </div>
  );
}
