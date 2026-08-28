/**
 * 데이터베이스 초기화/마이그레이션 단위 테스트
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, openTestDatabase } from './database';
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

/**
 * 컨테이너를 비root(uid 1000)로 전환하면서 기존 root 소유 볼륨을 그대로 마운트하면
 * SQLite가 조용히 읽기 전용으로 열리고, 첫 쓰기(보관기간 정리)에서야
 * SQLITE_READONLY로 터져 원인이 DB 경로 권한이라는 사실이 드러나지 않는다.
 * 부팅 시점에 경로를 담아 즉시 실패해야 운영자가 바로 조치할 수 있다.
 */
describe('openDatabase 쓰기 권한 검증', () => {
  // root는 퍼미션 비트를 무시하므로 이 조건을 재현할 수 없다.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  test.skipIf(asRoot)('DB 디렉터리에 쓸 수 없으면 경로를 담아 즉시 실패한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'litechat-readonly-'));
    const dbPath = join(dir, 'litechat.db');
    openDatabase(dbPath).close();
    chmodSync(dbPath, 0o444);
    chmodSync(dir, 0o555);

    try {
      expect(() => openDatabase(dbPath)).toThrow(dbPath);
    } finally {
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
