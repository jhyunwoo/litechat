# Store asset workflow

This directory contains reproducible litechat App Store and Google Play artwork. Generated listing images always use fictional Korean accounts and conversations created in a temporary database.

## Commands

From the repository root:

```sh
bun run brand:generate
bun run brand:preview
bun run store-assets:capture
bun run store-assets:compose
bun run store-assets:validate
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

Keep the same filenames. After replacement, rerun composition and validation; no script change is needed.

### iOS replacement

1. Install/run the final build on an iPhone 16 Pro Max simulator profile (1320×2868 output) and an iPad Pro 13-inch profile (2064×2752 output).
2. Populate the same fictional data on a non-production screenshot account.
3. Capture each numbered flow with Simulator's screenshot command or `xcrun simctl io booted screenshot`.
4. Save opaque JPEG/PNG inputs under `captures/ios/iphone` and `captures/ios/ipad` using the existing filenames.

Useful discovery command:

```sh
xcrun simctl list devices available
```

### Android replacement

1. Install the final internal-test build on phone 1080×1920, 7-inch 1920×1080, and 10-inch 1920×1080 emulator/device profiles.
2. Populate the same fictional data and capture the numbered flows with the system screenshot action or `adb exec-out screencap -p`.
3. Save the inputs under the matching `captures/android` directories and filenames.

Verify source dimensions before composing:

```sh
bun run store-assets:compose
bun run store-assets:validate
```

Then compare all outputs visually on a calibrated display, including Korean headline wrapping, native system bars, notification state, tablet split layout, and absence of private data.

## Fonts and licensing

`source/NotoSansKR-VF.otf` and `source/NotoColorEmoji.ttf` make Korean and emoji rendering deterministic across developer machines. Their Open Font License texts are stored alongside them. These fonts are capture/build inputs only and are not bundled into the application.
