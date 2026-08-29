# App Store submission worksheet

Suggested values describe only existing functionality. Items marked **MANUAL** need the legal owner or App Store Connect.

## Product page

| Field              | Suggested value / action                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| App name           | `litechat` (confirm name availability)                                                                                |
| Subtitle           | `가볍게 이어지는 우리 대화`                                                                                           |
| Primary category   | Social Networking                                                                                                     |
| Secondary category | Utilities (optional; omit if the owner prefers one category)                                                          |
| Promotional text   | `아이디로 친구를 찾고, 텍스트와 이모지, 사진으로 편안하게 대화해요. 알림과 안전 설정도 내 방식대로 관리할 수 있어요.` |
| Keywords           | `채팅,메신저,친구,대화,사진,이모지,알림,1대1`                                                                         |
| Support URL        | `https://chat.moveto.kr/support`                                                                                      |
| Privacy Policy URL | `https://chat.moveto.kr/privacy`                                                                                      |
| Marketing URL      | `https://chat.moveto.kr` (optional)                                                                                   |
| Copyright          | **MANUAL:** legal owner name and year; do not use a trade name without authority                                      |
| Price              | Free; no IAP or subscriptions                                                                                         |
| Availability       | **MANUAL:** countries/regions and any legal restrictions                                                              |
| Version            | `1.0.0`; baseline build 12 passed SDK/entitlement inspection, but use the next successful replacement build           |

### Description

> litechat은 가까운 사람과 부담 없이 이어지는 1:1 메신저입니다.
>
> 복잡한 기능보다 대화에 집중했습니다. 친구의 아이디를 검색하고 요청을 주고받은 뒤, 텍스트와 이모지로 실시간 대화를 시작해 보세요. 대화 중 사진도 자연스럽게 나눌 수 있습니다.
>
> 필요한 알림만 선택하세요. 푸시 알림은 원할 때 켜고 끌 수 있으며, 알림을 허용하지 않아도 채팅 기능은 그대로 사용할 수 있습니다. 화면 테마도 내 환경에 맞게 선택할 수 있습니다.
>
> 불편한 상황에는 대화 상대나 메시지를 신고하고 원하지 않는 사용자를 차단할 수 있습니다. 프로필에서 개인정보처리방침과 지원 정보를 확인하고, 계정과 개인정보 설정을 직접 관리하거나 계정을 영구 삭제할 수 있습니다.

### Release notes

> litechat의 첫 공개 버전입니다. 친구 찾기와 요청, 실시간 1:1 대화, 사진·이모지, 선택적 알림, 신고·차단과 계정 관리를 담았습니다.

## App Privacy

Use the Apple worksheet in [PRIVACY_DATA_MAP.md](./PRIVACY_DATA_MAP.md). The conservative declarations are the friend social graph, user/account ID, messages, photos, other user content, random device/visitor identifiers, product interaction, coarse IP-derived location, and other diagnostics. All are **not used for tracking**. Do not submit until service-provider agreements and the production deployment have been checked against the worksheet.

## Age rating inputs

Answer according to the actual service:

| Topic                                             | Answer                                                    |
| ------------------------------------------------- | --------------------------------------------------------- |
| User-generated content                            | Yes — private 1:1 text/photo messaging                    |
| Messaging/chat                                    | Yes                                                       |
| User reporting and blocking                       | Yes; implemented and enforced                             |
| Unrestricted web access                           | No; legal/support links open only first-party HTTPS pages |
| Advertising                                       | No                                                        |
| Gambling/contests/loot boxes                      | No                                                        |
| Sexual content/nudity supplied by developer       | No                                                        |
| Violence, horror, profanity supplied by developer | No                                                        |
| Medical/wellness content                          | No                                                        |
| Alcohol, tobacco, drugs                           | No                                                        |

Users can still misuse messaging to send objectionable material. Do not understate the UGC/messaging answers; allow App Store Connect to calculate the rating.

## Encryption/export compliance

Technical inventory: TLS/HTTPS and secure WebSocket transport; Argon2id password hashing on the server; random session tokens; Apple Keychain-backed SecureStore; standard Apple push encryption; no custom VPN, end-to-end encryption protocol, crypto wallet, or user-facing encryption feature. `ITSAppUsesNonExemptEncryption=false` is generated. **MANUAL:** the legal exporter must confirm that only exempt standard encryption is used and answer App Store Connect accordingly.

## Review information

- **MANUAL reviewer contact:** real name, reachable phone, and `admin@moveto.kr` only after confirming it is monitored.
- **MANUAL demo account:** create a stable production username/password with an existing friend/conversation. Never put the password in source, screenshots, or the binary.
- Use [APP_REVIEW_NOTES.md](./APP_REVIEW_NOTES.md) for concise notes.
- There are no purchases, subscriptions, social login, ads, background location, AI processing, hardware requirements, or hidden paid features.
- Account deletion path: Profile → Account management → Permanently delete account.
- Notification and photo access are optional and requested from the initiating feature.

## Screenshots and assets

The reproducible composition pipeline exports seven opaque JPEGs for each supported Apple family. Every screen uses a clean temporary database and fictional Korean accounts; no production data is read.

| Asset set       | Location                                        | Dimensions                | Purpose                                 |
| --------------- | ----------------------------------------------- | ------------------------- | --------------------------------------- |
| iPhone 6.9-inch | `store-assets/app-store/ko/iphone-6.9/*.jpg`    | 1320×2868                 | Seven portrait product images           |
| iPad 13-inch    | `store-assets/app-store/ko/ipad-13/*.jpg`       | 2064×2752                 | Seven portrait, split-view aware images |
| Source captures | `store-assets/captures/ios/{iphone,ipad}/*.jpg` | Same native listing sizes | Replaceable capture inputs              |
| Brand master    | `store-assets/source/brand-master-2048.png`     | 2048×2048                 | High-resolution review/source           |

Sequence: conversation list, real-time text/emoji chat, photo chat, friend search/request, notification/theme controls, safety controls, and account/privacy controls. The full paths and capture procedure are in `store-assets/README.md`.

The current automated captures render the actual Expo application and seeded backend through Chromium because this environment has no Apple simulator. They are validated, final-format submission previews, not signed-build native captures. **MANUAL final gate:** replace the iOS source captures with the same screens from the final TestFlight build, rerun `bun run store-assets:compose && bun run store-assets:validate`, then visually compare before upload. See [Apple's current screenshot specification](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

The 1024×1024 default app icon is opaque; dark and tinted source variants are generated for the OS. **MANUAL:** validate Apple's processed appearance modes in App Store Connect.

## Submission checklist

- [ ] Updated legal/support site deployed and the four URLs visually verified.
- [x] Baseline production iOS archive succeeds on Xcode 26 / iOS 26 SDK.
- [ ] The next successful replacement build contains the final collected-data manifest and is uploaded to TestFlight.
- [ ] Bundle ID `kr.moveto.litechat`, version/build and APNs capability confirmed in the signed archive.
- [ ] Demo account and reviewer contact entered.
- [ ] Privacy answers entered from the worksheet and legally confirmed.
- [ ] Age rating, content rights, export compliance, availability, pricing and copyright entered by owner.
- [x] iPhone/iPad preview sets generated at valid dimensions with no alpha.
- [ ] Final TestFlight-native captures substituted, recomposed and uploaded; icon has no processing warning.
- [ ] TestFlight smoke test covers login, photo denial/allow, notifications, report/block, deletion and relaunch.
- [ ] Build selected and manually submitted for App Review; do not auto-release without owner instruction.
