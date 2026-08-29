# litechat design and brand system

## Brand idea

The primary mark is the **Soft Conversation Pebble**: a calm, asymmetric companion shape with a small conversation opening inside it. The outer form reads as a friendly presence at icon size; the inner opening suggests a message and a second voice without using the familiar rectangular bubble-and-dots cliché.

Three original directions were evaluated in [`design/brand-explorations`](./design/brand-explorations): a chat pebble, two connected voices, and a friendly abstract `l`. The pebble was selected because it had the clearest silhouette at 16–24 px, remained distinctive in monochrome, and tolerated adaptive-icon crops with the least visual noise.

The identity is an original litechat design. It intentionally avoids the starburst geometry, proportions, and silhouette associated with Anthropic/Claude, as well as the signature marks of other major messaging products.

## Canonical source

- Symbol: [`brand/litechat-symbol.svg`](./brand/litechat-symbol.svg)
- Color tokens: [`brand/palette.json`](./brand/palette.json)
- Generator: [`apps/app/scripts/generate-icons.ts`](./apps/app/scripts/generate-icons.ts)
- Visual QA sheet: [`store-assets/previews/brand-contact-sheet.png`](./store-assets/previews/brand-contact-sheet.png)

The SVG is the only hand-maintained symbol geometry. Expo, Android, web, dashboard, social, and store rasters are generated from it. Do not paste or independently edit its path in product components.

## Palette

| Token      | Value     | Use                                      |
| ---------- | --------- | ---------------------------------------- |
| Cream      | `#FFF8F0` | Primary light canvas and icon background |
| Soft cream | `#F8EEE6` | Secondary surface                        |
| Clay       | `#E8785D` | Primary brand mark and warm accent       |
| Cocoa      | `#3B2823` | Primary text and dark controls           |
| Night      | `#211A19` | Dark canvas                              |
| Peach      | `#F4C5B7` | Dark-mode mark and soft supporting color |
| Lavender   | `#B7A6D9` | Restrained secondary accent and tint QA  |

Use cocoa for text on cream and cream/peach for content on night. Clay is a brand accent, not a default small-text color. Interactive combinations must preserve the existing accessible contrast and focus treatment.

## Logo behavior

- **Light mode:** clay symbol on cream or a neutral light surface.
- **Dark mode:** peach symbol on night. Do not place the clay symbol directly on night for small UI use.
- **Monochrome:** use a single solid black or white symbol with no stroke, shadow, or internal color split.
- **Minimum size:** use the full symbol down to 16 px. Below 24 px, do not add a wordmark or decorative container.
- **Clear space:** keep at least 12.5% of the symbol width clear on every side in UI lockups. App icon canvases already include their platform-safe spacing.
- **Optical alignment:** align the visible pebble, not the mathematical SVG bounds. Do not compensate with package-specific path edits.

## Platform rules

### iOS

The default icon is clay on cream, dark appearance is peach on night, and tinted appearance is an alpha-backed white silhouette for system tinting. Never bake Apple's rounded rectangle into source artwork. Keep the generated symbol scale and safe area so system masks do not crowd the mark.

### Android

The adaptive foreground uses the centered symbol at 72% of the master canvas over a separate cream background. The meaningful shape stays inside the conservative adaptive safe zone and has been checked under circle and squircle masks. The monochrome foreground is a one-color silhouette; the notification icon is a smaller white alpha mask with no background plate.

### Splash

Splash screens use a small centered mark only: clay on cream in light mode and peach on night in dark mode. They are transition surfaces, not marketing layouts.

### Web, PWA, and dashboard

Web and dashboard components use generated `brand-symbol.svg` files as CSS masks so the surrounding component controls color without duplicating geometry. Favicons use slightly larger optical scaling for 16–32 px readability. PWA maskable artwork uses cream on clay and retains the adaptive safe zone.

## Product and store expression

Product UI remains quiet and content-first: warm neutral canvases, cocoa text, generous rounded geometry, and restrained clay accents. Store artwork may use low-opacity fragments derived from the symbol plus peach/lavender fields, but the real application screen remains the focal point. Avoid glossy device mockups, neon gradients, large shadows, or ornamental logo repetition.

## Prohibited misuse

- Do not stretch, rotate, outline, or add facial features to the mark.
- Do not redraw the negative-space opening or turn it into three typing dots.
- Do not place the mark in a generic speech-bubble container.
- Do not combine it with sparkles, AI starbursts, knots, robot heads, or competitor silhouettes.
- Do not recolor individual parts of the single path.
- Do not edit generated files by hand; update the canonical SVG or palette and rerun `bun run brand:generate`.
