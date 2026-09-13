import type { CiCommentDocument } from './model.js';
import { renderCiCommentMarkdownUnchecked } from './render.js';
import { assertValidCiCommentDocument } from './validate.js';

export function renderCiCommentMarkdown(input: CiCommentDocument): string {
  return renderCiCommentMarkdownUnchecked(assertValidCiCommentDocument(input));
}
