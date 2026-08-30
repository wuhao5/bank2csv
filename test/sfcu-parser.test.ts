import { describe, it, expect } from 'vitest';
import { SFCUBankParser } from '../src/ingestors/rule-based/parsers/sfcu.js';
import { mockSFCUDocument } from './fixtures/mock-documents.js';

describe('SFCUBankParser', () => {
  const parser = new SFCUBankParser();

  it('canHandle returns true for SFCU statements', () => {
    expect(parser.canHandle(mockSFCUDocument)).toBe(true);
  });

  it('correctly parses multi-account SFCU statement (Checking and Loan) and reconciles balances with 0 discrepancy', () => {
    const statement = parser.parse(mockSFCUDocument);
    expect(statement.institution).toBe('Stanford Federal Credit Union');
    expect(statement.periodStart).toBe('2026-08-01');
    expect(statement.periodEnd).toBe('2026-08-31');
    expect(statement.accounts).toHaveLength(2);

    // 1. Basic Checking
    const checking = statement.accounts[0];
    expect(checking.accountName).toBe('Basic Checking');
    expect(checking.accountNumberMasked).toBe('...1234');
    expect(checking.accountType).toBe('CHECKING');
    expect(checking.openingBalance).toBe(2000.0);
    expect(checking.closingBalance).toBe(3000.0);
    expect(checking.transactions).toHaveLength(2);

    expect(checking.transactions[0]).toMatchObject({
      date: '2026-08-05',
      description: 'ACH Credit EMPLOYER PAYROLL',
      amount: 2000.0,
      type: 'CREDIT',
      runningBalance: 4000.0
    });

    expect(checking.transactions[1]).toMatchObject({
      date: '2026-08-10',
      description: 'Withdrawal Online Transfer',
      amount: -1000.0,
      type: 'DEBIT',
      runningBalance: 3000.0
    });

    expect(checking.reconciliation?.isBalanced).toBe(true);
    expect(checking.reconciliation?.discrepancy).toBe(0);

    // 2. Auto Loan
    const loan = statement.accounts[1];
    expect(loan.accountName).toBe('Auto Used Fixed - 2020 Model 3');
    expect(loan.accountNumberMasked).toBe('...5678');
    expect(loan.accountType).toBe('LOAN');
    expect(loan.openingBalance).toBe(20500.0);
    expect(loan.closingBalance).toBe(20000.0);
    expect(loan.transactions).toHaveLength(1);

    expect(loan.transactions[0]).toMatchObject({
      date: '2026-08-15',
      amount: 500.0,
      type: 'CREDIT',
      runningBalance: 20000.0
    });

    // Loan liability reconciliation: 20500 (opening) - 500 (principal credit) = 20000 (closing)
    expect(loan.reconciliation?.isBalanced).toBe(true);
    expect(loan.reconciliation?.discrepancy).toBe(0);
  });
});
