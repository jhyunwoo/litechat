/**
 * 이미지 모듈 테스트 (TDD — 구현보다 먼저 작성됨)
 *
 * 업로드 → webp 변환 → 서빙(ACL 포함) → 이미지 메시지 전송 흐름을 검증한다.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { createApp, type AppType } from '../../app';
import { createTestDeps, type AppDeps } from '../../deps';
import { jsonRequest, signup } from '../../test/helpers';

let deps: AppDeps;
let app: AppType;
let alice: Awaited<ReturnType<typeof signup>>;
let bob: Awaited<ReturnType<typeof signup>>;

/** 테스트용 실제 PNG 이미지 생성 (800x600 파란 사각형) */
async function makePng(width = 800, height = 600): Promise<Blob> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 80, b: 200 } },
  })
    .png()
    .toBuffer();
  return new Blob([new Uint8Array(buffer)], { type: 'image/png' });
}

/** 멀티파트 업로드 요청 */
async function upload(cookie: string, blob: Blob, filename = 'photo.png') {
  const form = new FormData();
  form.append('file', blob, filename);
  return app.request('/api/images', { method: 'POST', headers: { cookie }, body: form });
}

beforeEach(async () => {
  deps = createTestDeps();
  app = createApp(deps);
  alice = await signup(app, 'alice', 'Alice');
  bob = await signup(app, 'bob', 'Bob');
});

describe('POST /api/images', () => {
  test('원본을 저장하고 저화질 webp로 변환해 메타데이터를 반환한다', async () => {
    const res = await upload(alice.cookie, await makePng(800, 600));
    expect(res.status).toBe(201);
    const { image } = (await res.json()) as {
      image: { id: string; w: number; h: number; tb: number; ob: number };
    };
    // 640px 상한으로 축소된다 (비율 유지).
    expect(image.w).toBe(640);
    expect(image.h).toBe(480);
    // webp 저화질본은 원본보다 작아야 한다.
    expect(image.tb).toBeGreaterThan(0);
    expect(image.ob).toBeGreaterThan(image.tb);
  });

  test('작은 이미지는 확대하지 않는다', async () => {
    const res = await upload(alice.cookie, await makePng(300, 200));
    const { image } = (await res.json()) as { image: { w: number; h: number } };
    expect(image.w).toBe(300);
    expect(image.h).toBe(200);
  });

  test('이미지가 아닌 파일은 400', async () => {
    const blob = new Blob(['plain text'], { type: 'text/plain' });
    const res = await upload(alice.cookie, blob, 'note.txt');
    expect(res.status).toBe(400);
  });

  test('로그인 없이는 401', async () => {
    const form = new FormData();
    form.append('file', await makePng(10, 10), 'x.png');
    const res = await app.request('/api/images', { method: 'POST', body: form });
    expect(res.status).toBe(401);
  });
});

describe('GET /img/:id/{thumb,orig}', () => {
  /** alice가 업로드한 이미지 ID */
  async function uploadedId(): Promise<string> {
    const res = await upload(alice.cookie, await makePng(100, 100));
    return ((await res.json()) as { image: { id: string } }).image.id;
  }

  test('업로더는 thumb(webp)와 orig(png)를 받을 수 있다', async () => {
    const id = await uploadedId();
    const thumb = await app.request(`/img/${id}/thumb`, { headers: { cookie: alice.cookie } });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    // 불변 컨텐츠 — 재방문 시 전송량 0을 위한 캐시 헤더
    expect(thumb.headers.get('cache-control')).toContain('immutable');

    const orig = await app.request(`/img/${id}/orig`, { headers: { cookie: alice.cookie } });
    expect(orig.status).toBe(200);
    expect(orig.headers.get('content-type')).toBe('image/png');
  });

  test('대화 상대는 이미지 메시지 전송 후 접근할 수 있고, 무관한 사용자는 403', async () => {
    const id = await uploadedId();

    // 아직 어떤 대화에도 등장하지 않음 → bob은 접근 불가
    const before = await app.request(`/img/${id}/thumb`, { headers: { cookie: bob.cookie } });
    expect(before.status).toBe(403);

    // alice ↔ bob 친구 + 이미지 메시지 전송
    const req = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: bob.user.id },
    });
    const { id: requestId } = (await req.json()) as { id: number };
    const acc = await jsonRequest(app, `/api/friends/requests/${requestId}/respond`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { accept: true },
    });
    const { conversationId } = (await acc.json()) as { conversationId: number };

    const sent = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: alice.cookie,
      body: { k: 'i', x: id },
    });
    expect(sent.status).toBe(201);
    const { message } = (await sent.json()) as {
      message: { k: string; im?: { id: string; w: number } };
    };
    // 이미지 메시지에는 메타데이터가 포함되어야 한다 (클라이언트 렌더링용).
    expect(message.im?.id).toBe(id);

    // 이제 bob은 접근 가능
    const after = await app.request(`/img/${id}/thumb`, { headers: { cookie: bob.cookie } });
    expect(after.status).toBe(200);

    // 제3자 eve는 여전히 403
    const eve = await signup(app, 'eve', 'Eve');
    const forbidden = await app.request(`/img/${id}/thumb`, { headers: { cookie: eve.cookie } });
    expect(forbidden.status).toBe(403);
  });

  test('존재하지 않는 이미지는 404', async () => {
    const res = await app.request('/img/nope/thumb', { headers: { cookie: alice.cookie } });
    expect(res.status).toBe(404);
  });

  test('타인이 업로드한 이미지 ID로는 메시지를 보낼 수 없다', async () => {
    const id = await uploadedId();
    // bob이 alice의 이미지 ID로 전송 시도 (대화방도 없지만 이미지 검증이 먼저다)
    const req = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: bob.user.id },
    });
    const { id: requestId } = (await req.json()) as { id: number };
    const acc = await jsonRequest(app, `/api/friends/requests/${requestId}/respond`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { accept: true },
    });
    const { conversationId } = (await acc.json()) as { conversationId: number };

    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { k: 'i', x: id },
    });
    expect(res.status).toBe(400);
  });
});
