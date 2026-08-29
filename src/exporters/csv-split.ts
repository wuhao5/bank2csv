import { stringify } from 'csv-stringify/sync';
import type { BankStatement, BankAccount, CsvPreset } from '../core/types.js';
import { getFormatter } from './presets.js';

export interface SplitCsvOutput {
  accountName: string;
  accountNumberMasked: string;
  suggestedFilename: string;
  csvContent: string;
}

/**
 * Converts each account in a bank statement into an individual CSV file output.
 */
export function exportToSplitCsv(statement: BankStatement, preset: CsvPreset = 'standard'): SplitCsvOutput[] {
  const formatter = getFormatter(preset);
  const results: SplitCsvOutput[] = [];

  for (const account of statement.accounts) {
    const rows: (string | number)[][] = [formatter.headers];

    for (const tx of account.transactions) {
      rows.push(formatter.formatRow(tx, account, statement.institution));
    }

    const safeName = account.accountName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const safeNum = account.accountNumberMasked.replace(/[^a-z0-9]+/g, '');
    const datePrefix = statement.periodEnd ? `${statement.periodEnd}_` : '';
    const suggestedFilename = `${datePrefix}${safeName}_${safeNum}.csv`;

    results.push({
      accountName: account.accountName,
      accountNumberMasked: account.accountNumberMasked,
      suggestedFilename,
      csvContent: stringify(rows)
    });
  }

  return results;
}
