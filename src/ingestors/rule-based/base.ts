import type { BankStatement, ExtractedPdfDocument } from '../../core/types.js';

export interface BankParser {
  readonly id: string;
  readonly name: string;
  /**
   * Returns true if this parser can handle the provided extracted PDF document.
   */
  canHandle(doc: ExtractedPdfDocument): boolean;

  /**
   * Parses the extracted document into a structured BankStatement domain object.
   */
  parse(doc: ExtractedPdfDocument): BankStatement;
}
