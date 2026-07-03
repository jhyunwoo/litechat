#!/bin/sh
# e2e용 서버 기동 — 매 실행마다 깨끗한 DB로 시작한다.
cd "$(dirname "$0")"
rm -rf .data
export PORT=3100
export DB_PATH=.data/e2e.db
export UPLOAD_DIR=.data/uploads
export REDIS_URL=memory
export WEB_STATIC_DIR=../apps/web/dist
export LITE_STATIC_DIR=../apps/lite/dist
export LITE_HOST=127.0.0.1
export PASSWORD_MEMORY_COST=4096
exec bun run ../apps/server/src/index.ts
