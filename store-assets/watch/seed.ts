/** Seed fictional accounts on an explicitly supplied disposable local server. */
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const base = new URL(process.env.WATCH_SEED_API_URL ?? 'http://localhost:3000');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Seed only a disposable localhost API; expose it to Watch through trusted local HTTPS.');
}
const language = process.env.WATCH_CAPTURE_LANGUAGE ?? 'ko';
if (!['ko', 'en'].includes(language)) throw new Error('WATCH_CAPTURE_LANGUAGE must be ko or en');
const password = 'watch-demo-only-2026';
const names = language === 'ko' ? ['하늘', '민서', '지우'] : ['Sky', 'Alex', 'Jamie'];
const lines = language === 'ko'
  ? ['공원 입구에서 만날까요?', '좋아요! 곧 도착해요.', '산책길 사진이에요.']
  : ['Meet at the park entrance?', 'Sounds good! Nearly there.', 'A photo from our walk.'];
async function request(route: string, token?: string, body?: object | FormData) {
  const response = await fetch(new URL(route, base), {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}. Use a fresh disposable database for each run.`);
  return response.json();
}
const accounts = [];
for (const [index, nickname] of names.entries()) {
  accounts.push(await request('/api/auth/register', undefined, {
    username: `watch_${language}_${index}`, nickname, password,
  }));
}
const [owner, peer, photoPeer] = accounts;
async function connect(other: typeof owner) {
  await request('/api/friends/requests', owner.token, { userId: other.user.id });
  const requests = await request('/api/friends/requests', other.token);
  const incoming = requests.incoming.find((item: any) => item.user.id === owner.user.id);
  if (!incoming) throw new Error('Seed friend request missing');
  const result = await request(`/api/friends/requests/${incoming.id}/respond`, other.token, { accept: true });
  return result.conversationId;
}
const chat = await connect(peer);
const photoChat = await connect(photoPeer);
const send = (id: number, token: string, k: string, x: string) => request(`/api/chat/${id}/messages`, token, { k, x });
await send(chat, peer.token, 't', lines[0]);
const sent = await send(chat, owner.token, 't', lines[1]);
await request(`/api/chat/${chat}/read`, peer.token, { m: sent.message.id });
await send(photoChat, photoPeer.token, 't', lines[2]);
const png = await sharp(await readFile(new URL('../source/demo-photo.svg', import.meta.url))).png().toBuffer();
const upload = new FormData();
upload.set('file', new File([png], 'fictional-walk.png', { type: 'image/png' }));
const { image } = await request('/api/images', photoPeer.token, upload);
await send(photoChat, photoPeer.token, 'i', image.id);
console.log(`Seeded ${language} fictional Watch scenario. Sign in on Watch: ${owner.user.username} / ${password}`);
console.log(`Text conversation: ${names[1]}; received photo conversation: ${names[2]}. Tokens are not printed.`);
