---
name: verify
description: litechat 모노레포에서 web/dashboard/server 변경을 실제로 구동해 검증하는 레시피 (빌드→서버 기동→Playwright 드라이브)
---

# litechat 검증 레시피

## 빌드

- `bun run build` (turbo — web/dashboard/lite dist 생성). 개별: `cd apps/<x> && bun run build`.

## 서버 기동 (web + dashboard를 Host로 동시 서빙)

```sh
cd apps/server
PORT=3101 DB_PATH=<tmp>/verify.db UPLOAD_DIR=<tmp>/uploads REDIS_URL=memory \
  WEB_STATIC_DIR=../web/dist DASHBOARD_HOST=dash.localhost DASHBOARD_STATIC_DIR=../dashboard/dist \
  LITE_HOST=127.0.0.1 PASSWORD_MEMORY_COST=4096 bun run src/index.ts
```

- web = `http://localhost:3101`, dashboard = `http://dash.localhost:3101` (Host 라우팅), lite = `http://127.0.0.1:3101`.
- 대시보드 관리자 계정: `DB_PATH=<같은 경로> PASSWORD_MEMORY_COST=4096 bun run scripts/create-admin.ts <user> <pass>` (가입 플로우 없음).
- `GOOGLE_MAPS_API_KEY` 미설정이면 /map은 안내 문구 폴백 — 지도 캔버스 자체는 로컬에서 확인 불가.

## Playwright 구동 (이 박스 전용 함정)

- 시스템 lib 없음/sudo 불가 → `apt-get download libglib2.0-0t64 libnss3 libgbm1 libasound2t64 libatk1.0-0t64 libatspi2.0-0t64 libdbus-1-3 libnspr4 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 libdrm2 libxi6 libxrender1 libatk-bridge2.0-0t64 libcups2t64 libcairo2 libpango-1.0-0` 후 `dpkg-deb -x`로 풀고 `LD_LIBRARY_PATH=<dir>/usr/lib/aarch64-linux-gnu:<dir>/lib/aarch64-linux-gnu` 지정.
- 크로미엄 바이너리는 `~/.cache/ms-playwright`에 이미 있음. `@playwright/test`는 e2e 워크스페이스 의존성 — 드라이브 스크립트는 `cd e2e && bun <script>.ts`로 실행하면 import 가능.
- 헤드리스에 한글 폰트 없음 → 스크린샷의 한글은 tofu(□)로 보임. 레이아웃/색 검증엔 지장 없음.

## 드라이브 플로우 (검증 가치가 높은 경로)

- web: /register 가입(placeholder '아이디 (영문 소문자/숫자/_)' 등) → 두 번째 컨텍스트로 상대 가입 → 친구 검색/추가/수락 → 친구 링크 클릭으로 대화방 → '메시지 보내기' fill + press('Enter') → 상대가 열면 '읽음' 표시. **사용자명은 실행마다 유니크하게** (DB 재사용 시 중복 가입 실패).
- dashboard: /login → 개요/지도/접속 기록/사용자별 방문/웹 바이탈 순회. 지도 글래스 패널은 탭(접속 기록/사용자/진단) + 접기(‹)/열기('› 접속 기록') 버튼.
- e2e 스위트: `cd e2e && LD_LIBRARY_PATH=... bunx playwright test` (:3100에 자체 서버). lite.spec.ts는 신뢰 기준; web.spec.ts '전체 여정'은 기존부터 strict mode 중복('안녕 바비!' 목록 미리보기+버블)으로 실패 — 베이스라인 비교로만 판단.
