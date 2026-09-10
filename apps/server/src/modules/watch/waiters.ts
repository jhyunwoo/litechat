import { ApiError } from '../../errors';

/** In-process invalidation only. SQLite and the current deployment are single-process.
 * Subscribe before querying; all authoritative state is re-read after waking. */
export class WatchWaiters {
  private entries = new Set<{
    user: number;
    session: string;
    conversation: number;
    wake: () => void;
  }>();
  get size() {
    return this.entries.size;
  }
  subscribe(
    user: number,
    session: string,
    conversation: number,
    seconds: number,
    signal: AbortSignal,
  ) {
    if (
      this.entries.size >= 1000 ||
      [...this.entries].filter((e) => e.user === user).length >= 4 ||
      [...this.entries].some((e) => e.session === session)
    )
      throw new ApiError(429, 'POLL_LIMIT');
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    const entry = { user, session, conversation, wake: () => resolve() };
    const timer = setTimeout(entry.wake, seconds * 1000);
    const cancel = () => {
      clearTimeout(timer);
      this.entries.delete(entry);
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    this.entries.add(entry);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    return { promise, cancel };
  }
  wakeConversation(id: number) {
    for (const e of this.entries) if (e.conversation === id) e.wake();
  }
  wakeUser(id: number) {
    for (const e of this.entries) if (e.user === id) e.wake();
  }
  close() {
    for (const e of this.entries) e.wake();
  }
}
