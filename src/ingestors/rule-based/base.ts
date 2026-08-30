import type { BankStatement, ExtractedPdfDocument } from '../../core/types.js';

export interface BankParser {
  readonly id: string;
  readonly name: string;

  /**
   * Fast signature string hints or RegExp patterns for institutional identification.
   * The router searches these hints against the document text to find matching parsers.
   */
  readonly stringHints: readonly (string | RegExp)[];

  /**
   * Parses the extracted document into a structured BankStatement domain object.
   */
  parse(doc: ExtractedPdfDocument): BankStatement;
}

/**
 * Utility helper to test whether a document matches any of the parser's string or RegExp hints.
 */
export function matchesDocHints(
  doc: ExtractedPdfDocument,
  hints: readonly (string | RegExp)[],
  precomputedUpperText?: string
): boolean {
  const fullText = doc.fullText;
  const upperText = precomputedUpperText ?? fullText.toUpperCase();

  return hints.some((hint) => {
    if (typeof hint === 'string') {
      return upperText.includes(hint.toUpperCase());
    }
    return hint.test(fullText);
  });
}
