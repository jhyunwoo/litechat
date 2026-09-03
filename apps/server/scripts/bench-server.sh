#!/bin/sh
# 벤치마크용 서버 기동 — 시드된 임시 DB로 프로덕션 모드로 띄운다.
# 사용: SCR=<scratch dir> sh apps/server/scripts/bench-server.sh
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
: "${SCR:?SCR (scratch dir) required}"
export PORT="${PORT:-3100}"
export DB_PATH="$SCR/run.db"
export UPLOAD_DIR="$SCR/uploads"
export REDIS_URL=memory
export NODE_ENV=production
export LITE_HOST=127.0.0.1
export WEB_STATIC_DIR="$ROOT/apps/web/dist"
export LITE_STATIC_DIR="$ROOT/apps/lite/dist"
export DASHBOARD_STATIC_DIR="$ROOT/apps/dashboard/dist"
export GEOIP_DB_PATH="$SCR/none.mmdb"
cd "$ROOT"
exec bun run apps/server/src/index.ts
