# LiteChat

최소한의 인터넷 통신으로 실시간 채팅을 제공하는 서비스.
느린 인터넷·데이터 제한 환경에서도 원활히 동작하는 것이 목표다. (상세 요구사항: [PROJECT.md](./PROJECT.md))

## 구성

이 저장소는 Bun 워크스페이스(Turborepo) 모노레포다.

| 경로 | 설명 |
| --- | --- |
| `apps/server` | Hono + Bun 백엔드. REST API + WebSocket + 두 프론트엔드 정적 서빙 |
| `apps/web` | **Full Chat** (chat.moveto.kr) — React 19 + Vite PWA, 푸시 알림, iMessage풍 UI |
| `apps/lite` | **Lite Chat** (litechat.moveto.kr) — 프레임워크 없는 초경량 SPA, 초기 전송 ~6KB |
| `packages/types` | 서버/클라이언트 공유 타입·zod 스키마·WS 프로토콜 정의 (`@litechat/types`) |
| `e2e` | Playwright 종단 테스트 (두 사이트 전체 여정) |

### 아키텍처 요점

- **하나의 컨테이너**가 두 도메인을 서빙한다 — 서버가 `Host` 헤더로 web/lite 번들을 선택.
- **SQLite(WAL)** 가 영속 데이터, **Redis** 가 세션 저장을 담당. (`REDIS_URL=memory`로 Redis 없이 개발 가능)
- **실시간**: 순수 WebSocket + 한 글자 키 JSON 프로토콜(`packages/types/src/protocol.ts`).
  읽음 확인은 워터마크(사용자·대화별 한 행) 방식이라 전송량과 쓰기량이 최소다.
- **이미지**: 원본 보존 + sharp로 저화질 webp(640px/q40) 생성. 채팅방은 webp 기본,
  클릭 시 원본/저화질 다운로드. Lite는 탭해야 로드한다.
- **타입 안전성 (Hono Stack)**: 서버의 `AppType`을 `hc<AppType>`로 소비. API 문서는
  `/docs` (OpenAPI 명세는 `/openapi.json`) 에서 자동 생성된다.
- **Lite 크기 예산**: 빌드가 초기 전송량(brotli)을 측정해 10KB를 넘으면 실패한다.
  Lite는 사용한 데이터를 화면에 실시간 표시한다 (Resource Timing + WS 프레임 계측).
- **헬스체크**: `GET /api/health` — 컨테이너/오케스트레이터의 상태 확인용.

### 기술 스택

- **런타임/패키지 매니저**: Bun 1.3, 워크스페이스 + Turborepo
- **서버**: Hono, hono-openapi, zod, ioredis, sharp, web-push
- **Full Chat**: React 19, Vite 6, React Router 7, TanStack Query, Tailwind CSS 4, vite-plugin-pwa
- **Lite**: 순수 TypeScript + esbuild 기반 커스텀 빌드 스크립트(`apps/lite/build.ts`), 프레임워크 없음
- **DB/세션**: SQLite(WAL) + Redis (또는 `REDIS_URL=memory`로 인메모리 대체)
- **테스트**: `bun test`(서버 단위/통합), Playwright(e2e)

## 개발

```sh
bun install

# 백엔드 (Redis 없이)
cd apps/server && REDIS_URL=memory bun run dev   # http://localhost:3000

# Full Chat 개발 서버 (API는 :3000으로 프록시)
cd apps/web && bun run dev                        # http://localhost:5173

# Lite 빌드 (dist/ 생성 → 서버가 서빙, 크기 예산 검사 포함)
cd apps/lite && bun run build
```

그 외 루트에서 바로 실행 가능한 스크립트:

```sh
bun run dev          # turbo run dev — 모든 워크스페이스 dev 태스크 동시 실행
bun run build        # turbo run build
bun run check-types  # turbo run check-types
bun run lint         # turbo run lint
bun run format       # prettier --write
```

## 테스트

```sh
cd apps/server && bun test        # 단위/통합 테스트 (TDD)
cd e2e && bunx playwright test    # 종단 테스트 (web/lite 두 프로젝트, 서버 자동 기동)
```

## 배포 (Dokploy)

