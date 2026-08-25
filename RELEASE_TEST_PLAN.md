# Release test plan and evidence

Execution date: 2026-08-25. Automated results are recorded exactly; unchecked scenarios require a signed build, production deployment, store sandbox or physical device and must not be inferred from JavaScript tests.

## Completed quality gates

| Command / check                                                         | Result                                              | Coverage/evidence                                                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile` with Bun 1.3.14                         | PASS after SDK alignment                            | Hoisted monorepo dependency graph from `bun.lock`                                                                                                              |
| `bun run check-types`                                                   | PASS                                                | Six applicable workspaces; no TypeScript errors                                                                                                                |
| `bun run lint`                                                          | PASS                                                | Expo ESLint configuration; no warnings/errors                                                                                                                  |
| `bun run test`                                                          | PASS: server 124, mobile 48                         | All server/mobile suites under Bun 1.3.14 with Node 22.14 available to Jest; FlashList emits a known test-only `act` warning and Jest uses `--forceExit`       |
| Targeted release/security/privacy suites                                | PASS, 26 tests                                      | Account deletion cascade/session/file cleanup, retention cutoffs, block/report enforcement, push token ownership, KV atomic limiter and WebSocket validation   |
| `bun run build`                                                         | PASS                                                | Vite Full Chat, operator dashboard and byte-budgeted Lite web production bundles                                                                               |
| `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e` in `e2e/` | PASS, 7/7                                           | Realtime chat, logout/relogin, Lite draft, successful web deletion/non-resurrection and mobile-sized public pages                                              |
| `bun x expo install --check`                                            | PASS                                                | No Expo dependency version mismatch                                                                                                                            |
| `bun x expo-doctor`                                                     | PASS, 21/21                                         | Expo configuration, package compatibility, native duplication checks                                                                                           |
| `NODE_ENV=production bun x expo config --type public --json`            | PASS                                                | Resolved IDs, production URL config, fingerprint runtime, plugins and blocked permissions                                                                      |
| Temporary CNG `expo prebuild --platform android --no-install`           | PASS                                                | Effective AndroidManifest, Gradle, resources and custom-scheme intent filter                                                                                   |
| Temporary CNG `expo prebuild --platform ios --no-install`               | PASS                                                | Effective Info.plist, entitlement, privacy manifest and Xcode deployment settings                                                                              |
| Production web URL probes                                               | PARTIAL / BLOCKED                                   | API health is HTTPS 200; legal route HTTP requests are 200 but use the old web asset, and unauthenticated account deletion returns 404, so deployment is stale |
| High-confidence current-tree secret scan                                | PASS                                                | No private-key, common cloud/API-token signature, signing keystore or service-account file found                                                               |
| Git-history sensitive-file scan                                         | ACTION REQUIRED                                     | Historical SQLite/WAL files contained runtime data/admin hash; deleted from current tree, but history cleanup/credential rotation is manual                    |
| EAS source-archive inspection                                           | PASS after hardening                                | `.easignore` removed `.git`, runtime databases, uploads, credentials and GeoIP artifacts; archive reduced from 61.9 MB to 522 KB                               |
| Android EAS production build                                            | PASS, then superseded by final permission hardening | Signed versionCode 4 AAB, build `846ceb51-9443-4712-a189-c33b747ff90e`; final rebuild was rejected by monthly quota                                            |
| `bundletool 1.18.3 validate/dump` on versionCode 4 AAB                  | PASS                                                | Actual AAB: package/version, min 24, compile/target 36, production channel and `PAGE_ALIGNMENT_16K`                                                            |
| Independent ELF program-header scan of AAB                              | PASS for required 64-bit ABIs                       | 104 `.so` total; all 26 arm64-v8a and 26 x86_64 libraries use `0x4000` LOAD alignment                                                                          |
| iOS EAS baseline production build                                       | PASS, then superseded by final privacy declaration  | Build `7cdf6c46-ccc3-4bd0-9389-6e2471561261`, buildNumber 12; Xcode 26.6/iOS 26.5, production APNs and 13 valid manifests inspected                            |
| iOS replacement production build                                        | BLOCKED during upload                               | Attempts for buildNumbers 13/14 stalled before EAS created a build record; `.easignore` reduced the secure upload context from 61.9 MB to 522 KB               |

## Automated scenarios covered

- Account registration, valid/invalid login, logout and session restoration.
- Friend search, request, acceptance and realtime updates from two isolated browser sessions.
- Realtime text/emoji/image send, previews, read receipts and image ownership.
- Push subscribe/unsubscribe ownership, token association, receipt acknowledgement and notification navigation logic.
- Account deletion success, invalid password, all-session invalidation, database cascade, analytics/push cleanup and uploaded-file removal.
- Report validity, moderator queue data, block enforcement in search/friends/conversations/messages/images, and unblock.
- Authentication rate-limit response and `Retry-After`; strict, bounded WebSocket frames.
- Retention removes expired analytics/notification rows at 90 days, Insights cache rows at 30 days and resolved reports at 365 days while preserving fresh and open records; production schedules it every six hours.
- API unhappy paths represented in unit tests and shared error mapping, including 401/404/429/server/offline/timeout user messages.
- Public privacy/terms/support/account-deletion routes at a 390×844 viewport, accessible labels and generic invalid-credential response.
- Web keyboard navigation, logout/relogin, Lite low-byte budget and draft preservation across realtime rerenders.

## Signed-build / physical-device matrix

These are release gates and remain **MANUAL** until recorded against the final artifacts.

### Install and lifecycle

- [ ] Clean install from TestFlight and Play internal/closed testing.
- [ ] Cold launch, warm launch, repeated launch, process kill/relaunch and update from any earlier distributed build.
- [ ] Login restoration, 30-minute background/session boundary, expired token and revoked-session recovery.
- [ ] Offline launch, loss/restoration during send/upload, timeout, 401, 403, 404, 429 and 500 responses; no stuck splash/blank screen.
- [ ] Small iPhone, current large iPhone/Dynamic Island, 13-inch iPad split view, small/large Android and gesture/3-button navigation.
- [ ] Keyboard does not obscure sign-in, composer, report details or deletion password; safe areas remain reachable.

### Authentication and account

- [ ] Signup, invalid credentials, login, logout and reinstall with SecureStore/Keychain behavior.
- [ ] Edit nickname, deletion failure and success; login after deletion cannot resurrect data.
- [ ] Reviewer and disposable deletion accounts work from an external network without OTP/VPN.

### Permissions and notifications

- [ ] Photo access granted, denied, previously denied, iOS limited access and changed later in Settings.
- [ ] Notification granted, denied and changed in Settings; chat remains functional.
- [ ] Foreground/background/terminated push receipt, tap navigation, duplicate/rotated token and logout/deleted-account cleanup on real APNs and FCM devices.
- [ ] Final Android merged manifest has no camera, microphone, storage/media, overlay, biometric, location, contacts, advertising ID or other undeclared capability.

### Links, safety and content

- [ ] `litechat://` cold/warm launch, logged-in/logged-out and malformed/unauthorized conversation ID.
- [ ] Report message/user, block and unblock using two device accounts; verify both directions and moderator dashboard resolution.
- [ ] Upload valid photo; reject unsupported/oversize content; image is inaccessible after block/deletion.

### Artifact-specific

- [ ] Android: download AAB, run bundletool manifest dump, enumerate all `.so`, verify ZIP/ELF 16 KB alignment and Play pre-launch 16 KB report, confirm package/version/signature.
- [x] iOS baseline: inspect archive privacy manifests, production `aps-environment`, Info.plist, bundle/build version and Xcode/iOS SDK build environment.
- [ ] iOS replacement: repeat archive inspection on the next successful build and confirm all nine collected-data declarations.
- [ ] Test Expo Update on production channel only with matching fingerprint; verify failed update rollback/fallback behavior.
- [ ] Capture final screenshots from signed binaries with demo content only.

## Release test data rules

Use unique synthetic usernames and non-personal images/messages. Store reviewer credentials only in App Store Connect/Play Console. Never commit passwords, push credentials, production tokens, user exports, SQLite databases, uploads or TestFlight/Play signing material.
