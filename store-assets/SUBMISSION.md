# 제출 자료 / Submission handoff

한국어 문구는 `metadata/ko.md`, 영어 문구는 `metadata/en.md`에서 복사하세요. 같은 내용의 JSON은 글자 수 자동 검증용 원본입니다. 이미지 전체 목록은 `index.html`에서 확인하세요.

Copy Korean copy from `metadata/ko.md` and English copy from `metadata/en.md`. Matching JSON files are the canonical machine-validated listing data. Open `index.html` to review the artwork.

## 제작 상태 / Asset status

- Phone/tablet images are **browser previews**, rendered from the real localized Expo UI with fictional data. Native system bars, permissions and layout still require final-build verification. / 휴대폰·태블릿 이미지는 실제 Expo UI의 브라우저 미리보기이며 네이티브 검증이 남아 있습니다.
- Watch screenshots require a Mac and a built Watch app; no native Watch screenshots are included until captured. Follow `watch/README.md`. / Watch 실제 스크린샷은 Mac에서 촬영해야 합니다.
- Existing Watch release checks (signing, independent operation, physical-device notifications) remain separate prerequisites; see `../docs/apple-watch.md`. / Watch 서명·독립 실행·실기기 알림 검증은 별도입니다.
- This package does not upload or submit an app. / 이 작업은 스토어 업로드나 심사 제출을 수행하지 않습니다.

## 콘솔 입력 / Console mapping

| File field                     | App Store Connect            | Google Play Console     |
| ------------------------------ | ---------------------------- | ----------------------- |
| appStore.name / playStore.name | Name                         | App name                |
| appStore.subtitle              | Subtitle                     | —                       |
| appStore.promotionalText       | Promotional Text             | —                       |
| appStore.description           | Description (includes Watch) | —                       |
| appStore.keywords              | Keywords                     | —                       |
| playStore.shortDescription     | —                            | Short description       |
| playStore.fullDescription      | —                            | Full description        |
| reviewNotes                    | App Review Information notes | App access instructions |

Use Korean and English (U.S.) localizations. The app name stays `litechat`. No unverified pricing, encryption, speed or delivery guarantees are included. Public legal/support pages are existing Korean website pages; their translation is outside this mobile app localization change.

한국어와 영어(미국) 현지화를 사용합니다. 앱 이름은 `litechat`을 유지합니다. 공개 지원·개인정보 페이지는 기존 한국어 웹페이지이며 이번 모바일 현지화 범위에 포함되지 않습니다.

## 제출자가 입력할 사항 / Owner-supplied fields

- Working review username/password with existing conversations and received photos. Enter credentials only in the consoles' private review fields, never in this repository. / 실제 심사 계정은 콘솔 비공개 필드에 입력하세요.
- Developer legal name, address, contact details and copyright owner. / 개발자 법적 이름·주소·연락처·저작권자.
- Privacy/Data Safety, age rating, distribution countries, pricing and release settings must match the final build and actual business practices. No answers are invented here. / 개인정보·데이터 보안·연령·배포 국가·가격은 실제 서비스에 맞춰 입력하세요.
- Verify public support and privacy URLs before submission. Defaults are `https://chat.moveto.kr/support` and `https://chat.moveto.kr/privacy`, derived from app configuration. / 제출 전 링크 접근과 내용 확인.

## 네이티브 원본 교체 / Native replacement

Keep the numbered filename stems. Korean sources stay under `captures/{ios,android}/...`; English sources use `captures/en/{ios,android}/...`. PNG is preferred over JPEG. For each actual native source, create `<filename>.provenance.json`:

```json
{
  "source": "native",
  "language": "en",
  "nativeBuild": "Actual app version and build number",
  "device": "Actual simulator or device model and OS",
  "capturedAt": "Actual ISO capture timestamp"
}
```

Only attest actual native captures. Recomposition binds the input and output hashes; do not relabel browser images as native. Watch capture tooling writes its own receipts.

실제 네이티브 촬영에만 위 출처 기록을 작성하세요. 브라우저 이미지를 네이티브로 표시하지 마세요. 합성 도구는 원본·결과물 해시를 기록합니다.

```sh
bun run store-assets:compose
bun run store-assets:preview
bun run store-assets:validate
bun run store-assets:validate-submission
```

Normal validation checks artwork and copy. Submission validation additionally requires native capture receipts and all Watch files. A failure for browser previews or missing Watch captures is expected until replaced.

일반 검증은 이미지·문구 규격을 확인합니다. 제출 검증은 네이티브 출처와 Watch 파일까지 요구하므로 실제 촬영 전에는 실패하는 것이 정상입니다.

Sources / 기준: [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), [watchOS listing](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-watchos-app-information), [Google Play preview assets](https://support.google.com/googleplay/android-developer/answer/9866151).
