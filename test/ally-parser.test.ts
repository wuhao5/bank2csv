import { describe, it, expect } from 'vitest';
import { AllyBankParser } from '../src/ingestors/rule-based/parsers/ally.js';
import { mockAllyStatementDocument } from './fixtures/mock-documents.js';

describe('AllyBankParser', () => {
  const parser = new AllyBankParser();

  it('canHandle returns true for Ally Bank statements', () => {
    expect(parser.canHandle(mockAllyStatementDocument)).toBe(true);
  });

  it('correctly parses multi-account Ally statement with checking and savings', () => {
    const result = parser.parse(mockAllyStatementDocument);

    expect(result.institution).toBe('Ally Bank');
    expect(result.periodStart).toBe('2026-07-16');
    expect(result.periodEnd).toBe('2026-08-15');
    expect(result.statementDate).toBe('2026-08-15');
    expect(result.accounts).toHaveLength(2);

    // 1. Interest Checking Account
    const checking = result.accounts.find((a) => a.accountNumberMasked === 'xxxxxx1234');
    expect(checking).toBeDefined();
    expect(checking?.accountName).toBe('Interest Checking');
    expect(checking?.accountType).toBe('CHECKING');
    expect(checking?.openingBalance).toBe(1000.0);
    expect(checking?.closingBalance).toBe(1500.0);
    expect(checking?.transactions).toHaveLength(4);

    // Direct Deposit
    expect(checking?.transactions[0]).toMatchObject({
      date: '2026-07-20',
      description: 'Direct Deposit - EMPLOYER PAYROLL DIRECT DEPOSIT',
      amount: 1200.0,
      type: 'CREDIT',
      runningBalance: 2200.0
    });

    // ACH Withdrawal
    expect(checking?.transactions[1]).toMatchObject({
      date: '2026-07-25',
      description: 'ACH Withdrawal - ELECTRIC UTILITY BILL',
      amount: -200.5,
      type: 'DEBIT',
      runningBalance: 1999.5
    });

    // Check
    expect(checking?.transactions[2]).toMatchObject({
      date: '2026-08-01',
      description: 'Check #101',
      checkNumber: '101',
      amount: -500.0,
      type: 'DEBIT',
      runningBalance: 1499.5
    });

    // Interest Paid
    expect(checking?.transactions[3]).toMatchObject({
      date: '2026-08-15',
      description: 'Interest Paid',
      amount: 0.5,
      type: 'CREDIT',
      runningBalance: 1500.0
    });

    expect(checking?.reconciliation?.isBalanced).toBe(true);
    expect(checking?.reconciliation?.discrepancy).toBe(0);

    // 2. Online Savings Account
    const savings = result.accounts.find((a) => a.accountNumberMasked === 'xxxxxx5678');
    expect(savings).toBeDefined();
    expect(savings?.accountName).toBe('Online Savings Account');
    expect(savings?.accountType).toBe('SAVINGS');
    expect(savings?.openingBalance).toBe(10000.0);
    expect(savings?.closingBalance).toBe(12050.0);
    expect(savings?.transactions).toHaveLength(2);

    expect(savings?.transactions[0]).toMatchObject({
      date: '2026-07-18',
      description: 'ACH Deposit - EXTERNAL TRANSFER FROM MAIN CHECKING',
      amount: 2000.0,
      type: 'CREDIT',
      runningBalance: 12000.0
    });

    expect(savings?.transactions[1]).toMatchObject({
      date: '2026-08-15',
      description: 'Interest Paid',
      amount: 50.0,
      type: 'CREDIT',
      runningBalance: 12050.0
    });

    expect(savings?.reconciliation?.isBalanced).toBe(true);
    expect(savings?.reconciliation?.discrepancy).toBe(0);
  });
});

