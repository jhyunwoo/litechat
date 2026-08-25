# App Store submission worksheet

Suggested values describe only existing functionality. Items marked **MANUAL** need the legal owner or App Store Connect.

## Product page

| Field              | Suggested value / action                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| App name           | `litechat` (confirm name availability)                                                                      |
| Subtitle           | `가볍고 빠른 1:1 채팅`                                                                                      |
| Primary category   | Social Networking                                                                                           |
| Secondary category | Utilities (optional; omit if the owner prefers one category)                                                |
| Promotional text   | `친구를 아이디로 찾고, 메시지와 사진을 빠르게 주고받으세요.`                                                |
| Keywords           | `채팅,메신저,친구,대화,사진,알림,라이트챗`                                                                  |
| Support URL        | `https://chat.moveto.kr/support`                                                                            |
| Privacy Policy URL | `https://chat.moveto.kr/privacy`                                                                            |
| Marketing URL      | `https://chat.moveto.kr` (optional)                                                                         |
| Copyright          | **MANUAL:** legal owner name and year; do not use a trade name without authority                            |
| Price              | Free; no IAP or subscriptions                                                                               |
| Availability       | **MANUAL:** countries/regions and any legal restrictions                                                    |
| Version            | `1.0.0`; baseline build 12 passed SDK/entitlement inspection, but use the next successful replacement build |

### Description

> litechat은 친구와 빠르게 연결되는 1:1 채팅 앱입니다.
>
> 아이디로 친구를 찾고 요청을 주고받은 뒤, 텍스트와 이모지, 사진으로 대화할 수 있습니다. 새 메시지 알림은 사용자가 원할 때만 켤 수 있으며, 알림을 거부해도 모든 채팅 기능을 사용할 수 있습니다.
>
> 안전한 대화를 위해 메시지와 사용자를 신고하거나 차단할 수 있습니다. 프로필에서 개인정보처리방침과 지원 정보를 확인하고 계정을 직접 영구 삭제할 수 있습니다.

### Release notes

> litechat 첫 공개 버전입니다. 친구 찾기와 요청, 실시간 1:1 메시지, 사진·이모지 전송, 선택적 푸시 알림, 사용자 신고·차단 및 계정 삭제를 제공합니다.

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

The app advertises iPhone and iPad support, so both families need truthful captures from a signed build. Apple accepts 1–10 screenshots per supported device set; use the current highest-resolution iPhone 6.9-inch set and 13-inch iPad set so App Store Connect can scale where allowed. Files must not contain transparency. See [Apple's current screenshot specification](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

Capture this sequence without real personal data:

1. Chat list with realistic demo conversations.
2. 1:1 text and emoji conversation.
3. Photo message/viewer.
4. Friend search/request flow.
5. Report/block safety action.
6. Profile with notification, privacy and account controls.
7. iPad split-view chat layout.

The 1024×1024 light icon is opaque and the source includes dark/tinted variants. **MANUAL:** validate the processed icon in App Store Connect and capture screenshots on the final production/TestFlight binary.

## Submission checklist

- [ ] Updated legal/support site deployed and the four URLs visually verified.
- [x] Baseline production iOS archive succeeds on Xcode 26 / iOS 26 SDK.
- [ ] The next successful replacement build contains the final collected-data manifest and is uploaded to TestFlight.
- [ ] Bundle ID `kr.moveto.litechat`, version/build and APNs capability confirmed in the signed archive.
- [ ] Demo account and reviewer contact entered.
- [ ] Privacy answers entered from the worksheet and legally confirmed.
- [ ] Age rating, content rights, export compliance, availability, pricing and copyright entered by owner.
- [ ] iPhone/iPad screenshots uploaded; icon has no processing warning.
- [ ] TestFlight smoke test covers login, photo denial/allow, notifications, report/block, deletion and relaunch.
- [ ] Build selected and manually submitted for App Review; do not auto-release without owner instruction.
