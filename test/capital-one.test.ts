import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { extractPdfDocument } from '../src/core/pdf-extractor.js';
import { CapitalOneCreditCardParser } from '../src/ingestors/rule-based/parsers/capital-one.js';

describe('CapitalOneCreditCardParser', () => {
  const samplePath = 'samples/Statement_082026_4192.pdf';

  it('detects Capital One statements correctly', async () => {
    const buf = fs.readFileSync(samplePath);
    const doc = await extractPdfDocument(buf);
    const parser = new CapitalOneCreditCardParser();
    expect(parser.canHandle(doc)).toBe(true);
  });

  it('parses multi-cardholder transactions, payments, and 100% reconciles balance', async () => {
    const buf = fs.readFileSync(samplePath);
    const doc = await extractPdfDocument(buf);
    const parser = new CapitalOneCreditCardParser();
    const result = parser.parse(doc);

    expect(result.institution).toBe('Capital One, N.A.');
    expect(result.periodStart).toBe('2026-07-15');
    expect(result.periodEnd).toBe('2026-08-14');
    expect(result.accounts).toHaveLength(1);

    const account = result.accounts[0];
    expect(account.accountName).toContain('Venture X Card');
    expect(account.accountNumberMasked).toBe('...4192');
    expect(account.accountType).toBe('CREDIT_CARD');
    expect(account.openingBalance).toBe(4196.98);
    expect(account.closingBalance).toBe(4537.68);

    // 2 payments + 13 Hao Wu txs + 8 Miao Li txs = 23 total
    expect(account.transactions).toHaveLength(23);

    // Verify Payments (2 items)
    const payments = account.transactions.filter((tx) => tx.type === 'CREDIT');
    expect(payments).toHaveLength(2);
    expect(payments[0].amount).toBe(196.98);
    expect(payments[1].amount).toBe(4000.0);

    // Verify Purchases (21 items)
    const purchases = account.transactions.filter((tx) => tx.type === 'DEBIT');
    expect(purchases).toHaveLength(21);
    expect(purchases[0].amount).toBe(-2014.0);
    expect(purchases[0].description).toContain('HAO WU #4192');
    expect(purchases[0].description).toContain('MOUNTAIN VIEW TENNIS');

    // Verify Miao Li transactions
    const miaoLiTxs = purchases.filter((tx) => tx.description.includes('MIAO LI #2682'));
    expect(miaoLiTxs).toHaveLength(8);

    // Verify 100% balance reconciliation ($4,196.98 - $4,196.98 + $4,537.68 = $4,537.68)
    expect(account.reconciliation?.isBalanced).toBe(true);
    expect(account.reconciliation?.discrepancy).toBe(0);
    expect(account.reconciliation?.calculatedClosingBalance).toBe(4537.68);
  });
});