프로덕션은 [Dokploy](https://dokploy.com) 위에서 `docker-compose.yml` 하나로 앱(`app`)과 `redis`
두 서비스를 함께 띄운다. 이미지는 `linux/arm64`(Oracle Ampere A1) 기준으로 빌드된다.

### 1. VAPID 키 생성 (최초 1회)

Full Chat의 웹 푸시 알림에 사용한다. 비워두면 푸시 기능만 비활성화되고 나머지는 정상 동작한다.

```sh
bunx web-push generate-vapid-keys
```

### 2. Dokploy에 애플리케이션 생성

1. Dokploy 대시보드 → **Projects** → 프로젝트 선택(또는 새로 생성) → **Create Service** → **Compose**.
2. **Source**: 이 저장소를 Git provider(GitHub 등)로 연결하고 배포 브랜치를 `main`으로 지정.
   (또는 Dokploy 서버에 직접 push하는 Git remote 방식도 가능)
3. **Compose Path**: `docker-compose.yml` (루트 경로 그대로 사용, Dokploy가 자동 인식).
4. **Build**: Dockerfile 빌드 방식 그대로 사용 — 별도 빌드팩 설정 불필요.

### 3. 환경 변수 설정

Dokploy 서비스의 **Environment** 탭에 아래 값을 등록한다 (`docker-compose.yml`이 참조하는 값들).

```env
VAPID_PUBLIC_KEY=<generate-vapid-keys 출력값>
VAPID_PRIVATE_KEY=<generate-vapid-keys 출력값>
```

`COOKIE_DOMAIN`, `WEB_HOST`, `LITE_HOST` 등 나머지는 `docker-compose.yml`에 기본값이 박혀 있으므로,
도메인을 바꾸지 않는 한 추가 설정이 필요 없다. 다른 도메인을 쓴다면 compose 파일의 값을 직접 수정한다.

### 4. 도메인 연결

Dokploy의 **Domains** 탭에서 `app` 서비스(포트 `3000`)에 두 도메인을 모두 연결한다.

| 도메인 | 용도 |
| --- | --- |
| `chat.moveto.kr` | Full Chat |
| `litechat.moveto.kr` | Lite Chat |

Dokploy가 내장 Traefik으로 두 도메인 모두 `app:3000`으로 라우팅하고, Let's Encrypt 인증서를 자동 발급한다.
서버가 `Host` 헤더를 보고 어떤 프론트엔드를 서빙할지 스스로 분기하므로 별도의 경로 라우팅 설정은 필요 없다.

### 5. 볼륨 확인

`docker-compose.yml`의 `litechat-data` 볼륨이 SQLite DB와 업로드 이미지를 담는다. Dokploy가 compose를
그대로 적용하므로 별도 설정 없이 자동으로 영속 볼륨이 생성된다 — 재배포해도 데이터가 유지된다.

### 6. 배포 및 확인

**Deploy** 버튼을 누르면 Dokploy가 `docker compose up -d --build`를 실행한다. 배포 후 상태 확인:

```sh
curl https://chat.moveto.kr/api/health   # { "ok": true }
```

`redis` 서비스에 `healthcheck`가 걸려 있어 Redis가 준비된 뒤에 `app`이 기동된다. 이후 배포는 Git에
push하거나 Dokploy에서 재배포를 트리거하면 무중단으로 롤아웃된다.

### 로컬에서 프로덕션 이미지 검증

Dokploy에 올리기 전 로컬에서 동일 구성을 확인하려면:

```sh
bunx web-push generate-vapid-keys   # 최초 1회
VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... docker compose up -d --build
curl http://localhost:3000/api/health
```

### 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 포트 |
| `DB_PATH` | `data/litechat.db` | SQLite 파일 경로 |
| `UPLOAD_DIR` | `data/uploads` | 이미지 저장 디렉터리 |
| `REDIS_URL` | `redis://localhost:6379` | `memory`면 인메모리 세션(개발용, 단일 프로세스 한정) |
| `COOKIE_DOMAIN` | (없음) | 세션 쿠키 Domain. 배포 시 `.moveto.kr` |
| `SESSION_TTL_SECONDS` | `2592000` (30일) | 세션 만료 시간(슬라이딩) |
| `WEB_HOST` / `LITE_HOST` | `chat.moveto.kr` / `litechat.moveto.kr` | Host 라우팅 기준 |
| `WEB_STATIC_DIR` / `LITE_STATIC_DIR` | `../web/dist` / `../lite/dist` | 정적 번들 경로 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | (없음) | 비우면 푸시 기능 비활성화 |
| `VAPID_SUBJECT` | `mailto:admin@moveto.kr` | VAPID 연락처 |
| `PASSWORD_MEMORY_COST` / `PASSWORD_TIME_COST` | `65536` / `2` | argon2id 비밀번호 해시 비용 파라미터 |
| `NODE_ENV` | (없음) | `production`이면 세션 쿠키에 `Secure` 속성 부여 |
