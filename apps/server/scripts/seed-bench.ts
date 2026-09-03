/**
 * 벤치마크용 합성 데이터 시드 (일회용 로컬 DB 전용)
 *
 * 운영 데이터와 절대 섞이지 않도록 반드시 DB_PATH를 임시 경로로 지정해 실행한다:
 *   DB_PATH=/tmp/bench.db bun apps/server/scripts/seed-bench.ts
 */
import { openDatabase } from '../src/db/database';

const dbPath = process.env.DB_PATH;
if (!dbPath || dbPath === ':memory:' || dbPath.includes('data/litechat.db')) {
  console.error('Refusing to seed: set DB_PATH to a disposable path.');
  process.exit(1);
}

const USERS = Number(process.env.SEED_USERS ?? 400);
const FRIENDS_PER_USER = Number(process.env.SEED_FRIENDS ?? 12);
const MESSAGES = Number(process.env.SEED_MESSAGES ?? 60_000);

const db = openDatabase(dbPath);
const now = Math.floor(Date.now() / 1000);

// 모든 벤치 계정이 같은 비밀번호 해시를 공유한다 (해시 비용은 인증 벤치에서 따로 잰다).
const hash = await Bun.password.hash('benchpassword', { algorithm: 'argon2id', memoryCost: 4096, timeCost: 2 });

console.time('seed');
db.exec('PRAGMA synchronous = OFF;');

db.transaction(() => {
  const insertUser = db.query(
    'INSERT INTO users (username, password_hash, nickname, created_at) VALUES (?, ?, ?, ?)',
  );
  for (let i = 1; i <= USERS; i++) insertUser.run(`bench${i}`, hash, `벤치사용자${i}`, now - 86400 * 30);
})();

db.transaction(() => {
  const insertFriend = db.query(
    "INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'accepted', ?)",
  );
  const insertConv = db.query(
    'INSERT OR IGNORE INTO conversations (user_a, user_b, created_at) VALUES (?, ?, ?)',
  );
  for (let a = 1; a <= USERS; a++) {
    for (let k = 1; k <= FRIENDS_PER_USER; k++) {
      const b = ((a + k * 7 - 1) % USERS) + 1;
      if (a === b) continue;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      insertFriend.run(lo, hi, now - 86400 * 20);
      insertConv.run(lo, hi, now - 86400 * 20);
    }
  }
})();

const convRows = db.query<{ id: number; user_a: number; user_b: number }, []>(
  'SELECT id, user_a, user_b FROM conversations',
).all();

// 메시지는 대화 사이에 지프(zipf)스럽게 분포시킨다 — 소수의 대화가 아주 길다.
db.transaction(() => {
  const insertMsg = db.query(
    'INSERT INTO messages (conversation_id, sender_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (let i = 0; i < MESSAGES; i++) {
    const idx = Math.floor(convRows.length * Math.random() ** 3); // 앞쪽 대화에 집중
    const conv = convRows[Math.min(idx, convRows.length - 1)]!;
    const sender = i % 2 === 0 ? conv.user_a : conv.user_b;
    insertMsg.run(conv.id, sender, 't', `벤치 메시지 ${i} — 실제 대화와 비슷한 길이의 한국어 문장입니다.`, now - (MESSAGES - i) * 5);
  }
})();

// 읽음 워터마크 — 대부분의 대화는 거의 다 읽은 상태
db.transaction(() => {
  const insertRead = db.query(
    'INSERT OR REPLACE INTO message_reads (conversation_id, user_id, last_read_message_id) VALUES (?, ?, ?)',
  );
  const maxIdOf = db.query<{ m: number | null }, [number]>(
    'SELECT MAX(id) AS m FROM messages WHERE conversation_id = ?',
  );
  for (const conv of convRows) {
    const max = maxIdOf.get(conv.id)?.m ?? 0;
    insertRead.run(conv.id, conv.user_a, Math.max(0, max - 2));
    insertRead.run(conv.id, conv.user_b, Math.max(0, max - 5));
  }
})();

// 이미지 메시지 — 이미지 접근 제어 쿼리 벤치용
db.transaction(() => {
  const insertImage = db.query(
    'INSERT INTO images (id, owner_id, orig_path, webp_path, orig_bytes, webp_bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertMsg = db.query(
    "INSERT INTO messages (conversation_id, sender_id, kind, content, created_at) VALUES (?, ?, 'i', ?, ?)",
  );
  for (let i = 0; i < 500; i++) {
    const conv = convRows[i % convRows.length]!;
    const id = `benchimg${i.toString().padStart(6, '0')}`;
    insertImage.run(id, conv.user_a, `/tmp/${id}.jpg`, `/tmp/${id}.thumb.webp`, 2_000_000, 40_000, 640, 480, now);
    insertMsg.run(conv.id, conv.user_a, id, now);
  }
})();

db.exec('PRAGMA synchronous = FULL;');
db.exec('ANALYZE;');
// WAL을 본 파일로 합쳐 db 파일 하나만 복사해도 데이터가 온전하도록 한다.
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
console.timeEnd('seed');

for (const t of ['users', 'friendships', 'conversations', 'messages', 'message_reads', 'images']) {
  const n = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${t}`).get()!.n;
  console.log(`${t.padEnd(16)} ${n}`);
}
console.log('db file bytes:', Bun.file(dbPath).size);
