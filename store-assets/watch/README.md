# Native Watch screenshots

## 한국어 캡처 안내

이번 변경의 Watch 화면은 아직 Mac에서 빌드하거나 캡처하지 않았습니다.
아래 스크립트는 실제 SwiftUI 앱만 캡처하며 브라우저 화면을 Watch 화면으로
대체하지 않습니다. 한국어와 영어 각각 416 × 496 PNG 4장이 필요합니다.

1. 별도의 임시 데이터베이스·이미지 저장소를 사용하는 로컬 서버를 실행합니다.
   아래 `seed.ts` 명령을 `ko`, `en`으로 각각 실행하면 가상 계정·친구 관계·
   텍스트·읽음 상태·받은 사진이 생성됩니다. 운영 서버에 실행하지 마세요.
2. Watch는 신뢰할 수 있는 인증서가 있는 HTTPS만 사용합니다. 임시 서버를
   시뮬레이터에서 접근 가능한 HTTPS 주소로 연결하고 아래 Mac 빌드 명령의
   `WATCH_API_URL`에 넣습니다. HTTP 허용이나 인증서 검증 우회는 추가하지 않습니다.
3. 아래 `capture.ts` 명령에 실제 Watch 시뮬레이터 UDID, 빌드된 `.app` 경로,
   빌드 식별자와 소스 리비전을 지정합니다. 가상 계정으로 직접 로그인합니다.
   한국어 계정은 `watch_ko_0`, 영어 계정은 `watch_en_0`이며 비밀번호는
   `watch-demo-only-2026`입니다.
4. 스크립트 안내에 따라 대화 목록 → 텍스트 대화와 입력창 → 받은 사진 →
   계정 및 알림 화면으로 직접 이동합니다. 각 화면의 언어·내용·잘림 여부를
   확인한 뒤 터미널에 `capture`를 입력합니다. 키보드와 권한 팝업은 닫습니다.
5. 한국어 캡처 후 로그아웃하고 `WATCH_CAPTURE_LANGUAGE=en`으로 재실행하여
   영어 계정으로 캡처합니다. 시스템 키보드나 권한 화면까지 점검할 때는
   시뮬레이터 자체 언어도 바꿉니다. 메시지와 닉네임은 앱에서 번역되지 않습니다.

결과는 `app-store/{ko,en}/watch/`에 저장되고 원본과 출처 기록도 보관됩니다.
크기가 다르면 스크립트가 중단되므로 해당 해상도의 Watch 시뮬레이터를 사용하세요.
투명 픽셀이 있는 원본도 거부됩니다. 알림 허용 화면은 실제 푸시 수신 성공을
증명하지 않습니다. 실제 기기 독립 실행·APNs 검증은 `docs/apple-watch.md`를
따릅니다. 아래 표와 명령은 두 언어에 공통으로 적용됩니다.

## English capture guide

Status: capture tooling and fictional seed scenario are prepared. No Watch PNGs
have been captured or native SwiftUI builds verified for this localization change
in the Linux workspace. A Mac with Xcode and a Watch simulator is required. Browser
renders, resized phone screenshots and drawn Watch mockups are not Watch captures.

Linux verification passed: generated native target/resource membership checks,
48-key ko/en resource parity and call-site coverage, capture/seed script bundling,
and both seed scenarios against a disposable backend (Watch login, two
conversations, three texts, read watermark and authenticated thumbnail retrieval).
Swift localization tests were added but require the Mac Swift toolchain to run.

Produce four **416 × 496 PNGs per language** (ko and en), using the actual SwiftUI
app. The capture runner rejects any other native pixel size and copies the native
input without resizing, framing, captions or overlays. A fully opaque alpha
channel is removed losslessly for store compatibility; transparent input fails.

## Prepare a disposable server

Start the repository backend against a fresh disposable SQLite database, Redis
namespace/instance and image directory. Follow the repository development setup.
Keep this server running through capture; the native app loads real API responses.
Do not point the seed at production. The seed only accepts localhost URLs and
fails on existing usernames; use a fresh database for a repeat run.

From the repository root, with the local API running:

```sh
WATCH_SEED_API_URL=http://localhost:3000 WATCH_CAPTURE_LANGUAGE=ko bun store-assets/watch/seed.ts
WATCH_SEED_API_URL=http://localhost:3000 WATCH_CAPTURE_LANGUAGE=en bun store-assets/watch/seed.ts
```

