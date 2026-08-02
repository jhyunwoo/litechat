/**
 * 분석 수집 오케스트레이션 — IP/지오IP 조회, 방문자·세션 식별, 로그인 여부 파악 후 repo에 기록한다.
 *
 * 수집은 어떤 경우에도 사용자 요청을 실패시키면 안 되는 best-effort 작업이므로,
 * DB 쓰기 과정의 에러는 여기서 삼키고 로그만 남긴다. fire-and-forget 호출 순서가
 * 뒤집혀 event/vitals가 먼저 도착하는 경우에는 부모 세션을 즉시 복구한 뒤 기록한다.
 */
import type { Context } from 'hono';
import type {
  AnalyticsEventInput,
  AnalyticsSessionInput,
  AnalyticsVitalsInput,
} from '@litechat/types';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { tokenFromRequest } from '../../middleware/auth';
import { getSessionUserId } from '../auth/session';
import { ensureVisitorCookies, hasVisitorCookies, type VisitorIdentity } from './cookies';
import { clientIp } from './ip';
import { lookupGeo } from './geoip';
import { collectInsights } from './insights-collector';
import { AnalyticsRepo } from './repo';

export class AnalyticsService {
  private repo: AnalyticsRepo;

  constructor(private deps: AppDeps) {
    this.repo = new AnalyticsRepo(deps.db);
  }

  /** 로그인 세션(lc_sess/Bearer)이 있으면 userId, 없으면 null — 실패해도 요청을 막지 않는다. */
  private async resolveUserId(c: Context<AppEnv>): Promise<number | null> {
    const token = tokenFromRequest(c);
    if (!token) return null;
    return getSessionUserId(this.deps, token);
  }

  /**
   * 웹 브라우저는 lc_vid/lc_sid 쿠키를 보내므로 서버가 권위자 — body의 visitorId/sessionId는
   * 무시한다. 앱은 쿠키 저장소가 없으므로(별도 오리진 fetch) body에 실려 온 값을 그대로 신뢰한다.
   * /session은 platform이 확정돼 있어 그걸로 분기하고, platform이 없는 /event·/vitals는
   * 요청에 이미 쿠키가 실려 있는지로 web/app을 구분한다(쿠키는 /session 응답에서 web에만 발급됨).
   */
  private resolveIdentity(
    c: Context<AppEnv>,
    body: { visitorId?: string; sessionId?: string },
    forcePlatform?: 'web' | 'app',
  ): VisitorIdentity {
    const useCookies = forcePlatform ? forcePlatform === 'web' : hasVisitorCookies(c);
    if (useCookies) return ensureVisitorCookies(c, this.deps);
    return {
      visitorId: body.visitorId ?? crypto.randomUUID(),
      sessionId: body.sessionId ?? crypto.randomUUID(),
    };
  }

  /**
   * 이벤트/바이탈이 세션 등록보다 먼저 도착해도 FK 오류나 데이터 유실이 없도록 한다.
   * 정상 경로에서는 PK 존재 확인 1회만 수행하고, 누락된 경우에만 지오IP 등을 조회한다.
   */
  private async ensureSession(
    c: Context<AppEnv>,
    identity: VisitorIdentity,
    platform: 'web' | 'app',
  ): Promise<void> {
    if (this.repo.hasSession(identity.sessionId)) return;

    const userId = await this.resolveUserId(c);
    const ip = clientIp(c);
    const geo = await lookupGeo(this.deps.config.geoipDbPath, ip);
    this.repo.insertSession({
      id: identity.sessionId,
      visitorId: identity.visitorId,
      userId,
      platform,
      ip,
      userAgent: c.req.header('user-agent') ?? '',
      referrer: c.req.header('referer') ?? null,
      geo,
    });
    this.collectIfWatched(userId, ip);
  }

