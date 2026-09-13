import {
  boundedCiCodePoints,
  sanitizeCiRepositoryPath,
  sanitizeCiText,
} from '../ci-adapter/presentation.js';
import { CI_COMMENT_MAX_URL_BYTES } from './model.js';

const BIDI_CONTROL = /[\u202a-\u202e\u2066-\u2069]/gu;
const MARKDOWN_PUNCTUATION = /([\\`*_{}[\]()#+\-.!|~])/gu;

export function sanitizeCiCommentText(value: string, maximumBytes: number): string {
  return sanitizeCiText(value.replaceAll(BIDI_CONTROL, ''), maximumBytes);
}

export function escapeCiCommentMarkdown(value: string, maximumBytes: number): string {
  return sanitizeCiCommentText(value, maximumBytes)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(MARKDOWN_PUNCTUATION, '\\$1');
}

export function sanitizeCiCommentRepositoryPath(value: string): string | null {
  return sanitizeCiRepositoryPath(value.replaceAll(BIDI_CONTROL, ''));
}

export function normalizeCiCommentHttpsUrl(value: string): string {
  if (
    value !== value.trim() ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 32 || codePoint === 127;
    })
  ) {
    throw new TypeError('CI comment URLs must not contain whitespace or control characters.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('CI comment URLs must be absolute HTTPS URLs.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname === '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new TypeError('CI comment URLs must be credential-free absolute HTTPS URLs.');
  }
  const normalized = parsed.href;
  if (Buffer.byteLength(normalized) > CI_COMMENT_MAX_URL_BYTES) {
    throw new RangeError(`CI comment URLs must not exceed ${CI_COMMENT_MAX_URL_BYTES} bytes.`);
  }
  return normalized;
}

export function isNormalizedCiCommentHttpsUrl(value: string): boolean {
  try {
    return normalizeCiCommentHttpsUrl(value) === value;
  } catch {
    return false;
  }
}

export function boundedCiCommentText(value: string, maximumBytes: number): string {
  return boundedCiCodePoints(value, maximumBytes);
}
