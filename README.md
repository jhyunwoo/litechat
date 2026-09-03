# litechat

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
  답장은 메시지에 `r`(인용 대상 ID) 한 필드만 싣고, 인용문을 그리는 데 필요한데 이번
  페이지에 없는 원본만 `/messages` 응답의 `refs`에 한 번씩 담아 보낸다 — 인용 본문을
  메시지마다 중복 전송하지 않는다.
- **이미지**: 원본 보존 + sharp로 저화질 webp(640px/q40) 생성. 채팅방은 webp 기본,
  클릭 시 원본/저화질 다운로드. Lite는 탭해야 로드한다.
- **타입 안전성 (Hono Stack)**: 서버의 `AppType`을 `hc<AppType>`로 소비. API 문서는
  `/docs` (OpenAPI 명세는 `/openapi.json`) 에서 자동 생성된다.
- **크기 예산**: 세 프론트엔드 모두 빌드가 초기 전송량(brotli)을 측정해 예산을 넘으면 실패한다
  (Lite 10 KB / Full Chat 128 KB / 대시보드 78 KB). Lite는 사용한 데이터를 화면에 실시간
  표시한다 (Resource Timing + WS 프레임 계측).
- **사전 압축**: 세 프론트엔드의 산출물은 빌드 시점에 brotli(품질 11)/gzip으로 압축돼
  `.br`/`.gz`로 함께 배포되고, 서버가 `Accept-Encoding`에 맞춰 그대로 전송한다. 요청마다의
  압축 CPU가 0이라 2 OCPU 호스트에 유리하다 → [성능](#성능) 참고.
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

## 성능

성능에 영향이 큰 설계 결정과, 그것을 다시 측정하는 방법.

### 정적 자산 전송

빌드가 `dist/**`의 텍스트 자산을 brotli(품질 11)와 gzip으로 미리 압축해
`<file>.br` / `<file>.gz`로 함께 내보낸다(`packages/build-tools`). 서버(`apps/server/src/static.ts`)는
요청의 `Accept-Encoding`을 보고 압축본이 있으면 그대로 흘려보낸다.

- 압축본을 **먼저** stat 한다. `.br`은 실제 파일 옆에만 생성되므로 그 존재가 원본의 존재를 증명한다
  → 자산 요청 하나에 파일시스템 조회 1회.
- 해시가 붙은 `/assets/*`는 `immutable` 1년 캐시. 그 외(HTML)는 `no-cache` + 약한 `ETag`로
  재검증한다(변경 없으면 304).
- `Vary: Accept-Encoding`은 압축 여부와 무관하게 항상 붙인다.

Traefik 압축 미들웨어(`docker-compose.yml`)는 **API JSON 응답**만 담당한다. 정적 자산은 이미
`Content-Encoding`이 붙어 있어 건드리지 않고, webp/png/jpeg는 `excludedContentTypes`로 제외한다.

### 크기 예산 (회귀 방지)

각 앱의 빌드가 "초기 전송량(brotli)"—HTML + 진입 청크 + 정적으로 import되는 청크 + CSS—을 재고
예산을 넘으면 **빌드를 실패시킨다**. 지연 로드 청크는 포함하지 않는다.

| 앱 | 예산 | 설정 위치 |
|---|---|---|
| Lite | 10 KB | `apps/lite/build.ts` |
| Full Chat | 128 KB | `apps/web/vite.config.ts` |
| 대시보드 | 78 KB | `apps/dashboard/vite.config.ts` |

예산을 올릴 때는 무엇이 늘었고 왜 받아들이는지 커밋 메시지에 남길 것.

### SQLite

`apps/server/src/db/database.ts`가 열 때마다 적용하는 PRAGMA와 그 근거는 파일 주석에 상세히 적어 두었다.
요약하면 WAL + `synchronous=NORMAL` + 16 MiB 페이지 캐시 + 256 MB mmap이다.

`synchronous=NORMAL`은 **의도적인 내구성 절충**이다: 프로세스 크래시/재배포에서는 아무것도 잃지 않고,
호스트 전원 손실에서만 마지막 체크포인트 이후 트랜잭션을 잃을 수 있다. 그 창을 시간으로 묶기 위해
60초마다 PASSIVE 체크포인트를 돈다. 이 절충을 되돌리려면 `applyPragmas`에서 해당 줄만 지우면 된다
(메시지 저장 지연이 0.024 ms → 1.8 ms로 돌아간다).

인덱스는 실측한 쿼리 플랜을 근거로만 추가한다. 새 쿼리를 넣을 때는 `EXPLAIN QUERY PLAN`으로
전체 스캔이 없는지 확인할 것 — 특히 메시지 수에 비례해 커지는 경로를 조심한다.

### WebSocket

- 같은 프레임을 여러 수신자에게 보낼 때 직렬화는 한 번만 한다(`WsHub.sendPayload`).
- 소켓당 미전송 버퍼가 1 MiB를 넘으면 연결을 끊는다. 느린 클라이언트가 서버 메모리를 잠식하지 못하게
  하기 위함이고, 클라이언트는 재연결 후 `?after=`로 밀린 메시지를 따라잡는다.
- 클라이언트 재연결 백오프에는 **지터**가 있다(계산값의 50~100%). 재배포로 모든 클라이언트가 동시에
  끊겨도 새 컨테이너에 한꺼번에 몰리지 않는다.
- 재연결 catch-up은 열린 대화방의 `?after=<마지막 id>` 증분만 받는다 — 전체 페이지를 다시 받지 않는다.

### 우아한 종료

SIGTERM을 받으면 새 연결을 막고 진행 중인 요청을 끝낸 뒤, WebSocket을 명시적으로 닫고
WAL을 TRUNCATE 체크포인트한 다음 종료한다(최대 10초). compose의 `stop_grace_period: 20s`가 이를 받쳐 준다.

### Docker 이미지

빌드용 의존성과 런타임 의존성을 다른 스테이지에서 설치한다. 런타임 이미지에는 서버 실행에 필요한
50개 패키지만 들어간다(vite/tailwind/typescript 등 빌드 전용 도구 제외). 프론트엔드 빌드 스테이지는
`apps/server` 소스를 복사하지 않으므로, 서버만 고쳤을 때 프론트엔드 빌드 레이어가 캐시된 채로 남는다.

`init-data-perms`는 완료 표식(`/app/data/.perms-ok`)을 남기고 이후 배포에서는 건너뛴다. 표식이 없으면
전체 `chown -R`이 한 번 돈다. 강제로 다시 돌리려면:

```sh
docker run --rm -v litechat-data:/d busybox rm -f /d/.perms-ok
```

### 성능 측정 방법

```sh
# 1) 일회용 벤치 DB 생성 (운영 데이터와 절대 섞지 말 것 — DB_PATH를 임시 경로로)
DB_PATH=/tmp/bench.db bun apps/server/scripts/seed-bench.ts

# 2) 시드 DB로 프로덕션 모드 서버 기동 (:3100)
cp /tmp/bench.db /tmp/run.db
SCR=/tmp sh apps/server/scripts/bench-server.sh

# 3) 쿼리 플랜 확인 — 뜨거운 경로에 SCAN이 없어야 한다
#    (bun repl 또는 스크립트에서 EXPLAIN QUERY PLAN 실행)

# 4) 번들 크기: 빌드 출력이 초기 전송량과 예산을 항상 함께 보고한다
bun run build
```

e2e는 `PLAYWRIGHT_CHROMIUM_PATH`로 브라우저 경로를 지정할 수 있다(설치된 리비전이 다를 때).


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

`COOKIE_DOMAIN`, `WEB_HOST`, `LITE_HOST`, `LITE_HOST_ALIASES` 등 나머지는 `docker-compose.yml`에 기본값이 박혀 있으므로,
도메인을 바꾸지 않는 한 추가 설정이 필요 없다. 다른 도메인을 쓴다면 compose 파일의 값을 직접 수정한다.

### 4. 도메인 연결

Dokploy의 **Domains** 탭에서 `app` 서비스(포트 `3000`)에 기본 도메인을 연결한다.

| 도메인 | 용도 |
| --- | --- |
| `chat.moveto.kr` | Full Chat |
| `litechat.moveto.kr` | Lite Chat |
| `lc.moveto.kr` | Lite Chat 별칭 (`docker-compose.yml`의 Traefik 라벨로 연결) |
| `dash.moveto.kr` | 관리자 Dashboard |

`lc.moveto.kr`은 Cloudflare DNS에 `CNAME lc → litechat.moveto.kr`(DNS only) 레코드를 추가한다. Compose 서비스를
전체 재배포하면 Dokploy의 내장 Traefik이 라벨을 읽어 이 별칭을 `app:3000`으로 라우팅하고 Let's Encrypt 인증서를 발급한다.
Docker Compose 도메인 라벨 변경은 컨테이너 재시작만으로 반영되지 않으므로 반드시 전체 재배포해야 한다.

Dokploy가 모든 도메인을 `app:3000`으로 라우팅하면,
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
| `LITE_HOST_ALIASES` | `lc.moveto.kr` | 쉼표로 구분한 Lite Chat 추가 호스트명 |
| `WEB_STATIC_DIR` / `LITE_STATIC_DIR` | `../web/dist` / `../lite/dist` | 정적 번들 경로 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | (없음) | 비우면 푸시 기능 비활성화 |
| `VAPID_SUBJECT` | `mailto:admin@moveto.kr` | VAPID 연락처 |
| `PASSWORD_MEMORY_COST` / `PASSWORD_TIME_COST` | `65536` / `2` | argon2id 비밀번호 해시 비용 파라미터 |
| `NODE_ENV` | (없음) | `production`이면 세션 쿠키에 `Secure` 속성 부여 |
