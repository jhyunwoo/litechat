/**
 * 인증 서비스 — 회원가입/로그인의 비즈니스 로직
 *
 * 비밀번호는 argon2id(Bun.password 내장)로 해시한다.
 * 해시 비용은 config로 조절 가능해서 테스트에서는 낮춰 빠르게 돌린다.
 */
import type { PublicUser, RegisterInput } from '@litechat/types';
import type { AppDeps } from '../../deps';
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
}
