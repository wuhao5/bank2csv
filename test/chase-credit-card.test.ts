import { describe, it, expect } from 'vitest';
import { matchesDocHints } from '../src/ingestors/rule-based/base.js';
import { ChaseCreditCardParser } from '../src/ingestors/rule-based/parsers/chase-credit-card.js';
import {
  mockChaseCreditCardPersonalDocument,
  mockChaseCreditCardBusinessDocument
} from './fixtures/mock-documents.js';

describe('ChaseCreditCardParser', () => {
  const parser = new ChaseCreditCardParser();

  it('parses personal credit card statement with purchases and 100% balance reconciliation', () => {
    expect(matchesDocHints(mockChaseCreditCardPersonalDocument, parser.stringHints)).toBe(true);
    const result = parser.parse(mockChaseCreditCardPersonalDocument);

    expect(result.institution).toBe('JPMorgan Chase Bank, N.A.');
    expect(result.periodStart).toBe('2026-02-14');
    expect(result.periodEnd).toBe('2026-03-13');
    expect(result.accounts).toHaveLength(1);

    const account = result.accounts[0];
    expect(account.accountName).toContain('CHASE FREEDOM UNLIMITED');
    expect(account.accountNumberMasked).toBe('...1111');
    expect(account.accountType).toBe('CREDIT_CARD');
    expect(account.openingBalance).toBe(0);
    expect(account.closingBalance).toBe(75.5);
    expect(account.transactions).toHaveLength(2);

    expect(account.transactions[0]).toMatchObject({
      date: '2026-02-20',
      description: 'TRANSIT FARE PASS',
      amount: -25.0,
      type: 'DEBIT'
    });

    expect(account.transactions[1]).toMatchObject({
      date: '2026-02-28',
      description: 'PHARMACY STORE',
      amount: -50.5,
      type: 'DEBIT'
    });

    expect(account.reconciliation?.isBalanced).toBe(true);
    expect(account.reconciliation?.discrepancy).toBe(0);
    expect(account.reconciliation?.calculatedClosingBalance).toBe(75.5);
  });

  it('parses Chase Business Credit Card statement with multi-cardholder sub-account segmentation', () => {
    expect(matchesDocHints(mockChaseCreditCardBusinessDocument, parser.stringHints)).toBe(true);
    const result = parser.parse(mockChaseCreditCardBusinessDocument);

    expect(result.institution).toBe('JPMorgan Chase Bank, N.A.');
    expect(result.periodStart).toBe('2026-07-13');
    expect(result.periodEnd).toBe('2026-08-12');
    expect(result.accounts).toHaveLength(1);

    const account = result.accounts[0];
    expect(account.accountNumberMasked).toBe('...5555');
    expect(account.accountType).toBe('CREDIT_CARD');
    expect(account.openingBalance).toBe(2000.0);
    expect(account.closingBalance).toBe(3500.0);

    expect(account.transactions).toHaveLength(4);

    // Primary cardholder transactions
    const aliceTxs = account.transactions.filter((tx) => tx.description.includes('ALICE SMITH #5555'));
    expect(aliceTxs).toHaveLength(3);
    expect(aliceTxs[0].category).toBe('Cardholder: ALICE SMITH #5555');

    // Payment in Alice block
    const payment = aliceTxs.find((tx) => tx.type === 'CREDIT');
    expect(payment).toBeDefined();
    expect(payment?.amount).toBe(2000.0);

    // Sub-account Bob Smith transactions
    const bobTxs = account.transactions.filter((tx) => tx.description.includes('BOB SMITH #6666'));
    expect(bobTxs).toHaveLength(1);
    expect(bobTxs[0]).toMatchObject({
      date: '2026-07-22',
      amount: -1000.0,
      type: 'DEBIT',
      category: 'Cardholder: BOB SMITH #6666'
    });

    // 100% balance reconciliation check: $2,000.00 - $2,000.00 + $3,500.00 = $3,500.00
    expect(account.reconciliation?.isBalanced).toBe(true);
    expect(account.reconciliation?.discrepancy).toBe(0);
    expect(account.reconciliation?.calculatedClosingBalance).toBe(3500.0);
  });
});
