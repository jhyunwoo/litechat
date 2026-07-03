/**
 * SQLite 데이터베이스 초기화
 *
 * bun:sqlite를 사용하며, 열 때마다 다음을 보장한다:
 *  - WAL 모드: 읽기/쓰기 동시성 향상 (채팅 서버 필수)
 *  - foreign_keys ON: 참조 무결성
 *  - 마이그레이션 자동 적용 (PRAGMA user_version 기반)
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations';

/** DB 파일을 열고 PRAGMA 및 마이그레이션을 적용해 반환한다. */
export function openDatabase(dbPath: string): Database {
  // 파일 기반 DB라면 상위 디렉터리를 먼저 만들어 둔다.
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  migrate(db);
  return db;
}

/** 현재 user_version 이후의 마이그레이션을 순서대로 트랜잭션으로 적용한다. */
function migrate(db: Database): void {
  const row = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
  let version = row?.user_version ?? 0;

  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]!;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    })();
    version += 1;
  }
}

/** 테스트용 순수 인메모리 DB */
export function openTestDatabase(): Database {
  return openDatabase(':memory:');
}
