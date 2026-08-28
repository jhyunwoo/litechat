/**
 * SQLite 데이터베이스 초기화
 *
 * bun:sqlite를 사용하며, 열 때마다 다음을 보장한다:
 *  - WAL 모드: 읽기/쓰기 동시성 향상 (채팅 서버 필수)
 *  - foreign_keys ON: 참조 무결성
 *  - 마이그레이션 자동 적용 (PRAGMA user_version 기반)
 */
import { Database } from 'bun:sqlite';
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations';

/**
 * DB 경로가 실제로 쓰기 가능한지 부팅 시점에 확인한다.
 *
 * SQLite는 쓰기 권한이 없으면 예외 대신 조용히 읽기 전용 핸들을 돌려주기도 해서,
 * 확인하지 않으면 한참 뒤 첫 쓰기에서 SQLITE_READONLY로 터지고 스택트레이스에는
 * 정작 원인인 경로/권한이 남지 않는다. WAL은 -wal/-shm을 같은 디렉터리에 만들므로
 * 파일뿐 아니라 디렉터리 쓰기 권한도 함께 필요하다.
 */
function assertWritable(dbPath: string): void {
  const targets = [dirname(dbPath), ...(existsSync(dbPath) ? [dbPath] : [])];
  for (const target of targets) {
    try {
      accessSync(target, constants.W_OK);
    } catch {
      throw new Error(
        `database path is not writable: ${target} (opening ${dbPath}). ` +
          'The server runs as uid 1000; make the mounted data volume writable by that ' +
          'user (e.g. `chown -R 1000:1000` on the volume).',
      );
    }
  }
}

/** DB 파일을 열고 PRAGMA 및 마이그레이션을 적용해 반환한다. */
export function openDatabase(dbPath: string): Database {
  // 파일 기반 DB라면 상위 디렉터리를 먼저 만들어 두고, 쓰기 가능한지 확인한다.
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
    assertWritable(dbPath);
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
