import { describe, it, expect } from 'vitest';
import { USBankParser } from '../src/ingestors/rule-based/parsers/us-bank.js';
import { mockUSBankCheckingDocument } from './fixtures/mock-documents.js';

describe('USBankParser', () => {
  const parser = new USBankParser();

  it('canHandle returns true for U.S. Bank statements', () => {
    expect(parser.canHandle(mockUSBankCheckingDocument)).toBe(true);
  });

  it('correctly parses U.S. Bank checking statement and reconciles balances with 0 discrepancy', () => {
    const statement = parser.parse(mockUSBankCheckingDocument);
    expect(statement.institution).toBe('U.S. Bank National Association');
    expect(statement.periodStart).toBe('2026-01-14');
    expect(statement.periodEnd).toBe('2026-02-11');
    expect(statement.accounts).toHaveLength(1);

    const checking = statement.accounts[0];
    expect(checking.accountName).toBe('U.S. BANK PLATINUM CHECKING');
    expect(checking.accountNumberMasked).toBe('...1234');
    expect(checking.accountType).toBe('CHECKING');
    expect(checking.openingBalance).toBe(1000.0);
    expect(checking.closingBalance).toBe(2500.5);
    expect(checking.transactions).toHaveLength(3);

    // Deposit
    expect(checking.transactions[0]).toMatchObject({
      date: '2026-01-20',
      description: 'Direct Deposit Payroll',
      amount: 3000.0,
      type: 'CREDIT'
    });

    // Interest
    expect(checking.transactions[1]).toMatchObject({
      date: '2026-02-11',
      description: 'Interest Paid 1100036838',
      amount: 0.5,
      type: 'CREDIT'
    });

    // Withdrawal with continuation
    expect(checking.transactions[2]).toMatchObject({
      date: '2026-01-25',
      description: 'Electronic Withdrawal Mortgage REF=1234567890 TRANSFER',
      amount: -1500.0,
      type: 'DEBIT'
    });

    expect(checking.reconciliation?.isBalanced).toBe(true);
    expect(checking.reconciliation?.discrepancy).toBe(0);
  });
});