The seed creates independent fictional account groups for both languages using
normal register, friend request/accept, chat, read and image-upload endpoints.
It uses the checked-in fictional illustration `source/demo-photo.svg`. Names and
message text are authored seed content for each group; app localization never
translates user content. The Watch itself receives images; it does not upload them.

| Language | Sign-in username | Nickname | Text peer | Photo peer |
| --- | --- | --- | --- | --- |
| ko | `watch_ko_0` | 하늘 | 민서 | 지우 |
| en | `watch_en_0` | Sky | Alex | Jamie |

All fictional accounts use `watch-demo-only-2026`. These credentials belong only
on the disposable server. The seed does not print session tokens. Server IDs and
timestamps are assigned normally; reruns reproduce content and state, not exact
time values.

## Build and install actual SwiftUI

The Watch API client requires **HTTPS with a valid trusted certificate**. Expose
that disposable local API through a trusted HTTPS development endpoint reachable
by the simulator, and set `WATCH_API_URL` to that endpoint during prebuild. Never
add an HTTP or certificate bypass to the production client for screenshots.

On a Mac, from `apps/app` (native generation replaces generated `ios/`):

```sh
WATCH_API_URL=https://YOUR-DISPOSABLE-DEV-ENDPOINT npx expo prebuild --clean -p ios
node scripts/verify-watch-config.cjs
swift test
xcodebuild -workspace ios/litechat.xcworkspace -scheme LiteChatWatch \
  -sdk watchsimulator -configuration Debug -derivedDataPath /tmp/litechat-watch-capture \
  CODE_SIGNING_ALLOWED=NO build
xcrun simctl list devices available
```

Select a Watch simulator whose screenshots are natively 416 × 496 pixels. Open
Simulator and that Watch window. If needed, complete its initial setup and local
certificate trust before capture. Use the resulting `LiteChatWatch.app`, normally
under `/tmp/litechat-watch-capture/Build/Products/Debug-watchsimulator/`.

From the repository root:

```sh
WATCH_CAPTURE_LANGUAGE=ko \
WATCH_SIMULATOR_UDID=YOUR-WATCH-UDID \
WATCH_APP_PATH=/tmp/litechat-watch-capture/Build/Products/Debug-watchsimulator/LiteChatWatch.app \
WATCH_NATIVE_BUILD='local Debug, source REVISION, Xcode VERSION' \
bun store-assets/watch/capture.ts
```

The runner verifies that the selected device is a Watch and the input app is
`kr.moveto.litechat.watch`, installs it, launches it with native AppleLanguages and
AppleLocale arguments, and pauses for real native navigation before each capture.
It does not simulate the UI or inject screenshot-only state into the app. Inspect
the language in the rendered app before typing `capture` at each prompt.

For English, sign out of the Korean seed account and repeat with
`WATCH_CAPTURE_LANGUAGE=en`, signing into `watch_en_0`. The launch arguments affect
this process; a normal launch again follows the Watch's preferred language. For
system-owned keyboard/permission UI and complete localization QA, also configure
the simulator system language before launching. Keep the keyboard and permission
dialog dismissed for these four listing screenshots.

## Four native states

1. **01-conversations**: both fictional peers and last-message previews visible;
   photo preview is localized; peer names are seed content.
2. **02-messages**: text conversation showing the received message, the outgoing
   message marked Read/읽음, and the actual empty message field and send button.
   Use the Digital Crown to position the native scroll view if necessary.
3. **03-photo**: photo conversation after the real thumbnail has loaded. Keep the
   received image visible, with native conversation title and composer if they fit.
4. **04-account**: actual Account & Notifications/계정 및 알림 screen with fictional
   nickname and Allow Notifications/알림 허용 control. This does not assert that
   notification permission has been granted or real APNs delivery has passed.

Outputs are `app-store/{ko,en}/watch/01-conversations.png`, `02-messages.png`,
`03-photo.png`, and `04-account.png`. Original inputs remain under
`captures/{ko,en}/watch/`. Each output has a `.provenance.json` receipt with native
build, simulator identity, capture time, source path and SHA-256 hashes of input
and output, compatible with `scripts/submission-checks.ts`. Receipts attest the
capture workflow and are not independent proof of device provenance.

Run the repository store-asset validator after capture. Review both languages
visually for truncation, scroll position, native text, unexpected alerts and
personal data. Check VoiceOver labels (especially received photo and send button)
and non-Korean primary-language fallback separately. Native simulator compilation,
screenshots and Swift tests must be recorded as Mac verification only after they
actually run. Physical independence and APNs checks remain in `docs/apple-watch.md`.
