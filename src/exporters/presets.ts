import type { BankAccount, BankTransaction, CsvPreset } from '../core/types.js';

export interface CsvRowFormatter {
  headers: string[];
  formatRow(tx: BankTransaction, account: BankAccount, institution: string): (string | number)[];
}

export const StandardCsvFormatter: CsvRowFormatter = {
  headers: [
    'Date',
    'Institution',
    'Account Name',
    'Account Number',
    'Description',
    'Amount',
    'Type',
    'Balance',
    'Check Number',
    'Category'
  ],
  formatRow(tx, account, institution) {
    return [
      tx.date,
      institution,
      account.accountName,
      account.accountNumberMasked,
      tx.description,
      tx.amount.toFixed(2),
      tx.type,
      tx.runningBalance !== undefined ? tx.runningBalance.toFixed(2) : '',
      tx.checkNumber || '',
      tx.category || ''
    ];
  }
};

export const YnabCsvFormatter: CsvRowFormatter = {
  headers: ['Date', 'Payee', 'Memo', 'Outflow', 'Inflow'],
  formatRow(tx, account) {
    const isOutflow = tx.type === 'DEBIT' || tx.amount < 0;
    const absAmt = Math.abs(tx.amount).toFixed(2);
    return [
      tx.date,
      tx.description,
      `Acc: ${account.accountNumberMasked}${tx.checkNumber ? ' Check #' + tx.checkNumber : ''}`,
      isOutflow ? absAmt : '',
      !isOutflow ? absAmt : ''
    ];
  }
};

export const QuickBooksCsvFormatter: CsvRowFormatter = {
  headers: ['Date', 'Description', 'Card/Account', 'Amount'],
  formatRow(tx, account) {
    return [tx.date, tx.description, account.accountNumberMasked, tx.amount.toFixed(2)];
  }
};

export function getFormatter(preset: CsvPreset = 'standard'): CsvRowFormatter {
  switch (preset) {
    case 'ynab':
      return YnabCsvFormatter;
    case 'quickbooks':
      return QuickBooksCsvFormatter;
    case 'standard':
    default:
      return StandardCsvFormatter;
  }
}
