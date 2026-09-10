import { expect, test } from 'bun:test';
import { WatchWaiters } from './waiters';
test('per-account waiter limit and cancellation cleanup', () => {
  const hub = new WatchWaiters();
  const abort = new AbortController();
  const waits = Array.from({ length: 4 }, (_, i) =>
    hub.subscribe(1, String(i), 1, 20, abort.signal),
  );
  expect(() => hub.subscribe(1, 'fifth', 1, 20, abort.signal)).toThrow('POLL_LIMIT');
  abort.abort();
  expect(hub.size).toBe(0);
  for (const w of waits) w.cancel();
});
test('server-wide waiter limit is bounded', () => {
  const hub = new WatchWaiters();
  const waits = [];
  for (let i = 0; i < 1000; i++)
    waits.push(hub.subscribe(i, String(i), i, 20, new AbortController().signal));
  expect(() => hub.subscribe(1001, 'overflow', 1, 20, new AbortController().signal)).toThrow(
    'POLL_LIMIT',
  );
  for (const w of waits) w.cancel();
  expect(hub.size).toBe(0);
});
