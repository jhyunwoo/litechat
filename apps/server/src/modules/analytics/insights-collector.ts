/**
 * Insights 자동 수집 — 워치 대상 사용자의 접속 IP를 백그라운드로 조회해 저장한다.
 *
 * 비용 통제가 핵심 (Insights는 쿼리당 과금):
 *  - 1주 안에 조회된 IP는 다시 부르지 않는다 (geoip_insights.fetched_at 기준)
 *  - 같은 IP에 대한 동시 요청은 in-flight 프로미스를 공유해 한 번만 부른다
 *  - MaxMind 자격 증명이 없으면 조용히 아무것도 하지 않는다
 */
import type { AppConfig } from '../../config';
import { fetchInsights, INSIGHTS_TTL_SECONDS, normalizeIp } from './insights';
import type { AnalyticsRepo } from './repo';

const inFlight = new Map<string, Promise<void>>();

/**
 * IP의 Insights가 캐시에 없거나 오래됐으면 조회해 저장한다.
 * 실패는 로그만 남긴다 — 수집은 사용자 요청을 절대 막지 않는 best-effort 작업이다.
 */
export function collectInsights(config: AppConfig, repo: AnalyticsRepo, rawIp: string): Promise<void> {
  if (!config.maxmindAccountId || !config.maxmindLicenseKey) return Promise.resolve();
  const ip = normalizeIp(rawIp);
  if (!ip) return Promise.resolve();

  const cached = repo.getInsights(ip);
  if (cached && cached.fetchedAt >= Math.floor(Date.now() / 1000) - INSIGHTS_TTL_SECONDS) {
    return Promise.resolve();
  }

  const running = inFlight.get(ip);
  if (running) return running;

  const task = fetchInsights(config, ip)
    .then((result) => {
      if (result.ok) repo.upsertInsights(result.row);
      else console.error(`Insights 자동 수집 실패 (${ip}): ${result.error}`);
    })
    .finally(() => inFlight.delete(ip));
  inFlight.set(ip, task);
  return task;
}

/**
 * 워치 등록 직후 백필 — 사용자의 최근 고유 IP 몇 개를 즉시 수집해
 * 대시보드에서 바로 볼 수 있게 한다. 개수를 제한해 비용을 묶는다.
 */
export async function backfillUserInsights(
  config: AppConfig,
  repo: AnalyticsRepo,
  userId: number,
  limit = 10,
): Promise<void> {
  for (const ip of repo.recentUserIps(userId, limit)) {
    await collectInsights(config, repo, ip);
  }
}
