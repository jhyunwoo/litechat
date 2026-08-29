# Google Play submission worksheet

Suggested values describe only shipped functionality. Items marked **MANUAL** require Play Console/account owner action.

## Store listing

| Field                | Suggested value / action                                  |
| -------------------- | --------------------------------------------------------- |
| App name             | `litechat`                                                |
| Short description    | `친구를 찾고 편안하게 이어지는 가벼운 1:1 채팅`           |
| Category             | Communication                                             |
| Contact email        | `admin@moveto.kr` — **MANUAL:** confirm it is monitored   |
| Website              | `https://chat.moveto.kr`                                  |
| Privacy policy       | `https://chat.moveto.kr/privacy`                          |
| Account deletion URL | `https://chat.moveto.kr/account-deletion`                 |
| Pricing              | Free; no in-app products or subscriptions                 |
| Countries/regions    | **MANUAL:** owner selection and legal availability review |

### Full description

> 가까운 사람과 나누는 대화는 가벼워야 하니까.
>
> litechat은 복잡한 기능을 덜어내고 1:1 대화에 집중한 메신저입니다. 친구의 아이디를 검색해 요청을 보내고, 서로 연결되면 바로 대화를 시작할 수 있습니다.
>
> 편안한 대화
> 텍스트와 이모지를 실시간으로 주고받고, 일상의 사진도 대화 속에서 자연스럽게 공유할 수 있습니다.
>
> 내가 고르는 알림과 화면
> 새 메시지 알림은 필요할 때만 켜세요. 알림을 허용하지 않아도 채팅 기능을 사용할 수 있습니다. 시스템, 밝은 화면, 어두운 화면 중 보기 편한 테마도 선택할 수 있습니다.
>
> 가까이 둔 안전 기능
> 불편한 메시지나 대화 상대를 신고하고, 원하지 않는 사용자를 차단할 수 있습니다. 차단한 사용자는 별도 화면에서 확인하고 관리할 수 있습니다.
>
> 직접 관리하는 계정
> 프로필에서 개인정보처리방침과 지원 정보를 확인할 수 있습니다. 앱 안에서 계정과 개인정보 설정을 관리하고, 원하면 계정을 영구 삭제할 수 있습니다.

### Release notes

> litechat의 첫 공개 버전입니다. 친구 찾기, 1:1 채팅, 사진·이모지, 선택적 알림, 신고·차단과 계정 관리를 담았습니다.

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

Store-specific assets are generated independently from the launcher/adaptive icon:

| Asset             | Location                                                         | Dimensions            | Count / purpose              |
| ----------------- | ---------------------------------------------------------------- | --------------------- | ---------------------------- |
| Play store icon   | `store-assets/play-store/ko/icon-512.png`                        | 512×512               | Listing icon, PNG under 1 MB |
| Feature graphic   | `store-assets/play-store/ko/feature-graphic.png`                 | 1024×500              | Opaque 24-bit PNG            |
| Phone screenshots | `store-assets/play-store/ko/phone/*.jpg`                         | 1080×1920             | Seven portrait images        |
| 7-inch tablet     | `store-assets/play-store/ko/tablet-7/*.jpg`                      | 1920×1080             | Six landscape images         |
| 10-inch tablet    | `store-assets/play-store/ko/tablet-10/*.jpg`                     | 1920×1080             | Six landscape images         |
| Android captures  | `store-assets/captures/android/{phone,tablet-7,tablet-10}/*.jpg` | Device-profile output | Replaceable source UI        |

All generated listing images pass `bun run store-assets:validate`; the feature graphic has no alpha and uses no badges, ranking, pricing, review, or install claims. See [Google's official graphic specification](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).

The current automated source captures use the real Expo application, seeded server, and fictional Korean data rendered through Chromium because no Android emulator is installed here. They are final-format submission previews, not Play-build emulator captures. **MANUAL final gate:** overwrite the Android capture inputs from the final internal-test build, rerun `bun run store-assets:compose && bun run store-assets:validate`, and perform a phone/7-inch/10-inch visual comparison before upload.

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
- [x] Store icon, feature graphic and phone/tablet preview sets generated and validated.
- [ ] Final internal-test-build captures substituted, recomposed and uploaded.
- [ ] Physical-device smoke test covers install/relaunch, denied permissions, offline/401/429/500 handling, push navigation, block/report and deletion.
- [ ] Closed-testing applicability confirmed and requirement completed if applicable.
