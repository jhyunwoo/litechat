# LiteChat 프로덕션 이미지 (linux/arm64 — Oracle Ampere A1 대응)
#
# 1단계: 의존성 설치 + 두 프론트엔드 빌드
# 2단계: 서버 소스 + 빌드 산출물만 담은 런타임 이미지

FROM oven/bun:1.3 AS build
WORKDIR /app

# 의존성 레이어 캐시를 위해 매니페스트 먼저 복사
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/lite/package.json apps/lite/
COPY packages/types/package.json packages/types/
COPY e2e/package.json e2e/
RUN bun install --frozen-lockfile

# 소스 복사 후 프론트엔드 빌드
COPY . .
RUN cd apps/web && bun run build
RUN cd apps/lite && bun run build

# ── 런타임 ──────────────────────────────────────────────
FROM oven/bun:1.3 AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 서버 실행에 필요한 것만 복사 (node_modules는 sharp 네이티브 바이너리 포함)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/lite/dist ./apps/lite/dist

# 정적 파일/데이터 경로 (docker-compose에서 /app/data 볼륨 마운트)
ENV WEB_STATIC_DIR=/app/apps/web/dist \
    LITE_STATIC_DIR=/app/apps/lite/dist \
    DB_PATH=/app/data/litechat.db \
    UPLOAD_DIR=/app/data/uploads \
    PORT=3000

EXPOSE 3000
CMD ["bun", "run", "apps/server/src/index.ts"]
