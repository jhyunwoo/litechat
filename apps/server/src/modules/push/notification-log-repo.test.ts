/**
 * NotificationLogRepo 단위 테스트 — 필터/정렬/집계 로직
 */
import { describe, expect, test } from 'bun:test';
import { openTestDatabase } from '../../db/database';
import { NotificationLogRepo } from './notification-log-repo';

function seedUsers(db: ReturnType<typeof openTestDatabase>) {
  db.exec(
    `INSERT INTO users (username, password_hash, nickname, created_at)
     VALUES ('alice', 'h', 'Alice', 0), ('bob', 'h', 'Bob', 0)`,
  );
}

describe('insert + markFailed', () => {
  test('삽입 직후 sentStatus는 ok, receivedStatus는 pending', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'hi' });
    const { rows } = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 });
    expect(rows[0]).toMatchObject({ id, sentStatus: 'ok', receivedAt: null, receivedStatus: 'pending' });
  });

  test('markFailed 후 sentStatus/sentError가 반영되고 receivedStatus는 n-a', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'hi' });
    repo.markFailed(id, 'expired', 'gone (410)');
    const { rows } = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 });
    expect(rows[0]).toMatchObject({ sentStatus: 'expired', sentError: 'gone (410)', receivedStatus: 'n-a' });
  });
});

describe('markReceived', () => {
  test('본인 로그만, 최초 1회만 받은 시각을 기록한다', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'hi' });

    repo.markReceived(id, 2, null); // 남의 로그 — 무시됨
    expect(repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!.receivedAt).toBeNull();

    repo.markReceived(id, 1, 'UA-1');
    const first = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!;
    expect(first.receivedAt).not.toBeNull();
    expect(first.receivedStatus).toBe('received');

    const firstReceivedAt = first.receivedAt;
    repo.markReceived(id, 1, 'UA-2'); // 중복 ACK — 최초 시각 유지
    expect(repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!.receivedAt).toBe(
      firstReceivedAt,
    );
  });
});

describe('list — 필터/정렬', () => {
  test('userId/channel/sentStatus/기간 필터', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const now = Math.floor(Date.now() / 1000);
    repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'a' });
    repo.insert({ userId: 1, channel: 'expo', conversationId: null, bodyPreview: 'b' });
    const id3 = repo.insert({ userId: 2, channel: 'web', conversationId: null, bodyPreview: 'c' });
    repo.markFailed(id3, 'error', 'boom');

    expect(repo.list({ userId: 1, sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total).toBe(2);
    expect(repo.list({ channel: 'expo', sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total).toBe(1);
    expect(repo.list({ sentStatus: 'error', sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total).toBe(1);
    expect(repo.list({ from: now + 100, sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total).toBe(0);
  });

  test('receivedStatus 계산: n-a/received/pending/presumed_lost', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);

    const failedId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });
    repo.markFailed(failedId, 'error', 'boom');

    const receivedId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });
    repo.markReceived(receivedId, 1, null);

    const pendingId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });

    const oldId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });
    db.query('UPDATE notification_log SET sent_at = ? WHERE id = ?').run(
      Math.floor(Date.now() / 1000) - 25 * 3600,
      oldId,
    );

    const byId = new Map(
      repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows.map((r) => [r.id, r]),
    );
    expect(byId.get(failedId)!.receivedStatus).toBe('n-a');
    expect(byId.get(receivedId)!.receivedStatus).toBe('received');
    expect(byId.get(pendingId)!.receivedStatus).toBe('pending');
    expect(byId.get(oldId)!.receivedStatus).toBe('presumed_lost');
  });

  test('receivedStatus로 필터링', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const receivedId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });
    repo.markReceived(receivedId, 1, null);
    repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'y' }); // pending

    expect(
      repo.list({ receivedStatus: 'received', sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total,
    ).toBe(1);
    expect(
      repo.list({ receivedStatus: 'pending', sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total,
    ).toBe(1);
  });

  test('페이지네이션', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    for (let i = 0; i < 5; i += 1) {
      repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: `${i}` });
    }
    const page1 = repo.list({ sort: 'sent_at', dir: 'asc', limit: 2, offset: 0 });
    const page2 = repo.list({ sort: 'sent_at', dir: 'asc', limit: 2, offset: 2 });
    expect(page1.rows.map((r) => r.bodyPreview)).toEqual(['0', '1']);
    expect(page2.rows.map((r) => r.bodyPreview)).toEqual(['2', '3']);
    expect(page1.total).toBe(5);
  });
});

describe('summary', () => {
  test('상태별 건수, 수신확인율, 평균 지연', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);

    const okReceived = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'a' });
    repo.markReceived(okReceived, 1, null);
    repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'b' }); // ok, 미수신
    const failed = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'c' });
    repo.markFailed(failed, 'error', 'boom');

    const summary = repo.summary(30);
    expect(summary.totalSent).toBe(3);
    expect(summary.byStatus).toEqual(
      expect.arrayContaining([
        { status: 'ok', count: 2 },
        { status: 'error', count: 1 },
      ]),
    );
    expect(summary.receivedCount).toBe(1);
    expect(summary.receivedRate).toBeCloseTo(0.5); // ok 2건 중 1건 수신
  });
});

describe('Expo 영수증 상관관계', () => {
  test('markTicketPending → listPendingExpoReceipts → updateReceiptStatus', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'expo', conversationId: null, bodyPreview: 'x' });
    repo.markTicketPending(id, 'ticket-1', 'ExponentPushToken[a]');

    // 아직 15분이 지나지 않아 대상이 아니다.
    expect(repo.listPendingExpoReceipts(15 * 60 * 1000)).toEqual([]);

    // 강제로 오래된 것처럼 만든다.
    db.query('UPDATE notification_log SET sent_at = ? WHERE id = ?').run(
      Math.floor(Date.now() / 1000) - 20 * 60,
      id,
    );
    const due = repo.listPendingExpoReceipts(15 * 60 * 1000);
    expect(due).toEqual([{ id, expoTicketId: 'ticket-1', expoToken: 'ExponentPushToken[a]' }]);

    repo.updateReceiptStatus(id, 'ok');
    const row = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!;
    expect(row.receiptStatus).toBe('ok');
    expect(row.receiptCheckedAt).not.toBeNull();
  });

  test('markReceiptDeviceGone은 sentStatus도 expired로 되돌린다', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'expo', conversationId: null, bodyPreview: 'x' });
    repo.markTicketPending(id, 'ticket-1', 'ExponentPushToken[a]');
    repo.markReceiptDeviceGone(id);
    const row = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!;
    expect(row.sentStatus).toBe('expired');
    expect(row.receiptStatus).toBe('error');
    expect(row.receivedStatus).toBe('n-a');
  });
});
