import { describe, it, expect } from 'vitest';
import { exportToUnifiedCsv } from '../src/exporters/csv-unified.js';
import { exportToSplitCsv } from '../src/exporters/csv-split.js';
import type { BankStatement } from '../src/core/types.js';

describe('CSV Exporters', () => {
  const sampleStatement: BankStatement = {
    institution: 'Demo Bank',
    ingestor: 'rule-based',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    accounts: [
      {
        accountName: 'Main Checking',
        accountNumberMasked: '...1111',
        accountType: 'CHECKING',
        currency: 'USD',
        openingBalance: 1000,
        closingBalance: 1200,
        transactions: [
          { date: '2026-01-10', description: 'Salary', amount: 300, type: 'CREDIT' },
          { date: '2026-01-15', description: 'Coffee', amount: -100, type: 'DEBIT' }
        ]
      },
      {
        accountName: 'High Yield Savings',
        accountNumberMasked: '...2222',
        accountType: 'SAVINGS',
        currency: 'USD',
        openingBalance: 5000,
        closingBalance: 5015,
        transactions: [
          { date: '2026-01-31', description: 'Interest Payment', amount: 15, type: 'CREDIT' }
        ]
      }
    ]
  };

  it('exports unified CSV containing all accounts', () => {
    const csv = exportToUnifiedCsv(sampleStatement, 'standard');
    expect(csv).toContain('Date,Institution,Account Name,Account Number,Description,Amount,Type,Balance,Check Number,Category');
    expect(csv).toContain('2026-01-10,Demo Bank,Main Checking,...1111,Salary,300.00,CREDIT');
    expect(csv).toContain('2026-01-31,Demo Bank,High Yield Savings,...2222,Interest Payment,15.00,CREDIT');
  });

  it('exports split CSVs per account', () => {
    const split = exportToSplitCsv(sampleStatement, 'standard');
    expect(split).toHaveLength(2);
    expect(split[0].accountName).toBe('Main Checking');
    expect(split[0].suggestedFilename).toContain('main_checking_1111.csv');
    expect(split[0].csvContent).toContain('Salary,300.00');
    expect(split[0].csvContent).not.toContain('Interest Payment');

    expect(split[1].accountName).toBe('High Yield Savings');
    expect(split[1].suggestedFilename).toContain('high_yield_savings_2222.csv');
    expect(split[1].csvContent).toContain('Interest Payment,15.00');
  });

  it('formats correctly with YNAB preset', () => {
    const csv = exportToUnifiedCsv(sampleStatement, 'ynab');
    expect(csv).toContain('Date,Payee,Memo,Outflow,Inflow');
    expect(csv).toContain('2026-01-10,Salary,Acc: ...1111,,300.00');
    expect(csv).toContain('2026-01-15,Coffee,Acc: ...1111,100.00,');
  });
});
