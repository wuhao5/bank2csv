import { stringify } from 'csv-stringify/sync';
import type { BankStatement, CsvPreset } from '../core/types.js';
import { getFormatter } from './presets.js';

/**
 * Converts all accounts in a bank statement into a single unified CSV string.
 */
export function exportToUnifiedCsv(statement: BankStatement, preset: CsvPreset = 'standard'): string {
  const formatter = getFormatter(preset);
  const rows: (string | number)[][] = [formatter.headers];

  for (const account of statement.accounts) {
    for (const tx of account.transactions) {
      rows.push(formatter.formatRow(tx, account, statement.institution));
    }
  }

  return stringify(rows);
}
