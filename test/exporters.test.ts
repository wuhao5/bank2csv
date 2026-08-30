import { describe, it, expect } from 'vitest';
import { exportToUnifiedCsv } from '../src/exporters/csv-unified.js';
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

  it('formats correctly with YNAB preset', () => {
    const csv = exportToUnifiedCsv(sampleStatement, 'ynab');
    expect(csv).toContain('Date,Payee,Memo,Outflow,Inflow');
    expect(csv).toContain('2026-01-10,Salary,Acc: ...1111,,300.00');
    expect(csv).toContain('2026-01-15,Coffee,Acc: ...1111,100.00,');
  });

  it('exports multiple statements combined into a single unified CSV', () => {
    const statement2: BankStatement = {
      institution: 'Second Bank',
      ingestor: 'rule-based',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      accounts: [
        {
          accountName: 'Credit Card',
          accountNumberMasked: '...9999',
          accountType: 'CREDIT_CARD',
          currency: 'USD',
          transactions: [
            { date: '2026-02-05', description: 'Grocery Store', amount: -75.5, type: 'DEBIT' }
          ]
        }
      ]
    };

    const combinedCsv = exportToUnifiedCsv([sampleStatement, statement2], 'standard');
    expect(combinedCsv).toContain('Date,Institution,Account Name,Account Number,Description,Amount,Type,Balance,Check Number,Category');
    expect(combinedCsv).toContain('2026-01-10,Demo Bank,Main Checking,...1111,Salary,300.00,CREDIT');
    expect(combinedCsv).toContain('2026-02-05,Second Bank,Credit Card,...9999,Grocery Store,-75.50,DEBIT');
  });

  it('streams multiple statements to file incrementally with StatementCsvWriter', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const { StatementCsvWriter } = await import('../src/exporters/csv-unified.js');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-stream-test-'));
    const testFile = path.join(tempDir, 'streamed.csv');

    const statement2: BankStatement = {
      institution: 'Second Bank',
      ingestor: 'rule-based',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      accounts: [
        {
          accountName: 'Credit Card',
          accountNumberMasked: '...9999',
          accountType: 'CREDIT_CARD',
          currency: 'USD',
          transactions: [
            { date: '2026-02-05', description: 'Grocery Store', amount: -75.5, type: 'DEBIT' }
          ]
        }
      ]
    };

    const writer = new StatementCsvWriter(testFile, 'standard');
    const count1 = writer.writeStatement(sampleStatement);
    expect(count1).toBe(3);

    const count2 = writer.writeStatement(statement2);
    expect(count2).toBe(1);

    const total = await writer.finish();
    expect(total).toBe(4);

    const content = fs.readFileSync(testFile, 'utf-8');
    expect(content).toContain('Date,Institution,Account Name,Account Number,Description,Amount,Type,Balance,Check Number,Category');
    expect(content).toContain('2026-01-10,Demo Bank,Main Checking,...1111,Salary,300.00,CREDIT');
    expect(content).toContain('2026-02-05,Second Bank,Credit Card,...9999,Grocery Store,-75.50,DEBIT');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
