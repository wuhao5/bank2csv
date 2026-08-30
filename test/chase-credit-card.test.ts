import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { extractPdfDocument } from '../src/core/pdf-extractor.js';
import { ChaseCreditCardParser } from '../src/ingestors/rule-based/parsers/chase-credit-card.js';

describe('ChaseCreditCardParser', () => {
  const parser = new ChaseCreditCardParser();

  it('parses August statement with credit balance and 0 transactions', async () => {
    const buf = fs.readFileSync('samples/20260813-statements-8890-.pdf');
    const doc = await extractPdfDocument(buf);

    expect(parser.canHandle(doc)).toBe(true);
    const result = parser.parse(doc);

    expect(result.institution).toBe('JPMorgan Chase Bank, N.A.');
    expect(result.periodStart).toBe('2026-07-14');
    expect(result.periodEnd).toBe('2026-08-13');
    expect(result.accounts).toHaveLength(1);

    const account = result.accounts[0];
    expect(account.accountName).toContain('CHASE FREEDOM UNLIMITED');
    expect(account.accountNumberMasked).toBe('...8890');
    expect(account.accountType).toBe('CREDIT_CARD');
    expect(account.openingBalance).toBe(-83.51);
    expect(account.closingBalance).toBe(-83.51);
    expect(account.transactions).toHaveLength(0);

    expect(account.reconciliation?.isBalanced).toBe(true);
    expect(account.reconciliation?.discrepancy).toBe(0);
  });

  it('parses March statement with purchases and 100% balance reconciliation', async () => {
    const buf = fs.readFileSync('samples/20260313-statements-8890-.pdf');
    const doc = await extractPdfDocument(buf);

    expect(parser.canHandle(doc)).toBe(true);
    const result = parser.parse(doc);

    expect(result.institution).toBe('JPMorgan Chase Bank, N.A.');
    expect(result.periodStart).toBe('2026-02-14');
    expect(result.periodEnd).toBe('2026-03-13');
    expect(result.accounts).toHaveLength(1);

    const account = result.accounts[0];
    expect(account.accountName).toContain('CHASE FREEDOM UNLIMITED');
    expect(account.accountNumberMasked).toBe('...1093');
    expect(account.accountType).toBe('CREDIT_CARD');
    expect(account.openingBalance).toBe(0);
    expect(account.closingBalance).toBe(30.46);
    expect(account.transactions).toHaveLength(2);

    expect(account.transactions[0]).toMatchObject({
      date: '2026-02-20',
      description: 'FASTRAK CSC 415-486-8655 CA',
      amount: -25.0,
      type: 'DEBIT'
    });

    expect(account.transactions[1]).toMatchObject({
      date: '2026-02-28',
      description: 'CVSExtraCare 8007467287RI 800-746-7287 RI',
      amount: -5.46,
      type: 'DEBIT'
    });

    expect(account.reconciliation?.isBalanced).toBe(true);
    expect(account.reconciliation?.discrepancy).toBe(0);
    expect(account.reconciliation?.calculatedClosingBalance).toBe(30.46);
  });

  it('parses Chase Business Credit Card statement (Account 6058) with 66 transactions across multiple pages', async () => {
    const buf = fs.readFileSync('samples/20260812-statements-6058-.pdf');
    const doc = await extractPdfDocument(buf);

    expect(parser.canHandle(doc)).toBe(true);
    const result = parser.parse(doc);

    expect(result.institution).toBe('JPMorgan Chase Bank, N.A.');
    expect(result.periodStart).toBe('2026-07-13');
    expect(result.periodEnd).toBe('2026-08-12');
    expect(result.accounts).toHaveLength(1);

    const account = result.accounts[0];
    expect(account.accountNumberMasked).toBe('...6058');
    expect(account.accountType).toBe('CREDIT_CARD');
    expect(account.openingBalance).toBe(3337.94);
    expect(account.closingBalance).toBe(6772.82);

    // 66 transactions (1 payment + 65 purchases)
    expect(account.transactions).toHaveLength(66);

    // Verify payment
    const payment = account.transactions.find((tx) => tx.type === 'CREDIT');
    expect(payment).toBeDefined();
    expect(payment?.date).toBe('2026-08-06');
    expect(payment?.amount).toBe(3337.94);
    expect(payment?.description).toContain('AUTOMATIC PAYMENT - THANK YOU');

    // Verify sample purchases
    const purchases = account.transactions.filter((tx) => tx.type === 'DEBIT');
    expect(purchases).toHaveLength(65);
    expect(purchases[0]).toMatchObject({
      date: '2026-07-12',
      amount: -12.93,
      type: 'DEBIT'
    });

    // 100% balance reconciliation check: $3337.94 - $3337.94 + $6772.82 = $6772.82
    expect(account.reconciliation?.isBalanced).toBe(true);
    expect(account.reconciliation?.discrepancy).toBe(0);
    expect(account.reconciliation?.calculatedClosingBalance).toBe(6772.82);
  });
});
