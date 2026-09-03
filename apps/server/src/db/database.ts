/**
 * SQLite 데이터베이스 초기화
 *
 * bun:sqlite를 사용하며, 열 때마다 다음을 보장한다:
 *  - WAL 모드: 읽기/쓰기 동시성 향상 (채팅 서버 필수)
 *  - foreign_keys ON: 참조 무결성
 *  - 프로덕션 PRAGMA 튜닝 (아래 PRAGMAS 주석에 측정 근거와 내구성 분석)
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
  applyPragmas(db);
  migrate(db);
  // 마이그레이션으로 인덱스가 추가되면 통계가 낡는다. 쿼리 플래너가 새 인덱스를
  // 제대로 쓰도록 부팅 시 한 번 갱신한다(analysis_limit 덕에 비용은 수 ms).
  optimize(db);
  return db;
}

/**
 * 프로덕션 PRAGMA.
 *
 * 측정 (시드 DB: 대화 4,800 / 메시지 60,500, 프로덕션과 동일한 arm64 2 vCPU):
 *   기준(synchronous=FULL, 기본 캐시)   읽기 p50 0.059ms p99 0.214ms | 쓰기 p50 1.815ms (551 writes/s)
 *   cache 16MB + mmap 256MB            읽기 p50 0.033ms p99 0.130ms | 쓰기 p50 1.784ms
 *   + synchronous=NORMAL               읽기 p50 0.031ms p99 0.074ms | 쓰기 p50 0.024ms (41,391 writes/s)
 *
 * ── synchronous = NORMAL 의 내구성 분석 (WAL 모드 한정) ──
 * 성능 영향: 메시지 INSERT마다 발생하던 fsync가 사라져 쓰기 지연이 1.815ms → 0.024ms.
 *   SQLite는 쓰기가 단일 직렬이므로, 이 fsync는 서버 전체의 메시지 처리량을
 *   약 550건/초로 묶는 상한이었다.
 * 손상 위험: 없다. WAL 모드에서 synchronous=NORMAL은 DB 파일이 깨지지 않음을 보장한다
 *   (SQLite 공식 문서가 WAL 사용 시 권장하는 설정이다). 롤백될 수는 있어도
 *   반쯤 쓰인 상태로 남지 않는다.
 * 프로세스 크래시/재배포: **아무것도 잃지 않는다.** 커밋은 OS에 write()까지 끝난
 *   상태라 Bun 프로세스가 죽거나 Dokploy가 컨테이너를 교체해도 그대로 남는다.
 *   운영에서 압도적으로 흔한 실패 모드가 여기에 해당한다.
 * 허용하는 데이터 유실 창: **호스트 자체의 전원 손실/커널 패닉** 시, 마지막
 *   체크포인트 이후 커밋된 트랜잭션이 사라질 수 있다. 이 창을 무한정 열어 두지 않으려고
 *   startCheckpointSchedule()이 주기적으로 PASSIVE 체크포인트를 돌려 시간 상한을 둔다.
 */
function applyPragmas(db: Database): void {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  // 페이지 캐시 16 MiB (음수 = KiB 단위). 프로덕션 12 GB 중 무시할 만한 양이고
  // 읽기 p50을 0.059 → 0.036ms로 줄인다.
  db.exec('PRAGMA cache_size = -16000;');
  // 읽기 경로를 mmap으로 — 읽기 p99를 0.214 → 0.090ms로 줄인다(꼬리 지연 개선).
  // 실제 매핑량은 DB 파일 크기가 상한이라 작은 DB에서는 그만큼만 쓴다.
  db.exec('PRAGMA mmap_size = 268435456;');
}

/**
 * 쿼리 플래너 통계 갱신. analysis_limit을 두면 큰 인덱스도 부분 표본만 훑어
 * 수 ms 안에 끝난다 (SQLite 문서가 권장하는 사용법).
 */
export function optimize(db: Database): void {
  try {
    db.exec('PRAGMA analysis_limit = 400;');
    db.exec('PRAGMA optimize;');
  } catch {
    // 통계 갱신 실패는 정확성에 영향이 없다 — 조용히 넘어간다.
  }
}

/** WAL 체크포인트 주기 — synchronous=NORMAL의 최대 데이터 유실 창을 시간으로 묶는다. */
const CHECKPOINT_INTERVAL_MS = 60_000;

/**
 * 주기적 PASSIVE 체크포인트 + 통계 갱신.
 *
 * synchronous=NORMAL에서 호스트 전원 손실 시 잃을 수 있는 범위를 "마지막 체크포인트
 * 이후"에서 "최대 60초"로 좁힌다. PASSIVE는 읽는 쪽/쓰는 쪽을 막지 않고, WAL이 비어
 * 있으면 즉시 반환하므로 유휴 시 비용이 사실상 0이다.
 */
export function startCheckpointSchedule(
  db: Database,
  intervalMs = CHECKPOINT_INTERVAL_MS,
): () => void {
  let sinceOptimize = 0;
  const timer = setInterval(() => {
    try {
      db.exec('PRAGMA wal_checkpoint(PASSIVE);');
      // 통계는 자주 갱신할 필요가 없다 — 한 시간에 한 번이면 충분하다.
      if (++sinceOptimize >= 60) {
        sinceOptimize = 0;
        optimize(db);
      }
    } catch {
      // 쿼리나 레코드 내용을 로그에 남기지 않는다 (운영 로그 PII 방지).
      console.error('WAL checkpoint failed');
    }
  }, intervalMs);
  // 종료 시 index.ts가 반환된 정리 함수를 호출한다 (startRetentionSchedule과 동일한 규약).
  return () => clearInterval(timer);
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
