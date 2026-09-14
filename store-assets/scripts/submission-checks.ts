import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function metadataErrors(data: unknown): string[] {
  const sections = data as Record<string, Record<string, unknown>> | null;
  const errors: string[] = [];
  for (const [section, key, limit] of [
    ['appStore', 'name', 30],
    ['appStore', 'subtitle', 30],
    ['appStore', 'promotionalText', 170],
    ['appStore', 'description', 4000],
    ['appStore', 'keywords', 100],
    ['playStore', 'name', 30],
    ['playStore', 'shortDescription', 80],
    ['playStore', 'fullDescription', 4000],
  ] as const) {
    const value = sections?.[section]?.[key];
    if (typeof value !== 'string' || !value.trim() || [...value].length > limit) {
      errors.push(`${section}.${key}: required text, maximum ${limit} characters`);
    }
  }
  return errors;
}

export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The receipt binds a reviewed native input to the composed output. It is an
 * owner attestation, not cryptographic proof that a device took a screenshot. */
export async function nativeCaptureErrors(root: string, output: string): Promise<string[]> {
  try {
    const receipt = JSON.parse(await readFile(output + '.provenance.json', 'utf8'));
    if (
      receipt.source !== 'native' ||
      !receipt.nativeBuild ||
      !receipt.device ||
      !receipt.capturedAt
    ) {
      return ['Native capture, build, device and capture date are required'];
    }
    const expectedLanguage = path.relative(root, output).split(path.sep)[1];
    if (!['ko', 'en'].includes(expectedLanguage) || receipt.language !== expectedLanguage) {
      return ['Capture language does not match listing language'];
    }
    const source = path.resolve(root, receipt.capture);
    if (!source.startsWith(path.resolve(root, 'captures') + path.sep))
      return ['Capture must be under captures/'];
    if (digest(await readFile(source)) !== receipt.inputSha256)
      return ['Capture changed after composition'];
    if (digest(await readFile(output)) !== receipt.outputSha256)
      return ['Output changed after composition'];
    return [];
  } catch {
    return ['Native capture receipt or source is missing/invalid'];
  }
}
