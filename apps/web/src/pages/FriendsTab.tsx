/**
 * 친구 탭 — 아이디 검색 → 친구 요청 → 수락/거절 → 친구 목록
 */
import type { PublicUser } from '@litechat/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, unwrap } from '../api';
import { useFriendRequests, useFriends } from '../data';
import { SEARCH_EVENT } from './Shell';

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
          className="rounded-full bg-primary px-3 py-1 text-xs font-normal text-white active:scale-95"
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

  const { data: friends } = useFriends();
  const { data: requests } = useFriendRequests();

  // Ctrl/Cmd+K → 검색 입력 포커스 (Shell에서 발행하는 커스텀 이벤트)
  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener(SEARCH_EVENT, focus);
    return () => window.removeEventListener(SEARCH_EVENT, focus);
  }, []);

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
            className="w-full rounded-xl bg-canvas-soft px-4 py-2.5 text-[16px] outline-none focus:bg-canvas-soft focus:ring-2 focus:ring-primary-subdued"
            autoCapitalize="none"
          />
        </div>
      </header>

      {notice && (
        <p className="px-4 py-2 text-center text-sm text-primary" onClick={() => setNotice('')}>
          {notice}
        </p>
      )}

      {/* 검색 결과 */}
      {debounced && (
        <section className="border-b border-hairline pb-2">
          <h2 className="px-4 pt-2 pb-1 text-xs font-medium text-ink-mute">검색 결과</h2>
          {searchResults?.length === 0 && (
            <p className="px-4 py-3 text-sm text-ink-mute">‘{debounced}’ 사용자를 찾지 못했어요.</p>
          )}
          {searchResults?.map((user) => (
            <div key={user.id} className="flex items-center justify-between px-4 py-2">
              <div>
                <p className="font-normal">{user.nickname}</p>
                <p className="text-xs text-ink-mute">@{user.username}</p>
              </div>
              <RelationAction user={user} onAdd={(id) => addFriend.mutate(id)} />
            </div>
          ))}
        </section>
      )}

      {/* 받은 친구 요청 */}
      {requests && requests.incoming.length > 0 && (
        <section className="border-b border-hairline pb-2">
          <h2 className="px-4 pt-2 pb-1 text-xs font-medium text-ink-mute">받은 요청</h2>
          {requests.incoming.map((request) => (
            <div key={request.id} className="flex items-center justify-between px-4 py-2">
              <div>
                <p className="font-normal">{request.user.nickname}</p>
                <p className="text-xs text-ink-mute">@{request.user.username}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => respond.mutate({ id: request.id, accept: true })}
                  className="rounded-full bg-primary px-3 py-1 text-xs font-normal text-white active:scale-95"
                >
                  수락
                </button>
                <button
                  onClick={() => respond.mutate({ id: request.id, accept: false })}
                  className="rounded-full bg-hairline px-3 py-1 text-xs font-normal text-ink-secondary active:scale-95"
                >
                  거절
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 친구 목록 */}
      <section>
        <h2 className="px-4 pt-3 pb-1 text-xs font-medium text-ink-mute">
          친구 {friends?.length ?? 0}
        </h2>
        {friends?.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-ink-mute">
            위 검색창에서 아이디로 친구를 찾아보세요.
          </p>
        )}
        {friends?.map(({ user, c }) => (
          <Link
            key={user.id}
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
        ))}
      </section>
    </div>
  );
}
