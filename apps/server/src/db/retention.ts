import type { Database } from 'bun:sqlite';

const DAY = 24 * 60 * 60;
const RETENTION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 문서화된 운영 보관기간을 코드로 강제한다. 계정 콘텐츠는 명시적 삭제까지 유지한다. */
export function applyRetention(db: Database, now = Math.floor(Date.now() / 1000)): void {
  const telemetryCutoff = now - 90 * DAY;
  db.transaction(() => {
    db.query('DELETE FROM analytics_events WHERE created_at < ?').run(telemetryCutoff);
    db.query('DELETE FROM analytics_vitals WHERE created_at < ?').run(telemetryCutoff);
    db.query('DELETE FROM analytics_sessions WHERE last_seen_at < ?').run(telemetryCutoff);
    db.query('DELETE FROM notification_log WHERE sent_at < ?').run(telemetryCutoff);
    db.query('DELETE FROM geoip_insights WHERE fetched_at < ?').run(now - 30 * DAY);
    db.query("DELETE FROM content_reports WHERE status <> 'open' AND resolved_at < ?").run(
      now - 365 * DAY,
    );
  })();
}

/**
 * 장시간 재시작되지 않는 운영 프로세스에서도 보관기간을 계속 강제한다.
 * 부팅 직후 정리는 createApp이 수행하므로 여기서는 다음 주기부터 실행한다.
 */
export function startRetentionSchedule(
  db: Database,
  intervalMs = RETENTION_CHECK_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    try {
      applyRetention(db);
    } catch {
      // 쿼리나 레코드 내용을 로그에 포함하지 않아 운영 로그로 PII가 새지 않게 한다.
      console.error('Retention cleanup failed');
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
