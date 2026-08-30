import { describe, it, expect } from 'vitest';
import { matchesDocHints } from '../src/ingestors/rule-based/base.js';
import { WellsFargoBankParser } from '../src/ingestors/rule-based/parsers/wells-fargo.js';
import {
  mockWellsFargoCheckingDocument,
  mockWellsFargoSavingsDocument
} from './fixtures/mock-documents.js';

describe('WellsFargoBankParser', () => {
  const parser = new WellsFargoBankParser();

  it('matches stringHints for Wells Fargo statements', () => {
    expect(matchesDocHints(mockWellsFargoCheckingDocument, parser.stringHints)).toBe(true);
    expect(matchesDocHints(mockWellsFargoSavingsDocument, parser.stringHints)).toBe(true);
  });

  it('correctly parses Wells Fargo checking statement and reconciles balances with 0 discrepancy', () => {
    const statement = parser.parse(mockWellsFargoCheckingDocument);
    expect(statement.institution).toBe('Wells Fargo Bank, N.A.');
    expect(statement.periodStart).toBe('2026-08-16');
    expect(statement.periodEnd).toBe('2026-09-16');
    expect(statement.accounts).toHaveLength(1);

    const checking = statement.accounts[0];
    expect(checking.accountName).toBe('Wells Fargo Everyday Checking');
    expect(checking.accountNumberMasked).toBe('...1234');
    expect(checking.accountType).toBe('CHECKING');
    expect(checking.openingBalance).toBe(5000.0);
    expect(checking.closingBalance).toBe(6000.0);
    expect(checking.transactions).toHaveLength(3);

    // Salary Deposit
    expect(checking.transactions[0]).toMatchObject({
      date: '2026-08-20',
      description: 'Salary Direct Deposit Payroll',
      amount: 2500.0,
      type: 'CREDIT',
      runningBalance: 7500.0
    });

    // Check
    expect(checking.transactions[1]).toMatchObject({
      date: '2026-08-25',
      description: 'Check #101',
      checkNumber: '101',
      amount: -500.0,
      type: 'DEBIT',
      runningBalance: 7000.0
    });

    // Payment
    expect(checking.transactions[2]).toMatchObject({
      date: '2026-09-05',
      description: 'Utility Payment Online',
      amount: -1000.0,
      type: 'DEBIT',
      runningBalance: 6000.0
    });

    expect(checking.reconciliation?.isBalanced).toBe(true);
    expect(checking.reconciliation?.discrepancy).toBe(0);
  });

  it('correctly parses Wells Fargo savings statement and reconciles balances with 0 discrepancy', () => {
    const statement = parser.parse(mockWellsFargoSavingsDocument);
    expect(statement.institution).toBe('Wells Fargo Bank, N.A.');
    expect(statement.periodStart).toBe('2026-01-01');
    expect(statement.periodEnd).toBe('2026-01-31');
    expect(statement.accounts).toHaveLength(1);

    const savings = statement.accounts[0];
    expect(savings.accountName).toBe('Wells Fargo Way2Save Savings');
    expect(savings.accountNumberMasked).toBe('...5678');
    expect(savings.accountType).toBe('SAVINGS');
    expect(savings.openingBalance).toBe(10000.0);
    expect(savings.closingBalance).toBe(8010.5);
    expect(savings.transactions).toHaveLength(2);

    expect(savings.reconciliation?.isBalanced).toBe(true);
    expect(savings.reconciliation?.discrepancy).toBe(0);
  });
});
