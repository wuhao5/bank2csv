import { describe, it, expect } from 'vitest';
import { matchesDocHints } from '../src/ingestors/rule-based/base.js';
import { TargetRedCardParser } from '../src/ingestors/rule-based/parsers/target-redcard.js';
import { mockTargetRedCardDocument } from './fixtures/mock-documents.js';

describe('TargetRedCardParser', () => {
  const parser = new TargetRedCardParser();

  it('matches stringHints for Target RedCard statements', () => {
    expect(matchesDocHints(mockTargetRedCardDocument, parser.stringHints)).toBe(true);
  });

  it('correctly parses Target RedCard credit card statement and reconciles balances with 0 discrepancy', () => {
    const statement = parser.parse(mockTargetRedCardDocument);
    expect(statement.institution).toBe('TD Bank USA, N.A. (Target RedCard)');
    expect(statement.statementDate).toBe('2026-07-16');
    expect(statement.periodEnd).toBe('2026-07-16');
    expect(statement.accounts).toHaveLength(1);

    const card = statement.accounts[0];
    expect(card.accountName).toBe('Target RedCard');
    expect(card.accountNumberMasked).toBe('...1234');
    expect(card.accountType).toBe('CREDIT_CARD');
    expect(card.openingBalance).toBe(100.0);
    expect(card.closingBalance).toBe(150.0);
    expect(card.transactions).toHaveLength(3);

    // Payment (Credit)
    expect(card.transactions[0]).toMatchObject({
      date: '2026-06-20',
      description: 'E-PAYMENT,TARGET.COM',
      amount: 100.0,
      type: 'CREDIT'
    });

    // Purchase 1 (Debit)
    expect(card.transactions[1]).toMatchObject({
      date: '2026-06-25',
      description: 'TARGET STORE 0001 SUNNYVALE,CA',
      amount: -100.0,
      type: 'DEBIT'
    });

    // Purchase 2 (Debit)
    expect(card.transactions[2]).toMatchObject({
      date: '2026-07-02',
      description: 'TARGET STORE 0002 MOUNTAINVIEW,CA',
      amount: -50.0,
      type: 'DEBIT'
    });

    // Liability reconciliation: 100 (opening) - 100 (payment) + 150 (purchases) = 150 (closing)
    expect(card.reconciliation?.isBalanced).toBe(true);
    expect(card.reconciliation?.discrepancy).toBe(0);
  });
});
