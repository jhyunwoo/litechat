/**
 * 인증 서비스 — 회원가입/로그인의 비즈니스 로직
 *
 * 비밀번호는 argon2id(Bun.password 내장)로 해시한다.
 * 해시 비용은 config로 조절 가능해서 테스트에서는 낮춰 빠르게 돌린다.
 */
import type { PublicUser, RegisterInput } from '@litechat/types';
import type { AppDeps } from '../../deps';
import { unlinkSync } from 'node:fs';
import { errors } from '../../errors';
import { UsersRepo } from './repo';

export class AuthService {
  private repo: UsersRepo;

  constructor(private deps: AppDeps) {
    this.repo = new UsersRepo(deps.db);
  }

  /** 회원가입 — 아이디 중복이면 USERNAME_TAKEN(409) */
  async register(input: RegisterInput): Promise<PublicUser> {
    const hash = await Bun.password.hash(input.password, {
      algorithm: 'argon2id',
      memoryCost: this.deps.config.passwordMemoryCost,
      timeCost: this.deps.config.passwordTimeCost,
    });
    try {
      const id = this.repo.insert(input.username, hash, input.nickname);
      return { id, username: input.username, nickname: input.nickname };
    } catch (error) {
      // UNIQUE 제약 위반 = 이미 존재하는 아이디
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw errors.usernameTaken();
      }
      throw error;
    }
  }

  /** 로그인 — 자격증명이 틀리면 null (구체적인 실패 사유는 노출하지 않음) */
  async login(username: string, password: string): Promise<PublicUser | null> {
    const row = this.repo.findByUsername(username);
    if (!row) return null;
    const valid = await Bun.password.verify(password, row.password_hash);
    if (!valid) return null;
    return { id: row.id, username: row.username, nickname: row.nickname };
  }

  /** 현재 사용자 조회 (me 엔드포인트용) */
  getUserById(id: number): PublicUser | null {
    return this.repo.findPublicById(id);
  }

  /** 비밀번호 재인증 후 계정 및 개발자가 관리하는 연결 데이터를 영구 삭제한다. */
  async deleteAccount(userId: number, password: string): Promise<void> {
    const row = this.repo.findById(userId);
    if (!row || !(await Bun.password.verify(password, row.password_hash))) {
      throw errors.invalidCredentials();
    }

    const imagePaths = this.deps.db
      .query<{ orig_path: string; webp_path: string }, [number]>(
        'SELECT orig_path, webp_path FROM images WHERE owner_id = ?',
      )
      .all(userId)
      .flatMap((image) => [image.orig_path, image.webp_path]);

    this.deps.db.transaction(() => {
      this.deps.db
        .query(
          `DELETE FROM content_reports
           WHERE reporter_id = ? OR reported_user_id = ?
              OR message_id IN (
                SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id
                WHERE c.user_a = ? OR c.user_b = ?
              )`,
        )
        .run(userId, userId, userId, userId);
      this.deps.db
        .query(
          'DELETE FROM notification_log WHERE user_id = ? OR conversation_id IN (SELECT id FROM conversations WHERE user_a = ? OR user_b = ?)',
        )
        .run(userId, userId, userId);
      for (const table of ['analytics_events', 'analytics_vitals']) {
        this.deps.db
          .query(
            `DELETE FROM ${table} WHERE session_id IN (SELECT id FROM analytics_sessions WHERE user_id = ?)`,
          )
          .run(userId);
      }
      this.deps.db.query('DELETE FROM analytics_sessions WHERE user_id = ?').run(userId);
      this.deps.db
        .query(
          'DELETE FROM message_reads WHERE user_id = ? OR conversation_id IN (SELECT id FROM conversations WHERE user_a = ? OR user_b = ?)',
        )
        .run(userId, userId, userId);
      this.deps.db
        .query(
          'DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_a = ? OR user_b = ?)',
        )
        .run(userId, userId);
      this.deps.db.query('DELETE FROM images WHERE owner_id = ?').run(userId);
      this.deps.db
        .query('DELETE FROM conversations WHERE user_a = ? OR user_b = ?')
        .run(userId, userId);
      this.deps.db
        .query('DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?')
        .run(userId, userId);
      this.deps.db
        .query('DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?')
        .run(userId, userId);
      this.deps.db.query('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
      this.deps.db.query('DELETE FROM expo_push_tokens WHERE user_id = ?').run(userId);
      this.deps.db.query('DELETE FROM insights_watch WHERE user_id = ?').run(userId);
      this.deps.db.query('DELETE FROM users WHERE id = ?').run(userId);
    })();

    for (const path of imagePaths) {
      try {
        unlinkSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('Failed to remove deleted-account image file');
        }
      }
    }
  }
}
