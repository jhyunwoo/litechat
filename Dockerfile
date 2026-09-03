# syntax=docker/dockerfile:1.7
# litechat 프로덕션 이미지 (linux/arm64 — Oracle Ampere A1 대응)
#
# 레이어 전략
#   manifests    : 매니페스트(package.json/lockfile)만 — 의존성 캐시 키
#   build-deps   : 프론트엔드 빌드에 필요한 전체 의존성 (dev 포함)
#   build        : web/lite/dashboard 빌드 (서버 소스는 필요 없다)
#   runtime-deps : **런타임 의존성만** 따로 설치 (dev/빌드 도구 제외)
#   runtime      : 서버 소스 + 빌드 산출물 + runtime-deps
#
# 핵심은 build와 runtime의 node_modules를 분리한 것이다. 이전에는 빌더의
# node_modules를 통째로 복사해 vite/tailwind/typescript/@types까지 런타임 이미지에
# 들어갔다 (488 패키지 / 340 MB). 런타임에 실제로 필요한 것은 50 패키지 / 61 MB뿐이다.
#
# BuildKit 필요 (Docker 23+ 기본). --mount=type=cache로 bun 다운로드 캐시를 재사용한다.

FROM oven/bun:1.3 AS base
WORKDIR /app

# ── 매니페스트 레이어 ────────────────────────────────────
# 소스가 바뀌어도 매니페스트가 그대로면 아래 install 레이어가 전부 캐시된다.
FROM base AS manifests
COPY package.json bun.lock turbo.json tsconfig.base.json bunfig.toml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/lite/package.json apps/lite/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/app/package.json apps/app/
COPY packages/types/package.json packages/types/
COPY packages/build-tools/package.json packages/build-tools/
COPY e2e/package.json e2e/

# ── 빌드 의존성 ─────────────────────────────────────────
# apps/app(Expo/React Native)은 서버 이미지와 무관하므로 설치하지 않는다.
# 매니페스트는 lockfile 검증에 필요해 위에서 복사했다.
FROM manifests AS build-deps
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --filter '!app'

# ── 프론트엔드 빌드 ──────────────────────────────────────
# apps/server 소스는 복사하지 않는다. web이 참조하는 것은 `import type { AppType }`
# 하나뿐이고 타입은 번들에서 지워지므로, 서버 코드만 고쳤을 때 프론트엔드 빌드
# 레이어가 통째로 무효화되는 것을 막는다.
FROM build-deps AS build
COPY packages/ packages/
COPY apps/web/ apps/web/
COPY apps/lite/ apps/lite/
COPY apps/dashboard/ apps/dashboard/
RUN bun run --filter web --filter lite --filter dashboard build

# ── 런타임 의존성 ────────────────────────────────────────
FROM manifests AS runtime-deps
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --filter server \
 # sharp는 플랫폼 판별이 불가능해 glibc/musl 두 벌의 libvips를 모두 설치한다.
 # 이 이미지는 Debian 기반(oven/bun)이라 musl 빌드는 쓰이지 않는다 → 18 MB 절약.
 # (베이스 이미지를 Alpine으로 바꾼다면 이 줄을 반드시 함께 지워야 한다)
 && rm -rf node_modules/@img/*musl* node_modules/@img/*linuxmusl*

# ── 런타임 ──────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=runtime-deps /app/package.json ./package.json
COPY packages/types/ packages/types/
COPY apps/server/ apps/server/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/lite/dist ./apps/lite/dist
COPY --from=build /app/apps/dashboard/dist ./apps/dashboard/dist

# 정적 파일/데이터 경로 (docker-compose에서 /app/data 볼륨 마운트)
# GeoLite2-City.mmdb는 라이선스 바이너리라 이미지에 넣지 않는다 — /app/data 볼륨에
# 운영자가 직접 배치한다(MaxMind 무료 계정으로 내려받아 GEOIP_DB_PATH 경로에 복사).
ENV WEB_STATIC_DIR=/app/apps/web/dist \
    LITE_STATIC_DIR=/app/apps/lite/dist \
    DASHBOARD_STATIC_DIR=/app/apps/dashboard/dist \
    DB_PATH=/app/data/litechat.db \
    UPLOAD_DIR=/app/data/uploads \
    GEOIP_DB_PATH=/app/data/GeoLite2-City.mmdb \
    PORT=3000

# 비root 실행 — oven/bun 이미지에 이미 존재하는 uid/gid 1000의 `bun` 사용자를 쓴다.
# 업로드/DB가 놓이는 /app/data는 볼륨 마운트 지점이라 소유권을 미리 넘겨 둔다.
RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

EXPOSE 3000

# SIGTERM을 bun 프로세스가 직접 받아야 우아한 종료(index.ts의 shutdown)가 동작한다.
# exec 형식 CMD는 셸을 거치지 않으므로 PID 1이 곧 bun이다.
CMD ["bun", "run", "apps/server/src/index.ts"]
