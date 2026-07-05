/**
 * admin_users 테이블 저장소 — 채팅 users 테이블과 완전히 분리된 별도 계정.
 */
import type { Database } from 'bun:sqlite';

export interface AdminUserRow {
  id: number;
  username: string;
  password_hash: string;
}

export class AdminRepo {
  constructor(private db: Database) {}

  findByUsername(username: string): AdminUserRow | null {
    return (
      this.db
        .query<AdminUserRow, [string]>(
          'SELECT id, username, password_hash FROM admin_users WHERE username = ?',
        )
        .get(username) ?? null
    );
  }

  findById(id: number): Pick<AdminUserRow, 'id' | 'username'> | null {
    return (
      this.db.query<Pick<AdminUserRow, 'id' | 'username'>, [number]>(
        'SELECT id, username FROM admin_users WHERE id = ?',
      ).get(id) ?? null
    );
  }

  /** 최초 계정 부트스트랩 스크립트(scripts/create-admin.ts)에서만 사용한다. */
  create(username: string, passwordHash: string): void {
    this.db
      .query('INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, passwordHash, Math.floor(Date.now() / 1000));
  }
}
