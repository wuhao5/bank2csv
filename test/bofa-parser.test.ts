import { describe, it, expect } from 'vitest';
import { matchesDocHints } from '../src/ingestors/rule-based/base.js';
import { BofABankParser } from '../src/ingestors/rule-based/parsers/bofa.js';
import { mockBofADocument } from './fixtures/mock-documents.js';

describe('BofABankParser', () => {
  const parser = new BofABankParser();

  it('matches stringHints for Bank of America statements', () => {
    expect(matchesDocHints(mockBofADocument, parser.stringHints)).toBe(true);
  });

  it('correctly parses Bank of America statement across sub-tables', () => {
    const result = parser.parse(mockBofADocument);

    expect(result.institution).toBe('Bank of America, N.A.');
    expect(result.periodStart).toBe('2026-07-01');
    expect(result.periodEnd).toBe('2026-07-31');
    expect(result.accounts).toHaveLength(1);

    const account = result.accounts[0];
    expect(account.accountName).toContain('Adv Plus Banking');
    expect(account.accountNumberMasked).toBe('0004 1234 5678');
    expect(account.openingBalance).toBe(10000.0);
    expect(account.closingBalance).toBe(11500.0);
    expect(account.transactions).toHaveLength(4);

    // Deposit
    const deposit = account.transactions.find((tx) => tx.type === 'CREDIT');
    expect(deposit).toBeDefined();
    expect(deposit?.amount).toBe(5000.0);
    expect(deposit?.description).toContain('SAMPLE PAYROLL DIRECT DEPOSIT');

    // Subtraction
    const utility = account.transactions.find((tx) => tx.description.includes('ELECTRIC UTILITY'));
    expect(utility).toBeDefined();
    expect(utility?.amount).toBe(-1000.0);
    expect(utility?.type).toBe('DEBIT');

    // Check
    const check = account.transactions.find((tx) => tx.checkNumber === '101');
    expect(check).toBeDefined();
    expect(check?.amount).toBe(-500.0);

    // Exact reconciliation: $10,000 + $5,000 - $3,000 - $500 = $11,500
    expect(account.reconciliation?.isBalanced).toBe(true);
    expect(account.reconciliation?.discrepancy).toBe(0);
  });
});
