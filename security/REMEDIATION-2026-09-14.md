# 보안 수정 기록 — 2026-09-14

현재 작업 트리를 대상으로 확인한 문제의 로컬 수정 기록이다. 전체 저장소·운영 서버에 대한 완전한 감사나 침투 테스트 결과는 아니다. 이전 `findings.json`의 판정을 그대로 재사용하지 않았다. 독립 점검 에이전트는 사용량 제한으로 중단되었으며, 아래 내용은 직접 확인한 코드와 로컬 테스트에 근거한다.

## 확인 및 수정

| 문제 | 공격 조건과 영향 | 적용한 통제 |
| --- | --- | --- |
| Web Push 목적지 미검증 (CWE-918, 중간) | 가입 사용자가 임의 endpoint를 등록하고 두 번째 계정에서 메시지를 보내면 서버가 해당 HTTPS 주소로 요청. VAPID 설정이 있어야 실제 발송되며, 라이브 내부망 접근/데이터 탈취는 검증하지 않음 | Google FCM·Mozilla·Apple Web Push 호스트 허용 목록, HTTPS/포트/사용자정보 검증, 기존 DB 행도 발송 직전 재검증. 발송 타임아웃 10초, 사용자당 구독 10개 |
| 로그아웃 이후 WebSocket 권한 유지 (CWE-613, 중간) | 유효 세션으로 미리 연 소켓은 Redis 세션 삭제 후에도 메시지를 수신·전송할 수 있었음 | 소켓을 세션 토큰에 연결하고 로그아웃 시 해당 세션만 종료. 프레임마다 세션 재검증, Redis 대기 중 로그아웃 경합도 확인 |
| 부모 도메인 쿠키 및 브라우저 Origin 미검증 (CWE-565/CWE-346, 중간) | 다른 moveto.kr 서비스 운영자/침해자가 공유 세션 쿠키를 받거나 같은 사이트의 악성 페이지에서 쿠키 기반 WebSocket을 열 수 있음 | 사용자가 선택한 사이트별 로그인 적용. 운영 쿠키를 `__Host-lc_sess`로 교체하고 legacy 쿠키는 인증에 사용하지 않음. API 접근 시 이전 쿠키 만료. 상태 변경·WS 요청의 Origin/Fetch Metadata 검사 |
| 업로드 및 인증 후 자원 사용 제한 부족 (CWE-770, 중간) | 공개 가입 후 이미지 변환을 병렬 실행하거나 원본 파일을 계속 누적할 수 있었음 | 업로드 요청 11MiB/JSON 64KiB 상한(Watch는 기존 8KiB 유지), IP 30회/분·사용자 100회/시간, 프로세스 내 변환 1건, 저장 할당량, 쓰기 실패 시 부분 파일 정리. REST/WS 공유 사용자 예산 240회/분, 사용자 소켓 8개, 네이티브 WS 프레임 8KiB |
| 인증 이미지 장기 캐시 (CWE-524, 낮음) | 같은 브라우저/앱 프로필에서 계정 전환·차단 이후에도 이전 URL의 이미지 응답을 인증 없이 재사용 가능 | API·이미지 응답 `no-store`, 웹/Lite/앱의 이미지 URL 버전 변경, Expo 이미지 `cachePolicy="none"` |

주요 근거: `apps/server/src/modules/push/service.ts`, `apps/server/src/ws/routes.ts`, `apps/server/src/modules/auth/routes.ts`, `apps/server/src/modules/images/routes.ts` 및 각 모듈의 회귀 테스트. 코드에 없는 일반적인 SQL injection/XSS/공개 Redis 노출을 발견했다고 주장하지 않는다.

## 호환성 및 운영 설정

