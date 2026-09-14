/** macOS only: captures actual rendered SwiftUI after manual native navigation. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import sharp from 'sharp';
import { digest } from '../scripts/submission-checks';

const root = path.resolve(import.meta.dir, '..');
const language = process.env.WATCH_CAPTURE_LANGUAGE;
const udid = process.env.WATCH_SIMULATOR_UDID;
const app = process.env.WATCH_APP_PATH;
const nativeBuild = process.env.WATCH_NATIVE_BUILD;
if (process.platform !== 'darwin') throw new Error('Native Watch capture requires macOS and Xcode.');
if (!language || !['ko', 'en'].includes(language) || !udid || !app || !nativeBuild) {
  throw new Error('Set WATCH_CAPTURE_LANGUAGE=ko|en, WATCH_SIMULATOR_UDID, WATCH_APP_PATH and WATCH_NATIVE_BUILD (build ID + source revision).');
}
async function run(args: string[]) {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'inherit' });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(`Failed: ${args[0]} ${args[1]}`);
  return output;
}
const devices = JSON.parse(await run(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']));
type SimulatorDevice = { name: string; udid: string; state: string };
const entry = Object.entries(devices.devices).flatMap(([runtime, values]) =>
  (values as SimulatorDevice[]).map(device => ({ ...device, runtime }))).find(device => device.udid === udid);
if (!entry || !entry.runtime.includes('watchOS')) throw new Error('Select an available Watch simulator UDID.');
const infoPath = path.join(path.resolve(app), 'Info.plist');
const info = JSON.parse(await run(['plutil', '-convert', 'json', '-o', '-', infoPath]));
if (info.CFBundleIdentifier !== 'kr.moveto.litechat.watch' || !info.WKApplication) {
  throw new Error('WATCH_APP_PATH must be the built native LiteChat Watch .app.');
}
if (entry.state !== 'Booted') await run(['xcrun', 'simctl', 'boot', udid]);
await run(['xcrun', 'simctl', 'bootstatus', udid, '-b']);
await run(['xcrun', 'simctl', 'install', udid, path.resolve(app)]);
await run(['xcrun', 'simctl', 'launch', '--terminate-running-process', udid, info.CFBundleIdentifier,
  '-AppleLanguages', `(${language})`, '-AppleLocale', language === 'ko' ? 'ko_KR' : 'en_US']);
const input = createInterface({ input: process.stdin, output: process.stdout });
const captures = path.join(root, 'captures', language, 'watch');
const outputs = path.join(root, 'app-store', language, 'watch');
await mkdir(captures, { recursive: true });
await mkdir(outputs, { recursive: true });
try {
  for (const [name, instruction] of [
    ['01-conversations', 'Sign in with the seeded account. Show the native conversation list with both peers visible.'],
    ['02-messages', 'Open the text conversation. Show the received message, your read message, and native composer. Keep keyboard dismissed.'],
    ['03-photo', 'Return to the list and open the photo conversation. Wait for the received thumbnail to render.'],
    ['04-account', 'Return to the list, scroll to Account & Notifications, and open it. Show nickname and Allow Notifications.'],
  ]) {
    const answer = await input.question(`${instruction}\nVerify ${language} UI and no real personal data. Type capture to save ${name}: `);
    if (answer !== 'capture') throw new Error('Capture stopped before saving unreviewed screen.');
    const capture = path.join(captures, `${name}.png`);
    await run(['xcrun', 'simctl', 'io', udid, 'screenshot', '--type=png', capture]);
    const metadata = await sharp(capture).metadata();
    if (metadata.width !== 416 || metadata.height !== 496) {
      throw new Error(`Native input is ${metadata.width}×${metadata.height}. Select a 416×496 Watch simulator; do not resize.`);
    }
    const output = path.join(outputs, `${name}.png`);
    if (metadata.hasAlpha) {
      const stats = await sharp(capture).stats();
      if (!stats.isOpaque) throw new Error('Native screenshot has transparent pixels; capture an opaque simulator screen.');
      await sharp(capture).removeAlpha().png().toFile(output);
    } else {
      await copyFile(capture, output);
    }
    const capturedAt = new Date().toISOString();
    await writeFile(output + '.provenance.json', JSON.stringify({
      source: 'native', nativeBuild,
      device: `${entry.name} (${entry.runtime}; ${udid})`, capturedAt,
      capture: path.relative(root, capture),
      inputSha256: digest(await readFile(capture)), outputSha256: digest(await readFile(output)),
      bundleVersion: info.CFBundleVersion, bundleShortVersion: info.CFBundleShortVersionString,
      language,
    }, null, 2) + '\n');
    console.log(`Saved native ${language}/${name} (416×496).`);
  }
} finally { input.close(); }
