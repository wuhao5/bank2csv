import { describe, it, expect } from 'vitest';
import { MarcusBankParser } from '../src/ingestors/rule-based/parsers/marcus.js';
import { mockMarcusDocument } from './fixtures/mock-documents.js';

describe('MarcusBankParser', () => {
  const parser = new MarcusBankParser();

  it('canHandle returns true for Marcus / Goldman Sachs statements', () => {
    expect(parser.canHandle(mockMarcusDocument)).toBe(true);
  });

  it('correctly parses Marcus statement and reconciles balances with 0 discrepancy', () => {
    const statement = parser.parse(mockMarcusDocument);
    expect(statement.institution).toBe('Goldman Sachs Bank USA');
    expect(statement.periodStart).toBe('2026-04-01');
    expect(statement.periodEnd).toBe('2026-04-30');
    expect(statement.accounts).toHaveLength(1);

    const savings = statement.accounts[0];
    expect(savings.accountName).toBe('Online Savings');
    expect(savings.accountNumberMasked).toBe('...5678');
    expect(savings.accountType).toBe('SAVINGS');
    expect(savings.openingBalance).toBe(50000.0);
    expect(savings.closingBalance).toBe(49500.0);
    expect(savings.transactions).toHaveLength(2);

    // ACH Withdrawal (Debit)
    expect(savings.transactions[0]).toMatchObject({
      date: '2026-04-10',
      description: 'ACH Withdrawal CREDIT CARD PAYMENT',
      amount: -1000.0,
      type: 'DEBIT',
      runningBalance: 49000.0
    });

    // Interest Paid (Credit)
    expect(savings.transactions[1]).toMatchObject({
      date: '2026-04-30',
      description: 'Interest Paid',
      amount: 500.0,
      type: 'CREDIT',
      runningBalance: 49500.0
    });

    // 50000 + 500 - 1000 = 49500
    expect(savings.reconciliation?.isBalanced).toBe(true);
    expect(savings.reconciliation?.discrepancy).toBe(0);
  });
});
