# Release readiness

## Executive status

**CONDITIONALLY READY at source level; not yet eligible for immediate store submission.** All repository-addressable required features found in the audit are implemented, and the web/native configuration and automated product flows pass. Immediate submission is blocked by the stale production deployment, replacement signed artifacts after final manifest hardening, real-device notification/permission tests, final native screenshot recapture, and owner-entered legal/account declarations.

Audit date: 2026-08-29.

| Surface           | Status                                           | Evidence                                                                                                                                | Gate remaining                                                                         |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| iOS app           | Baseline IPA passed; replacement upload blocked  | Build 12 used Xcode 26.6/iOS 26.5, production APNs, iOS 16.4 and valid manifests; final source adds audited collected-data declarations | Retry a replacement EAS archive, inspect it, then run a TestFlight device test         |
| Android app       | Baseline AAB passed; final rebuild quota-blocked | Actual versionCode 4 AAB is API 36 and 16 KB compatible; final source also removes unused storage/biometric/query declarations          | Rebuild after quota reset, re-inspect merged manifest and Play-device test             |
| Full/Lite web     | Build ready                                      | Production Vite/Lite builds and 7/7 browser E2E journeys pass                                                                           | Deploy current commit; live legal routes still render the old login UI                 |
| Backend           | Source/test ready                                | Deletion, UGC safety, retention, rate limiting, strict WS frames, ownership and secure headers tested                                   | Deploy current image, create reviewer accounts and verify production flows             |
| Store preparation | Generated previews and worksheets ready          | Original brand, validated listing graphics, Korean copy, privacy/data-safety, rating, export, review notes and test matrix              | Native-build screenshot substitution, owner/console entry, legal identity confirmation |

## Implemented release work

- Controlled upgrade/alignment to current Expo SDK 57 packages and React Native 0.86.3; duplicate native modules eliminated with a hoisted Bun workspace install.
- Complete Expo/EAS production configuration: IDs, versions, HTTPS environment, separate profiles, store AAB, remote native versioning, production channel and fingerprint runtime policy.
- Minimal generated permissions, contextual photo/notification prompts, custom scheme, adaptive/monochrome/notification icons, iPad intent and safe SecureStore backup exclusion.
- Mobile bootstrap retry/error boundary, HTTPS API timeout/error mapping, Keychain/Keystore token storage and secure logout/deletion cleanup.
- Discoverable mobile and public-web account deletion with password reauthentication, explicit irreversible confirmation, database/file/session/token/cache cleanup and tested non-resurrection.
- Accurate public privacy, terms, support and deletion pages plus in-app/login links.
- Real UGC report/block features, two-way backend enforcement and a functioning moderator dashboard queue.
- Startup and six-hourly data-retention enforcement for analytics/notification logs (90 days), Insights cache (30 days) and resolved reports (365 days), with fresh/open-record preservation tests.
- Security hardening: authentication/admin throttles, atomic distributed counters, push-token ownership, strict 8 KB WebSocket schemas, secure headers, production API-doc shutdown and current-tree secret hygiene.
- Runtime databases, WALs, uploads and licensed GeoIP artifacts removed from tracking and ignored going forward.
- A root `.easignore` excludes VCS history, credentials, runtime data and unrelated generated output from cloud-build uploads; the source archive dropped from 61.9 MB to 522 KB.
- Original Soft Conversation Pebble identity generated across iOS appearances, Android adaptive/monochrome/notification assets, Expo splash, web/PWA, dashboard, Open Graph, and store graphics from one canonical SVG.
- Deterministic fictional-data capture, store composition, and validation pipeline produces App Store iPhone/iPad and Google Play phone/tablet previews, a 512 px Play icon, and an opaque 1024×500 feature graphic.

## Current build records

- Android EAS production build: `846ceb51-9443-4712-a189-c33b747ff90e`, package `kr.moveto.litechat`, version `1.0.0` / versionCode `4`, store AAB, production channel, runtime fingerprint `bdafa2e536772809c79b1265e405f0c4f65bceb8`. Build and bundletool validation passed. This artifact is superseded because its merged manifest exposed unused legacy storage and biometric declarations; final source removes those plus unused camera/video/tree visibility queries. A versionCode 5 rebuild was rejected because the account exhausted its monthly Android builds.
- iOS baseline EAS production build: `7cdf6c46-ccc3-4bd0-9389-6e2471561261`, version `1.0.0` / buildNumber `12`. The signed IPA passed inspection: Xcode 26.6 build `17F113`, iOS SDK 26.5, minimum iOS 16.4, production APNs entitlement, expected photo purpose string, no camera/microphone/Face ID strings and 13 valid privacy manifests. It is superseded because its app manifest predates the final collected-data declarations. Corrected replacement attempts advanced remote build numbers to 14 but stalled in EAS upload transport before a build record was created.
- No store submission or public rollout was triggered.

## Release blockers

1. **Deploy the current web/backend image.** `https://chat.moveto.kr/api/health` is 200, but live `/privacy`, `/terms`, `/support` and `/account-deletion` render the old login page; unauthenticated `DELETE /api/auth/account` returns 404. Current code must be deployed and reverified.
2. **Finish replacement signed artifacts.** Rebuild Android after the EAS quota resets so the AAB includes final permission/query removals; then repeat merged-manifest and Play checks. Retry and inspect a replacement iOS build for the collected-data manifest, then smoke-test both platforms.
3. **Rotate and contain historical admin credentials.** Runtime SQLite/WAL files containing an admin password hash were previously committed. They are deleted now, but earlier EAS uploads also included the shallow Git pack. Rotate the admin password/session, remove the data from Git history, and treat repository/build-service access as exposed until containment is confirmed.
4. **Supply real owner/reviewer information.** Confirm legal operator identity/copyright/privacy controller details, monitored support email/phone, production demo and deletion-test accounts.
5. **Substitute native captures and complete account-level forms.** Final-format preview sets, the Play icon, and feature graphic are generated and validated. Replace their Chromium-rendered Expo UI inputs with captures from final TestFlight/internal-test builds, then complete privacy/data-safety, rating, export, availability and pricing declarations.
6. **Confirm Play closed-testing applicability.** If the personal account was created after 2023-11-13, 12 continuously opted-in testers for 14 days and production-access approval are a scheduling blocker.

## Manual release sequence

1. Rotate the historical admin credential, review repository access/history, and deploy the current Docker image with production secrets supplied only by Dokploy.
2. Verify the four public URLs, security headers, deletion/report/block routes, production API, database migration/retention and an external demo account.
3. Complete/download and inspect Android/iOS artifacts; run [RELEASE_TEST_PLAN.md](./RELEASE_TEST_PLAN.md) on physical devices/TestFlight/Play testing.
4. Review [PRIVACY_DATA_MAP.md](./PRIVACY_DATA_MAP.md) with the legal owner and provider agreements, then enter the two console privacy forms.
5. Fill [APP_STORE_SUBMISSION.md](./APP_STORE_SUBMISSION.md), [PLAY_STORE_SUBMISSION.md](./PLAY_STORE_SUBMISSION.md), and [APP_REVIEW_NOTES.md](./APP_REVIEW_NOTES.md); upload truthful final-build assets.
6. Stage TestFlight and Play internal/closed testing. Do not start a public rollout until all manual gates are checked.

Policy-by-policy evidence is in [STORE_COMPLIANCE.md](./STORE_COMPLIANCE.md).
