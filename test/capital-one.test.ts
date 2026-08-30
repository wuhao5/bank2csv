import { describe, it, expect } from 'vitest';
import { CapitalOneCreditCardParser } from '../src/ingestors/rule-based/parsers/capital-one.js';
import { mockCapitalOneCreditCardDocument } from './fixtures/mock-documents.js';

describe('CapitalOneCreditCardParser', () => {
  const parser = new CapitalOneCreditCardParser();

  it('canHandle returns true for Capital One credit card statements', () => {
    expect(parser.canHandle(mockCapitalOneCreditCardDocument)).toBe(true);
  });

  it('correctly parses Capital One multi-cardholder credit card statement', () => {
    const result = parser.parse(mockCapitalOneCreditCardDocument);

    expect(result.institution).toBe('Capital One, N.A.');
    expect(result.periodStart).toBe('2026-07-15');
    expect(result.periodEnd).toBe('2026-08-14');
    expect(result.accounts).toHaveLength(1);

    const account = result.accounts[0];
    expect(account.accountName).toContain('Venture X Card');
    expect(account.accountNumberMasked).toBe('...8888');
    expect(account.accountType).toBe('CREDIT_CARD');
    expect(account.openingBalance).toBe(1500.0);
    expect(account.closingBalance).toBe(2200.0);
    expect(account.transactions).toHaveLength(3);

    // 1 payment + 2 purchases
    const payments = account.transactions.filter((tx) => tx.type === 'CREDIT');
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(1500.0);
    expect(payments[0].description).toContain('ALICE SMITH #8888');

    const purchases = account.transactions.filter((tx) => tx.type === 'DEBIT');
    expect(purchases).toHaveLength(2);
    expect(purchases[0].description).toContain('ALICE SMITH #8888');
    expect(purchases[0].description).toContain('GROCERY STORE');
    expect(purchases[0].amount).toBe(-1200.0);

    const bobTxs = purchases.filter((tx) => tx.description.includes('BOB SMITH #9999'));
    expect(bobTxs).toHaveLength(1);
    expect(bobTxs[0].description).toContain('HARDWARE STORE');
    expect(bobTxs[0].amount).toBe(-1000.0);

    // Liability balance check: $1,500.00 - $1,500.00 + $2,200.00 = $2,200.00
    expect(account.reconciliation?.isBalanced).toBe(true);
    expect(account.reconciliation?.discrepancy).toBe(0);
  });
});
