import fs from 'fs';
import { stringify } from 'csv-stringify/sync';
import type { BankStatement, CsvPreset } from '../core/types.js';
import { getFormatter } from './presets.js';

/**
 * Extracts and formats all transaction rows for a statement according to the preset.
 */
export function formatStatementRows(
  statement: BankStatement,
  preset: CsvPreset = 'standard'
): (string | number)[][] {
  const formatter = getFormatter(preset);
  const rows: (string | number)[][] = [];

  for (const account of statement.accounts) {
    for (const tx of account.transactions) {
      rows.push(formatter.formatRow(tx, account, statement.institution));
    }
  }

  return rows;
}

/**
 * Converts one or multiple bank statements into a single unified CSV string in memory.
 */
export function exportToUnifiedCsv(
  input: BankStatement | BankStatement[],
  preset: CsvPreset = 'standard'
): string {
  const statements = Array.isArray(input) ? input : [input];
  const formatter = getFormatter(preset);
  const rows: (string | number)[][] = [formatter.headers];

  for (const statement of statements) {
    rows.push(...formatStatementRows(statement, preset));
  }

  return stringify(rows);
}

/**
 * Incremental stream writer that appends statement transactions directly to a CSV file on disk.
 */
export class StatementCsvWriter {
  private writeStream: fs.WriteStream;
  private preset: CsvPreset;
  private headerWritten: boolean = false;
  private totalTransactions: number = 0;

  constructor(filePath: string, preset: CsvPreset = 'standard') {
    this.writeStream = fs.createWriteStream(filePath, { encoding: 'utf-8' });
    this.preset = preset;
  }

  /**
   * Formats and writes all transactions from a statement to the underlying stream.
   * Emits header on the first write.
   */
  public writeStatement(statement: BankStatement): number {
    const formatter = getFormatter(this.preset);
    const rows: (string | number)[][] = [];

    if (!this.headerWritten) {
      rows.push(formatter.headers);
      this.headerWritten = true;
    }

    const txRows = formatStatementRows(statement, this.preset);
    rows.push(...txRows);

    if (rows.length > 0) {
      this.writeStream.write(stringify(rows));
    }

    const count = txRows.length;
    this.totalTransactions += count;
    return count;
  }

  /**
   * Flushes remaining buffers and closes the file stream.
   */
  public async finish(): Promise<number> {
    if (!this.headerWritten) {
      const formatter = getFormatter(this.preset);
      this.writeStream.write(stringify([formatter.headers]));
      this.headerWritten = true;
    }

    return new Promise<number>((resolve, reject) => {
      this.writeStream.on('error', reject);
      this.writeStream.on('finish', () => resolve(this.totalTransactions));
      this.writeStream.end();
    });
  }

  /**
   * Destroys the stream immediately in case of error.
   */
  public close(): void {
    this.writeStream.destroy();
  }
}
