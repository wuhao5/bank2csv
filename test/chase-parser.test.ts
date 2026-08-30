import { describe, it, expect } from 'vitest';
import { ChaseBankParser } from '../src/ingestors/rule-based/parsers/chase.js';
import { mockChaseCheckingDocument } from './fixtures/mock-documents.js';

describe('ChaseBankParser', () => {
  const parser = new ChaseBankParser();

  it('canHandle returns true for Chase statements', () => {
    expect(parser.canHandle(mockChaseCheckingDocument)).toBe(true);
  });

  it('correctly parses multi-account Chase statement with checking and savings', () => {
    const result = parser.parse(mockChaseCheckingDocument);

    expect(result.institution).toBe('JPMorgan Chase Bank, N.A.');
    expect(result.periodStart).toBe('2026-07-17');
    expect(result.periodEnd).toBe('2026-08-18');
    expect(result.accounts).toHaveLength(2);

    // Checking Account
    const checking = result.accounts.find((a) => a.accountName === 'Chase Total Checking');
    expect(checking).toBeDefined();
    expect(checking?.accountNumberMasked).toBe('000000123456789');
    expect(checking?.openingBalance).toBe(5000.0);
    expect(checking?.closingBalance).toBe(5400.0);
    expect(checking?.transactions).toHaveLength(2);

    expect(checking?.transactions[0]).toMatchObject({
      date: '2026-07-17',
      description: 'SAMPLE EMPLOYER PAYROLL',
      amount: 200.0,
      type: 'CREDIT',
      runningBalance: 5200.0
    });

    expect(checking?.reconciliation?.isBalanced).toBe(true);
    expect(checking?.reconciliation?.discrepancy).toBe(0);

    // Savings Account
    const savings = result.accounts.find((a) => a.accountName === 'Chase Savings');
    expect(savings).toBeDefined();
    expect(savings?.accountNumberMasked).toBe('000000987654321');
    expect(savings?.openingBalance).toBe(1000.0);
    expect(savings?.closingBalance).toBe(1000.0);
    expect(savings?.reconciliation?.isBalanced).toBe(true);
  });
});
