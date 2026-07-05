/**
 * 최초 관리자 계정 부트스트랩 — 대시보드에는 가입 플로우가 없으므로 1회성 CLI로 생성한다.
 *
 * 사용법: bun run apps/server/scripts/create-admin.ts <username> <password>
 */
import { usernameSchema, passwordSchema } from '@litechat/types';
import { createConfig } from '../src/config';
import { openDatabase } from '../src/db/database';
import { AdminRepo } from '../src/modules/admin/repo';

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error('사용법: bun run apps/server/scripts/create-admin.ts <username> <password>');
  process.exit(1);
}

const parsedUsername = usernameSchema.safeParse(username);
if (!parsedUsername.success) {
  console.error('username 형식이 올바르지 않습니다 (영문 소문자/숫자/밑줄 3~20자).');
  process.exit(1);
}

const parsedPassword = passwordSchema.safeParse(password);
if (!parsedPassword.success) {
  console.error('password는 8~72자여야 합니다.');
  process.exit(1);
}

const config = createConfig();
const db = openDatabase(config.dbPath);
const repo = new AdminRepo(db);

if (repo.findByUsername(username)) {
  console.error(`이미 존재하는 관리자 계정입니다: ${username}`);
  process.exit(1);
}

const passwordHash = await Bun.password.hash(password, {
  algorithm: 'argon2id',
  memoryCost: config.passwordMemoryCost,
  timeCost: config.passwordTimeCost,
});
repo.create(username, passwordHash);

console.log(`관리자 계정 생성 완료: ${username}`);
