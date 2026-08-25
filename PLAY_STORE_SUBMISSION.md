# Google Play submission worksheet

Suggested values describe only shipped functionality. Items marked **MANUAL** require Play Console/account owner action.

## Store listing

| Field                | Suggested value / action                                  |
| -------------------- | --------------------------------------------------------- |
| App name             | `litechat`                                                |
| Short description    | `친구와 빠르게 연결되는 가벼운 1:1 채팅`                  |
| Category             | Communication                                             |
| Contact email        | `admin@moveto.kr` — **MANUAL:** confirm it is monitored   |
| Website              | `https://chat.moveto.kr`                                  |
| Privacy policy       | `https://chat.moveto.kr/privacy`                          |
| Account deletion URL | `https://chat.moveto.kr/account-deletion`                 |
| Pricing              | Free; no in-app products or subscriptions                 |
| Countries/regions    | **MANUAL:** owner selection and legal availability review |

### Full description

> litechat은 친구와 빠르게 연결되는 가벼운 1:1 채팅 서비스입니다.
>
> 아이디로 친구를 검색하고 요청을 주고받을 수 있습니다. 친구가 되면 텍스트, 이모지와 사진으로 실시간 대화를 나누고 선택적으로 새 메시지 알림을 받을 수 있습니다.
>
> 사용자 안전을 위해 메시지와 사용자를 신고하거나 차단할 수 있으며, 운영자가 실제 신고를 검토합니다. 프로필에서 개인정보처리방침과 지원 정보를 확인하고 계정을 직접 영구 삭제할 수 있습니다.

### Release notes

> 첫 공개 버전: 친구 검색/요청, 실시간 1:1 채팅, 사진과 이모지, 선택적 알림, 신고·차단, 계정 삭제를 지원합니다.

## Data Safety

Use the Google worksheet in [PRIVACY_DATA_MAP.md](./PRIVACY_DATA_MAP.md). Collected categories are user IDs, nicknames, the in-service friend social graph, messages, photos, app interactions, device/other IDs, approximate IP-derived location and operational diagnostics. Data is encrypted in transit and deletion is implemented. Confirm whether intended-recipient and processor transfers qualify for Google's current service-provider/user-action exceptions before selecting **Shared: No**.

## App Content declarations

| Declaration           | Evidence-backed answer / action                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Privacy Policy        | Yes; deploy `/privacy` before submission                                                                                                                                                         |
| Data Safety           | Complete from the shared worksheet; **MANUAL** entry and attestation                                                                                                                             |
| App Access            | All core features require login. **MANUAL:** provide stable demo username/password and navigation notes                                                                                          |
| Ads                   | No                                                                                                                                                                                               |
| Content rating        | Messaging and user-generated text/photos: yes; reporting/blocking/moderation: yes. No gambling, developer-supplied mature content, drugs, violence or sexual content. Let IARC assign the rating |
| Target audience       | General communication app; **MANUAL:** choose actual intended age groups. Do not select children unless child-directed obligations are deliberately met                                          |
| News                  | No                                                                                                                                                                                               |
| Account deletion      | Yes in app and on public web; deploy and verify exact URL first                                                                                                                                  |
| Sensitive permissions | Notifications and legacy photo selection only; no restricted permission declaration expected. Confirm Play pre-launch/manifest report                                                            |
| Health                | No health feature/data                                                                                                                                                                           |
| Financial             | No financial feature/data                                                                                                                                                                        |
| Government            | Not government-affiliated                                                                                                                                                                        |
| Purchases             | No digital/physical sales and no billing SDK                                                                                                                                                     |
| AI-generated content  | No AI feature/provider                                                                                                                                                                           |

## Build and Android baseline

- Package: `kr.moveto.litechat`
- Version name: `1.0.0`; signed build `846ceb51-9443-4712-a189-c33b747ff90e` used versionCode 4. It proved the API/16 KB baseline but is superseded by final permission hardening; rebuild with the next unused code after the EAS quota resets.
- Production profile emits an Android App Bundle.
- Generated baseline: `compileSdkVersion 36`, `targetSdkVersion 36`, `minSdkVersion 24`, NDK `27.1.12297006`, AGP `8.12.0`, new architecture/Hermes, `expo.useLegacyPackaging=false`.
- [Google requires API 36 starting 2026-08-31](https://developer.android.com/google/play/requirements/target-sdk); the source configuration already meets it.
- VersionCode 4 bundletool evidence: valid AAB, actual min/compile/target 24/36/36, `PAGE_ALIGNMENT_16K`, and all arm64/x86_64 native libraries have 16 KB ELF LOAD alignment. **MANUAL final gate:** repeat on the rebuilt artifact and confirm Play's 16 KB/pre-launch report.

## Graphics and screenshots

Existing source: 1024×1024 app icon plus adaptive foreground/background, monochrome icon, notification icon and splash art. Missing store-specific assets:

- **MANUAL:** 512×512 Play icon exported from final branding.
- **MANUAL:** 1024×500 JPEG or 24-bit PNG feature graphic with no alpha ([official specification](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-419)).
- **MANUAL:** at least two phone screenshots; capture the seven flows listed in `APP_STORE_SUBMISSION.md` using test data.
- Because the app is responsive and advertises tablet support on iOS, provide 7-inch and 10-inch Android tablet screenshots and perform a large-screen device test rather than opting out accidentally.

## Personal-account closed testing gate

The repository cannot determine the Play developer account type or creation date. If this is a personal account created after 2023-11-13, public production access generally requires:

1. Create a closed-testing track and publish the signed AAB there.
2. Recruit at least 12 testers and have all remain opted in continuously for at least 14 days.
3. Collect meaningful feedback on login, chat, images, notifications, safety and deletion; document fixes.
4. Complete the production-access application with honest testing and readiness answers.
5. Wait for Google to grant production access before scheduling public launch.

See [Google's current production-access requirement](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en). Treat this as a schedule blocker until the account owner confirms it does not apply or completes it.

## Release checklist

- [ ] Updated backend/legal pages deployed and visually verified on HTTPS.
- [ ] AAB build succeeds; artifact target SDK, permissions, signing and 16 KB alignment verified.
- [ ] Upload to internal/closed testing only; do not start production rollout automatically.
- [ ] Play App Signing certificate is recorded if App Links are added later. Current app uses only `litechat://` and declares no App Links.
- [ ] Demo account and reviewer instructions entered under App Access.
- [ ] Data Safety, content rating, target audience and account-deletion declarations submitted by owner.
- [ ] Store icon, feature graphic and phone/tablet screenshots uploaded.
- [ ] Physical-device smoke test covers install/relaunch, denied permissions, offline/401/429/500 handling, push navigation, block/report and deletion.
- [ ] Closed-testing applicability confirmed and requirement completed if applicable.
