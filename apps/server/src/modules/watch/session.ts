import { createHash, randomBytes } from 'node:crypto';
import type { AppDeps } from '../../deps';

const prefix = 'watchsess:';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export interface WatchSession {
  id: string;
  user_id: number;
  expires_at: number;
}

export async function createWatchSession(deps: AppDeps, userId: number) {
  const token = 'w_' + randomBytes(32).toString('base64url');
  const id = hash(token);
  const now = Math.floor(Date.now() / 1000);
  deps.db
    .query(
      `INSERT INTO watch_sessions(id,user_id,created_at,last_activity,expires_at)
    VALUES(?,?,?,?,?)`,
    )
    .run(id, userId, now, now, now + deps.config.sessionTtlSeconds);
  try {
    await deps.kv.set(prefix + id, String(userId), deps.config.sessionTtlSeconds);
  } catch (e) {
    deps.db.query('DELETE FROM watch_sessions WHERE id=?').run(id);
    throw e;
  }
  return token;
}

export async function validateWatchSession(
  deps: AppDeps,
  token: string,
): Promise<WatchSession | null> {
  if (!/^w_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const id = hash(token);
  const now = Math.floor(Date.now() / 1000);
  const user = await deps.kv.getAndRefresh(prefix + id, deps.config.sessionTtlSeconds);
  if (!user) return null;
  // Check durable revocation after the Redis await: revocation can never resurrect a session.
  const row = deps.db
    .query<WatchSession, [string, number]>(
      `SELECT s.id,s.user_id,s.expires_at FROM watch_sessions s
    JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.revoked=0 AND s.expires_at>?`,
    )
    .get(id, now);
  if (!row || row.user_id !== Number(user)) return null;
  deps.db
    .query('UPDATE watch_sessions SET last_activity=?,expires_at=? WHERE id=? AND revoked=0')
    .run(now, now + deps.config.sessionTtlSeconds, id);
  return row;
}

export function revokeWatchSessions(deps: AppDeps, userId: number, id?: string) {
  const filter = id ? 'user_id=? AND id=?' : 'user_id=?';
  const params = id ? [userId, id] : [userId];
  deps.db.transaction(() => {
    deps.db
      .query(
        `DELETE FROM watch_push_tokens WHERE session_id IN (SELECT id FROM watch_sessions WHERE ${filter})`,
      )
      .run(...params);
    deps.db.query(`UPDATE watch_sessions SET revoked=1 WHERE ${filter}`).run(...params);
  })();
  deps.watchWaiters.wakeUser(userId);
}
