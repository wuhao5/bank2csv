import { describe, it, expect } from 'vitest';
import { BofABankParser } from '../src/ingestors/rule-based/parsers/bofa.js';
import type { ExtractedPdfDocument } from '../src/core/types.js';

describe('BofABankParser', () => {
  const createMockBofADoc = (): ExtractedPdfDocument => {
    const pageText = `
BANK OF AMERICA
ACCOUNT SUMMARY
for July 1, 2026 to July 31, 2026
Account number: 0000 1234 5678
Beginning balance on July 1, 2026 $10,000.00
Ending balance on July 31, 2026 $9,400.00

Deposits and other additions
Date Description Amount
07/02/26 ACME CORP DIRECT DEP 1,000.00
Total deposits and other additions

Withdrawals and other subtractions
Other subtractions
Date Description Amount
07/10/26 ONLINE UTILITIES PAYMENT 1,000.00
Total other subtractions

Checks
Date Check # Amount
07/15/26 101 600.00
Total checks
`;

    return {
      numPages: 1,
      fullText: pageText,
      pages: [
        {
          pageNumber: 1,
          text: pageText,
          lines: pageText.trim().split('\n'),
          items: []
        }
      ]
    };
  };

  it('detects Bank of America statements correctly', () => {
    const doc = createMockBofADoc();
    const parser = new BofABankParser();
    expect(parser.canHandle(doc)).toBe(true);
  });

  it('parses split tables, multi-line descriptions, checks, and reconciles balance', () => {
    const doc = createMockBofADoc();
    const parser = new BofABankParser();
    const result = parser.parse(doc);

    expect(result.institution).toBe('Bank of America, N.A.');
    expect(result.periodStart).toBe('2026-07-01');
    expect(result.periodEnd).toBe('2026-07-31');
    expect(result.accounts).toHaveLength(1);

    const account = result.accounts[0];
    expect(account.accountNumberMasked).toBe('0000 1234 5678');
    expect(account.openingBalance).toBe(10000.00);
    expect(account.closingBalance).toBe(9400.00);
    expect(account.transactions).toHaveLength(3);

    // Verify deposits (1 item)
    const deposits = account.transactions.filter((tx) => tx.type === 'CREDIT');
    expect(deposits).toHaveLength(1);
    expect(deposits[0].amount).toBe(1000.00);
    expect(deposits[0].date).toBe('2026-07-02');

    // Verify withdrawals (1 item)
    const withdrawals = account.transactions.filter((tx) => tx.type === 'DEBIT' && !tx.checkNumber);
    expect(withdrawals).toHaveLength(1);
    expect(withdrawals[0].amount).toBe(-1000.00);
    expect(withdrawals[0].description).toContain('ONLINE UTILITIES PAYMENT');

    // Verify checks (1 item)
    const checks = account.transactions.filter((tx) => tx.checkNumber);
    expect(checks).toHaveLength(1);
    expect(checks[0].checkNumber).toBe('101');
    expect(checks[0].amount).toBe(-600);

    // Verify 100% balance reconciliation
    expect(account.reconciliation?.isBalanced).toBe(true);
    expect(account.reconciliation?.discrepancy).toBe(0);
    expect(account.reconciliation?.calculatedClosingBalance).toBe(9400.00);
  });
});
