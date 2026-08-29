import { describe, it, expect } from 'vitest';
import { reconcileAccount } from '../src/core/reconciler.js';
import type { BankAccount } from '../src/core/types.js';

describe('Reconciler Engine', () => {
  it('correctly validates a balanced account with exact cents', () => {
    const acc: BankAccount = {
      accountName: 'Test Checking',
      accountNumberMasked: '...1234',
      accountType: 'CHECKING',
      currency: 'USD',
      openingBalance: 1000.0,
      closingBalance: 1150.75,
      transactions: [
        { date: '2026-01-01', description: 'Paycheck', amount: 500.0, type: 'CREDIT' },
        { date: '2026-01-02', description: 'Groceries', amount: -349.25, type: 'DEBIT' }
      ]
    };

    const recon = reconcileAccount(acc);
    expect(recon.isBalanced).toBe(true);
    expect(recon.discrepancy).toBe(0);
    expect(recon.totalCredits).toBe(500.0);
    expect(recon.totalDebits).toBe(349.25);
    expect(recon.calculatedClosingBalance).toBe(1150.75);
  });

  it('detects discrepancies when transactions are missing', () => {
    const acc: BankAccount = {
      accountName: 'Test Checking',
      accountNumberMasked: '...1234',
      accountType: 'CHECKING',
      currency: 'USD',
      openingBalance: 1000.0,
      closingBalance: 1200.0, // Expected 1200 but only 100 deposited
      transactions: [
        { date: '2026-01-01', description: 'Deposit', amount: 100.0, type: 'CREDIT' }
      ]
    };

    const recon = reconcileAccount(acc);
    expect(recon.isBalanced).toBe(false);
    expect(recon.discrepancy).toBe(-100.0);
    expect(recon.calculatedClosingBalance).toBe(1100.0);
  });
});
