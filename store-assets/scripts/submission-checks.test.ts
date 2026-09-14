import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest, metadataErrors, nativeCaptureErrors } from './submission-checks';
import ko from '../metadata/ko.json';
import en from '../metadata/en.json';

test('both store listings fit required text limits', () => {
  expect(metadataErrors(ko)).toEqual([]);
  expect(metadataErrors(en)).toEqual([]);
  expect(
    metadataErrors({ ...en, playStore: { ...en.playStore, shortDescription: 'a'.repeat(81) } }),
  ).toHaveLength(1);
});
test('submission rejects preview, missing receipts and altered native images', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'store-check-'));
  try {
    await mkdir(path.join(root, 'captures'));
    await mkdir(path.join(root, 'app-store/en'), { recursive: true });
    const output = path.join(root, 'app-store/en/output.png');
    const capture = 'captures/input.png';
    await writeFile(path.join(root, capture), 'input');
    await writeFile(output, 'output');
    expect(await nativeCaptureErrors(root, output)).toHaveLength(1);
    const receipt = {
      source: 'browser-preview',
      language: 'en',
      nativeBuild: '1',
      device: 'test',
      capturedAt: '2026-09-12',
      capture,
      inputSha256: digest(Buffer.from('input')),
      outputSha256: digest(Buffer.from('output')),
    };
    await writeFile(output + '.provenance.json', JSON.stringify(receipt));
    expect(await nativeCaptureErrors(root, output)).toHaveLength(1);
    receipt.source = 'native';
    await writeFile(output + '.provenance.json', JSON.stringify(receipt));
    expect(await nativeCaptureErrors(root, output)).toEqual([]);
    receipt.language = 'ko';
    await writeFile(output + '.provenance.json', JSON.stringify(receipt));
    expect(await nativeCaptureErrors(root, output)).toEqual([
      'Capture language does not match listing language',
    ]);
    receipt.language = 'en';
    await writeFile(output + '.provenance.json', JSON.stringify(receipt));
    await writeFile(path.join(root, capture), 'changed');
    expect(await nativeCaptureErrors(root, output)).toEqual(['Capture changed after composition']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
