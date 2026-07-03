/**
 * users 테이블 저장소 — 사용자 관련 SQL을 한곳에 모은다.
 */
import type { Database } from 'bun:sqlite';
import type { PublicUser } from '@litechat/types';

/** DB 행 형태 (내부용 — password_hash 포함) */
interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  nickname: string;
}

export class UsersRepo {
  constructor(private db: Database) {}

  /** 사용자 생성 — UNIQUE 위반은 호출자가 처리한다. @returns 생성된 ID */
  insert(username: string, passwordHash: string, nickname: string): number {
    const result = this.db
      .query('INSERT INTO users (username, password_hash, nickname, created_at) VALUES (?, ?, ?, ?)')
      .run(username, passwordHash, nickname, Math.floor(Date.now() / 1000));
    return Number(result.lastInsertRowid);
  }

  /** 아이디로 조회 (로그인용 — 해시 포함) */
  findByUsername(username: string): UserRow | null {
    return this.db
      .query<UserRow, [string]>(
        'SELECT id, username, password_hash, nickname FROM users WHERE username = ?',
      )
      .get(username);
  }

  /** ID로 공개 정보 조회 */
  findPublicById(id: number): PublicUser | null {
    return this.db
      .query<PublicUser, [number]>('SELECT id, username, nickname FROM users WHERE id = ?')
      .get(id);
  }

  /** 아이디 전방 일치 검색 (친구 찾기) — 정확한 아이디 우선 정렬 */
  searchByUsername(query: string, limit: number): PublicUser[] {
    // LIKE 패턴 문자를 이스케이프해 리터럴 검색을 보장한다.
    const escaped = query.replace(/[%_\\]/g, (ch) => `\\${ch}`);
    return this.db
      .query<PublicUser, [string, string, number]>(
        `SELECT id, username, nickname FROM users
         WHERE username LIKE ? ESCAPE '\\'
         ORDER BY (username = ?) DESC, username ASC
         LIMIT ?`,
      )
      .all(`${escaped}%`, query, limit);
  }
}
