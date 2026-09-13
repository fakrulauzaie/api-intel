import { isAbsolute } from 'node:path';

export function boundedCiCodePoints(value: string, maximumBytes: number): string {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maximumBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

export function sanitizeCiText(value: string, maximumBytes: number): string {
  const printable = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 8 ||
        (codePoint >= 11 && codePoint <= 12) ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127
        ? ' '
        : character;
    })
    .join('');
  const normalized = printable
    .replaceAll(/[\r\n\t]+/gu, ' ')
    .replaceAll(/\s{2,}/gu, ' ')
    .trim();
  return boundedCiCodePoints(normalized, maximumBytes);
}

export function escapeCiMarkdown(value: string, maximumBytes: number): string {
  return sanitizeCiText(value, maximumBytes)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('|', '\\|');
}

export function sanitizeCiRepositoryPath(value: string): string | null {
  const normalized = sanitizeCiText(value.replaceAll('\\', '/'), 1_024);
  if (
    normalized === '' ||
    isAbsolute(normalized) ||
    /^[a-z]:\//iu.test(normalized) ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    return null;
  }
  return normalized;
}
