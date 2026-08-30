import type { BankParser } from './base.js';
import type { BankStatement, ExtractedPdfDocument } from '../../core/types.js';
import { ChaseBankParser } from './parsers/chase.js';
import { ChaseCreditCardParser } from './parsers/chase-credit-card.js';
import { BofABankParser } from './parsers/bofa.js';
import { CapitalOneCreditCardParser } from './parsers/capital-one.js';
import { AllyBankParser } from './parsers/ally.js';
import { TargetRedCardParser } from './parsers/target-redcard.js';
import { WellsFargoBankParser } from './parsers/wells-fargo.js';
import { USBankParser } from './parsers/us-bank.js';
import { SFCUBankParser } from './parsers/sfcu.js';
import { MarcusBankParser } from './parsers/marcus.js';

export class BankRouter {
  private parsers: BankParser[] = [];

  constructor() {
    // Register built-in bank statement parsers (checking/savings and credit cards)
    // Note: Credit card parsers are checked first for card-specific statements
    this.register(new TargetRedCardParser());
    this.register(new ChaseCreditCardParser());
    this.register(new CapitalOneCreditCardParser());
    this.register(new ChaseBankParser());
    this.register(new BofABankParser());
    this.register(new AllyBankParser());
    this.register(new WellsFargoBankParser());
    this.register(new USBankParser());
    this.register(new SFCUBankParser());
    this.register(new MarcusBankParser());
  }

  /**
   * Registers a new bank-specific parser.
   */
  register(parser: BankParser): void {
    this.parsers.push(parser);
  }

  /**
   * Returns all registered parsers.
   */
  getParsers(): readonly BankParser[] {
    return this.parsers;
  }

  /**
   * Finds the matching parser for the extracted PDF document.
   */
  findMatchingParser(doc: ExtractedPdfDocument): BankParser | undefined {
    return this.parsers.find((p) => p.canHandle(doc));
  }

  /**
   * Routes the extracted document to the appropriate bank parser and returns the structured statement.
   */
  route(doc: ExtractedPdfDocument): BankStatement {
    const parser = this.findMatchingParser(doc);
    if (!parser) {
      const sampleSnippet = doc.pages[0]?.lines.slice(0, 8).join(' | ') ?? '';
      throw new Error(
        `No registered rule-based bank parser matched this document.\n` +
          `Document snippet: "${sampleSnippet}"\n\n` +
          `Options:\n` +
          `1. Run with AI direct ingestion flag (--ai) to parse via Multimodal AI.\n` +
          `2. Refer to 'src/ingestors/rule-based/GUIDE.md' to add a dedicated parser for this bank layout.`
      );
    }

    return parser.parse(doc);
  }
}

export const defaultRouter = new BankRouter();
