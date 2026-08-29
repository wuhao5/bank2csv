import { describe, it, expect } from 'vitest';
import { ChaseBankParser } from '../src/ingestors/rule-based/parsers/chase.js';
import type { ExtractedPdfDocument } from '../src/core/types.js';

describe('ChaseBankParser', () => {
  const createMockChaseDoc = (): ExtractedPdfDocument => {
    const pageText = `
JPMorgan Chase Bank, N.A.
CHASE TOTAL CHECKING
July 17, 2026 through August 18, 2026
Primary Account: 000000109329729
CONSOLIDATED BALANCE SUMMARY
Chase Total Checking 000000109329729 $8,075.31 $8,774.65
Chase Savings 000003591617056 $523.40 $523.40

CHECKING SUMMARY
Beginning Balance $8,075.31
Deposits and Additions 899.34
Ending Balance $8,774.65

TRANSACTION DETAIL
07/17 Direct Deposit Payroll 200.00 8,275.31
07/20 Online Transfer 600.00 8,875.31
07/25 Grocery Store -100.66 8,774.65
08/01 Coffee Shop -0.00 8,774.65
*start*post transaction detail message
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

  it('detects Chase statements correctly', () => {
    const doc = createMockChaseDoc();
    const parser = new ChaseBankParser();
    expect(parser.canHandle(doc)).toBe(true);
  });

  it('parses multi-account statement and 100% reconciles balance', () => {
    const doc = createMockChaseDoc();
    const parser = new ChaseBankParser();
    const result = parser.parse(doc);

    expect(result.institution).toBe('JPMorgan Chase Bank, N.A.');
    expect(result.periodStart).toBe('2026-07-17');
    expect(result.periodEnd).toBe('2026-08-18');
    expect(result.accounts).toHaveLength(2);

    // Account 1: Checking
    const checking = result.accounts.find((a) => a.accountType === 'CHECKING');
    expect(checking).toBeDefined();
    expect(checking?.accountName).toContain('Checking');
    expect(checking?.openingBalance).toBe(8075.31);
    expect(checking?.closingBalance).toBe(8774.65);
    expect(checking?.transactions).toHaveLength(4);

    expect(checking?.transactions[0]).toMatchObject({
      date: '2026-07-17',
      amount: 200,
      type: 'CREDIT',
      runningBalance: 8275.31
    });

    expect(checking?.reconciliation?.isBalanced).toBe(true);
    expect(checking?.reconciliation?.discrepancy).toBe(0);

    // Account 2: Savings
    const savings = result.accounts.find((a) => a.accountType === 'SAVINGS');
    expect(savings).toBeDefined();
    expect(savings?.openingBalance).toBe(523.4);
    expect(savings?.closingBalance).toBe(523.4);
    expect(savings?.transactions).toHaveLength(0);
    expect(savings?.reconciliation?.isBalanced).toBe(true);
    expect(savings?.reconciliation?.discrepancy).toBe(0);
  });
});