- 웹 사용자는 배포 후 각 사이트에서 다시 로그인한다. 네이티브 Bearer 토큰 방식은 유지한다. 개발 HTTP에서는 기존 `lc_sess` 이름을 사용한다.
- `LEGACY_SESSION_COOKIE_DOMAIN=.moveto.kr`는 이전 쿠키 삭제용이다. 인증 쿠키의 Domain으로 사용하지 않는다.
- 기본 이미지 할당량은 사용자당 1GiB, 전체 10GiB이다. Dokploy의 `UPLOAD_USER_QUOTA_BYTES`, `UPLOAD_TOTAL_QUOTA_BYTES`로 조정할 수 있다. 기존 저장량이 상한을 넘으면 새 업로드를 거절하며 기존 파일을 삭제하지 않는다.
- 할당량은 DB에 기록된 이미지 원본+썸네일 크기 기준이다. SQLite, 로그, 백업 및 이전 고아 파일을 포함하는 파일시스템 할당량은 아니다. 단일 Bun 프로세스를 전제로 동시 변환과 할당량 검사 직렬화를 구현했다.
- 이미 사용자에게 다운로드되었거나 이전 버전 캐시에 저장된 바이트를 원격으로 회수하지는 않는다. 새 클라이언트는 이전 캐시 URL을 사용하지 않는다. 모바일 수정은 별도 앱 업데이트가 필요하다.
- 허용 목록 외 Push 서비스는 `INVALID_PUSH_ENDPOINT`로 거절한다. Chrome/Firefox/Safari용 공급자를 대상으로 하며 새 공급자 추가 시 공식 endpoint를 확인한다. 등록 단계 테스트는 발송 모킹을 사용했으므로 실제 브라우저별 Push 전달 확인은 배포 후 필요하다.

## 검증

- `bun test apps/server/src`: 191 통과, 0 실패. 실제 로컬 WebSocket 서버에서 로그아웃 즉시 종료 및 다른 기기 세션 유지 검증 포함.
- `bun run check-types`: 7개 워크스페이스 통과. 마지막 서버 변경 후 서버 타입 검사도 재실행하여 통과.
- `bun run --filter web --filter lite --filter dashboard build`: 3개 프론트엔드 빌드 통과.
- 신규 회귀 테스트는 임의 푸시 목적지와 과거 DB 행, 쿠키 이전, sibling Origin, 본문 상한, 사용자/전체 저장량 및 동시 변환, 업로드 요청 제한을 검증한다.
- 모바일 캐시 변경은 타입 검사 대상이며 iOS/Android 실기기 캐시 동작은 미검증이다.

## 남은 확인 범위

- `bun audit --json`은 12개 패키지군에 경고를 반환했다: @xmldom/xmldom, baseline-browser-mapping, brace-expansion, browserslist, decode-uri-component, fast-uri, image-size, js-yaml, nanoid, postcss, react-router, uuid. 이번 변경은 이 의존성을 업그레이드하지 않았다. 경고 전체를 해결했다고 보아서는 안 된다.
- React Router 경고는 RSC action 경로이며 현재 웹/대시보드는 Vite SPA이다. js-yaml은 문서 생성 관련 전이 의존성에도 포함된다. 모든 전이 의존성의 취약 버전/입력 도달성 검토와 도구 체인 업그레이드는 후속 작업이다.
- Dokploy 읽기 전용 조회로 litechat production Compose가 GitHub `main`과 연결되고 자동 배포가 켜져 있음을 확인했다. 로컬 Compose는 app/Redis 호스트 포트를 공개하지 않고 app을 uid 1000으로 실행한다. 실제 배포 컨테이너와 로컬 설정이 일치한다고 단정하지 않는다.
- 운영 배포, Ubuntu 패치 상태, SSH·OCI 보안 목록/NSG·UFW, Dokploy 관리 콘솔 접근 제한, 실제 Traefik 전달 헤더 설정과 우회 접근, 컨테이너 이미지 취약점, 브라우저 E2E·실기기·부하 테스트는 수행하지 않았다.
- 운영 반영 전 볼륨 백업과 여유 공간을 확인한다. 반영 후 사이트별 로그인, 기존 세션 종료, 이미지 업로드, 모바일 Bearer 요청, 각 브라우저 푸시 전달을 확인하고 403/413/429/503 비율과 디스크 여유를 관찰한다. 롤백은 이전 앱 이미지로 하되 취약점이 다시 열릴 수 있으며 새 웹 쿠키는 이전 버전에서 인식되지 않는다. DB 마이그레이션은 없다.

참고한 공식 문서: [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Google Push 서버 예제](https://web.dev/articles/push-notifications-server-codelab), [Expo SDK 57 Image 캐시 정책](https://docs.expo.dev/versions/v57.0.0/sdk/image/#cachepolicy).
