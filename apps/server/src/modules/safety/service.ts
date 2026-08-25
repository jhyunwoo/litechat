import type { ContentReportInput } from '@litechat/types';
import type { AppDeps } from '../../deps';
import { errors } from '../../errors';
import { UsersRepo } from '../auth/repo';
import { SafetyRepo } from './repo';

export class SafetyService {
  readonly repo: SafetyRepo;
  private users: UsersRepo;

  constructor(private deps: AppDeps) {
    this.repo = new SafetyRepo(deps.db);
    this.users = new UsersRepo(deps.db);
  }

  block(meId: number, targetId: number): void {
    if (meId === targetId) throw errors.badRequest('CANNOT_BLOCK_SELF');
    if (!this.users.findPublicById(targetId)) throw errors.notFound();
    this.deps.db.transaction(() => {
      this.repo.block(meId, targetId);
      this.deps.db
        .query(
          `DELETE FROM friendships
           WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
        )
        .run(meId, targetId, targetId, meId);
    })();
  }

  report(meId: number, input: ContentReportInput): number {
    if (meId === input.userId) throw errors.badRequest('CANNOT_REPORT_SELF');
    if (!this.users.findPublicById(input.userId)) throw errors.notFound();
    if (input.messageId && !this.repo.canReferenceMessage(meId, input.userId, input.messageId)) {
      throw errors.notFound();
    }
    return this.repo.report(meId, input);
  }
}
