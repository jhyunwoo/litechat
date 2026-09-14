# Store asset workflow

This directory contains reproducible litechat App Store and Google Play artwork. Generated listing images use fictional Korean or English accounts and conversations created in a temporary database. Open `index.html` for the visual index and `SUBMISSION.md` for console field mapping and remaining native gates.

## Commands

From the repository root:

```sh
bun run brand:generate
bun run brand:preview
STORE_CAPTURE_LANGUAGE=ko bun run store-assets:capture
STORE_CAPTURE_LANGUAGE=en bun run store-assets:capture
bun run store-assets:compose
bun run store-assets:preview
bun run store-assets:validate
bun run store-assets:test
```

`STORE_CAPTURE_PROFILE` limits a capture run to comma-separated profiles, for example:

```sh
STORE_CAPTURE_PROFILE=ios/iphone,android/phone bun run store-assets:capture
```

The capture runner exports the real Expo app, starts the real server against a temporary SQLite database and memory Redis, seeds fictional users (`서윤`, `민준`, `지우`, `하린`, `도윤`, `유나`), captures the seven real feature routes, and deletes the runtime data. It never reads production user data. The deterministic landscape illustration is `source/demo-photo.svg`.

## Directory map

```text
store-assets/
  source/                 canonical raster master, licensed capture fonts, demo photo
  captures/
    ios/iphone/           1320×2868 source UI
    ios/ipad/             2064×2752 source UI
    android/phone/        1080×1920 source UI
    android/tablet-7/     1920×1080 source UI
    android/tablet-10/    1920×1080 source UI
  app-store/ko/
    iphone-6.9/           seven 1320×2868 opaque JPEGs
    ipad-13/              seven 2064×2752 opaque JPEGs
  play-store/ko/
    phone/                seven 1080×1920 opaque JPEGs
    tablet-7/             six 1920×1080 opaque JPEGs
    tablet-10/            six 1920×1080 opaque JPEGs
    feature-graphic.png   1024×500 opaque PNG
    icon-512.png          512×512 listing icon
  previews/               developer-only visual QA sheets
  scripts/                capture, composition, and validation code
```

## Capture provenance and final native gate

The checked-in captures are the actual Expo application UI and backend behavior rendered in system Chromium. This environment does not contain Xcode/iOS Simulator, `adb`, or an Android emulator, so these images are explicitly **submission previews**, not captures from a signed native build. They are not fabricated screens and contain no placeholder features, but the store owner must replace the capture inputs from the final TestFlight/internal-test binaries before upload.

Keep the same filename stems. Native PNG is preferred; JPEG is also accepted, and PNG takes precedence if both exist. After replacement, rerun composition and validation; no script change is needed.

### iOS replacement

1. Install/run the final build on an iPhone 16 Pro Max simulator profile (1320×2868 output) and an iPad Pro 13-inch profile (2064×2752 output).
2. Populate the same fictional data on a non-production screenshot account.
3. Capture each numbered flow with Simulator's screenshot command or `xcrun simctl io booted screenshot`.
4. Save opaque PNG or JPEG inputs under `captures/ios/iphone` and `captures/ios/ipad` using the existing filename stems.

Useful discovery command:

```sh
xcrun simctl list devices available
```

### Android replacement

1. Install the final internal-test build on phone 1080×1920, 7-inch 1920×1080, and 10-inch 1920×1080 emulator/device profiles.
2. Populate the same fictional data and capture the numbered flows with the system screenshot action or `adb exec-out screencap -p`.
3. Save PNG or JPEG inputs under the matching `captures/android` directories using the existing filename stems.

Verify source dimensions before composing:

```sh
bun run store-assets:compose
bun run store-assets:validate
```

Then compare all outputs visually on a calibrated display, including Korean headline wrapping, native system bars, notification state, tablet split layout, and absence of private data.

## Fonts and licensing

`source/NotoSansKR-VF.otf` and `source/NotoColorEmoji.ttf` make Korean and emoji rendering deterministic across developer machines. Their Open Font License texts are stored alongside them. These fonts are capture/build inputs only and are not bundled into the application.

## Bilingual outputs and native provenance

The composer emits both `app-store/{ko,en}` and `play-store/{ko,en}`. English source captures are under `captures/en/`; Korean paths remain compatible with the original workflow. Browser language controls the actual app UI; fixtures localize names and conversations before insertion into the temporary database. The capture runner uses Playwright's installed Chromium by default, or `PLAYWRIGHT_CHROMIUM_PATH`.

`metadata/{ko,en}.json` contains store copy, with matching Markdown for copy/paste. `previews/` contains per-device contact sheets. Apple Watch native capture prerequisites and tooling are under `watch/`.

Each newly captured browser image records `browser-preview` provenance. Composition creates receipts binding the source and output SHA-256 hashes. `bun run store-assets:validate-submission` additionally requires native capture attestations and all eight Watch screenshots. It deliberately fails while only previews exist. See `SUBMISSION.md` before replacing inputs.

The browser capture runner reserves the measured composer height because the keyboard-controller web fallback does not apply native content insets. It then scrolls to the latest message and refuses to capture if that message remains obscured. This browser-only adjustment does not modify the native application or fabricate message content.
