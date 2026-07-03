/**
 * 데이터베이스 초기화/마이그레이션 단위 테스트
 */
import { describe, expect, test } from 'bun:test';
import { openTestDatabase } from './database';
import { MIGRATIONS } from './migrations';

describe('openDatabase', () => {
  test('마이그레이션을 모두 적용하고 user_version을 올린다', () => {
    const db = openTestDatabase();
    const row = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
    expect(row?.user_version).toBe(MIGRATIONS.length);
  });

  test('필수 테이블이 모두 생성된다', () => {
    const db = openTestDatabase();
    const tables = db
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((r) => r.name);
    for (const table of [
      'users',
      'friendships',
      'conversations',
      'messages',
      'message_reads',
      'images',
      'push_subscriptions',
    ]) {
      expect(tables).toContain(table);
    }
  });

  test('friendships는 방향과 무관하게 한 쌍당 하나만 허용한다', () => {
    const db = openTestDatabase();
    db.exec(
      `INSERT INTO users (username, password_hash, nickname, created_at)
       VALUES ('alice', 'h', 'Alice', 0), ('bob', 'h', 'Bob', 0)`,
    );
    db.exec(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
       VALUES (1, 2, 'pending', 0)`,
    );
    // 반대 방향(2 → 1)의 중복 요청은 UNIQUE 인덱스 위반이어야 한다.
    expect(() =>
      db.exec(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
         VALUES (2, 1, 'pending', 0)`,
      ),
    ).toThrow();
  });

  test('자기 자신과의 친구 관계는 금지된다', () => {
    const db = openTestDatabase();
    db.exec(
      `INSERT INTO users (username, password_hash, nickname, created_at)
       VALUES ('alice', 'h', 'Alice', 0)`,
    );
    expect(() =>
      db.exec(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
         VALUES (1, 1, 'pending', 0)`,
      ),
    ).toThrow();
  });
});