  /**
   * 방문자/세션 식별과 기기 정보 등록만 담당한다 — 페이지뷰는 항상 recordEvent로 남긴다.
   *
   * insertSession은 upsert이므로 "이미 있는 세션인지"를 여기서 미리 판단하지 않고
   * 매번 그대로 호출한다 — app은 자기 sessionId를 항상 보내므로, 그 값의 유무로
   * "새 세션 여부"를 구분할 수 없다(이미 있었던 세션도 sessionId를 함께 보낸다).
   */
  async recordSession(c: Context<AppEnv>, body: AnalyticsSessionInput): Promise<void> {
    try {
      const identity = this.resolveIdentity(c, body, body.platform);
      const userId = await this.resolveUserId(c);
      const ip = clientIp(c);
      const geo = await lookupGeo(this.deps.config.geoipDbPath, ip);
      this.repo.insertSession({
        id: identity.sessionId,
        visitorId: identity.visitorId,
        userId,
        platform: body.platform,
        ip,
        userAgent: body.deviceInfo ?? c.req.header('user-agent') ?? '',
        referrer: body.referrer ?? null,
        geo,
      });
      this.collectIfWatched(userId, ip);
    } catch (err) {
      console.error('analytics.recordSession failed:', err);
    }
  }

  /** 워치 대상 사용자의 접속이면 Insights를 백그라운드로 수집한다 (1주 IP 캐시 준수) */
  private collectIfWatched(userId: number | null, ip: string): void {
    if (userId === null || !this.repo.isInsightsWatched(userId)) return;
    void collectInsights(this.deps.config, this.repo, ip);
  }

  async recordEvent(c: Context<AppEnv>, body: AnalyticsEventInput): Promise<void> {
    try {
      // 앱은 두 상관관계 ID를 항상 body에 싣고, 웹은 서버 발급 쿠키만 사용한다.
      // 쿠키가 아직 없는 웹의 첫 병렬 요청도 웹으로 판별해야 임의 app 세션이 생기지 않는다.
      const platform = body.visitorId && body.sessionId ? 'app' : 'web';
      const identity = this.resolveIdentity(c, body, platform);
      await this.ensureSession(c, identity, platform);
      this.repo.insertEvent(identity.sessionId, body.path);
    } catch (err) {
      console.error('analytics.recordEvent failed:', err);
    }
  }

  async recordVitals(c: Context<AppEnv>, body: AnalyticsVitalsInput): Promise<void> {
    try {
      const identity = this.resolveIdentity(c, body, 'web');
      await this.ensureSession(c, identity, 'web');
      this.repo.insertVitals(identity.sessionId, body.metric, body.value, body.path);
    } catch (err) {
      console.error('analytics.recordVitals failed:', err);
    }
  }

  /**
   * lite 전용 — 클라이언트 JS 없이 서버가 문서 최초 로드 시점에만 직접 기록한다.
   * 쿠키(lc_vid/lc_sid)는 응답 헤더에 실려야 하므로 static.ts가 동기적으로 먼저
   * ensureVisitorCookies를 호출해 identity를 넘겨준다 (여기서 다시 부르지 않는다).
   */
  async recordLiteDocumentLoad(
    c: Context<AppEnv>,
    identity: VisitorIdentity,
    path: string,
  ): Promise<void> {
    try {
      const userId = await this.resolveUserId(c);
      const ip = clientIp(c);
      const geo = await lookupGeo(this.deps.config.geoipDbPath, ip);
      this.repo.insertSession({
        id: identity.sessionId,
        visitorId: identity.visitorId,
        userId,
        platform: 'lite',
        ip,
        userAgent: c.req.header('user-agent') ?? '',
        referrer: c.req.header('referer') ?? null,
        geo,
      });
      this.repo.insertEvent(identity.sessionId, path);
      this.collectIfWatched(userId, ip);
    } catch (err) {
      console.error('analytics.recordLiteDocumentLoad failed:', err);
    }
  }

  /** 대시보드 조회 — admin 모듈이 위임한다. */
  get queries(): AnalyticsRepo {
    return this.repo;
  }
}
