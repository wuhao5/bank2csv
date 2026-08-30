import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  ExtractedPdfDocument
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class ChaseBankParser implements BankParser {
  readonly id = 'chase-v1';
  readonly name = 'JPMorgan Chase Consolidated Statement Parser';

  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('CHASE') || text.includes('JPMORGAN')) &&
      (text.includes('CONSOLIDATED BALANCE SUMMARY') ||
        text.includes('CHASE TOTAL CHECKING') ||
        text.includes('CHECKING SUMMARY'))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract Period
    const { periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Extract Accounts & Summaries
    const accounts = this.extractAccountsSummaryTable(fullText);

    // 3. Extract Transactions for each account
    this.extractTransactions(doc, accounts, startYear, endYear);

    // 4. Fallback account detail extraction (if consolidated summary table was absent)
    if (accounts.length === 0) {
      this.extractFallbackAccounts(fullText, accounts);
    } else {
      this.extractAccountDetails(fullText, accounts);
    }

    // 5. Reconcile Balances
    const reconciledAccounts = reconcileStatementAccounts(accounts);

    return {
      institution: 'JPMorgan Chase Bank, N.A.',
      ingestor: 'rule-based',
      parserId: this.id,
      statementDate: periodEnd,
      periodStart,
      periodEnd,
      accounts: reconciledAccounts
    };
  }

  private extractPeriod(text: string): {
    periodStart?: string;
    periodEnd?: string;
    startYear: number;
    endYear: number;
  } {
    const currentYear = new Date().getFullYear();
    // Pattern: "July 17, 2026 through August 18, 2026"
    const periodMatch = text.match(
      /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+through\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i
    );

    if (periodMatch) {
      const [, smStr, sd, sy, emStr, ed, ey] = periodMatch;
      const startM = this.monthNameToNumber(smStr);
      const endM = this.monthNameToNumber(emStr);
      const startYearNum = parseInt(sy, 10);
      const endYearNum = parseInt(ey, 10);

      return {
        periodStart: `${startYearNum}-${startM.padStart(2, '0')}-${sd.padStart(2, '0')}`,
        periodEnd: `${endYearNum}-${endM.padStart(2, '0')}-${ed.padStart(2, '0')}`,
        startYear: startYearNum,
        endYear: endYearNum
      };
    }

    return { startYear: currentYear, endYear: currentYear };
  }

  private extractAccountsSummaryTable(text: string): BankAccount[] {
    const accounts: BankAccount[] = [];

    // Regex matches rows like:
    // Chase Total Checking 000000123456789 $25,123.45 $28,456.78
    // Chase Savings 000000123456789 $5,000.00 $5,000.00
    const accountRowRegex =
      /^(Chase\s+[A-Za-z\s]+?)\s+(\d{9,17})\s+([-\$\s]*[\d,]+\.\d{2})\s+([-\$\s]*[\d,]+\.\d{2})/gim;

    let match: RegExpExecArray | null;
    while ((match = accountRowRegex.exec(text)) !== null) {
      const name = match[1].trim();
      const num = match[2].trim();
      const openBal = this.parseCurrency(match[3]);
      const closeBal = this.parseCurrency(match[4]);

      const isChecking = name.toLowerCase().includes('checking');
      const isSavings = name.toLowerCase().includes('savings');

      accounts.push({
        accountName: name,
        accountNumberMasked: num,
        accountType: isChecking ? 'CHECKING' : isSavings ? 'SAVINGS' : 'OTHER',
        currency: 'USD',
        openingBalance: openBal,
        closingBalance: closeBal,
        transactions: []
      });
    }

    return accounts;
  }

  private extractAccountDetails(text: string, accounts: BankAccount[]): void {
    const detailsRegex =
      /(?:CHECKING|SAVINGS)\s+SUMMARY[\s\S]*?Beginning Balance\s+([-\$\s]*[\d,]+\.\d{2})[\s\S]*?Ending Balance\s+([-\$\s]*[\d,]+\.\d{2})/gim;

    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = detailsRegex.exec(text)) !== null && i < accounts.length) {
      const openBal = this.parseCurrency(match[1]);
      const closeBal = this.parseCurrency(match[2]);

      // If summary table missed balances, populate from detail sections
      if (accounts[i].openingBalance === undefined) {
        accounts[i].openingBalance = openBal;
      }
      if (accounts[i].closingBalance === undefined) {
        accounts[i].closingBalance = closeBal;
      }
      i++;
    }
  }

  private extractFallbackAccounts(text: string, accounts: BankAccount[]): void {
    // If no consolidated summary, search for "Account Number: 000000123456789"
    const accNumMatch = text.match(/Account Number:\s*(\d{9,17})/i);
    const accNum = accNumMatch ? accNumMatch[1] : 'UNKNOWN';

    let openBal: number | undefined;
    let closeBal: number | undefined;

    const beginMatch = text.match(/Beginning Balance\s+([-\$\s]*[\d,]+\.\d{2})/i);
    if (beginMatch) openBal = this.parseCurrency(beginMatch[1]);

    const endMatch = text.match(/Ending Balance\s+([-\$\s]*[\d,]+\.\d{2})/i);
    if (endMatch) closeBal = this.parseCurrency(endMatch[1]);

    const isChecking = text.includes('CHECKING');
    const isSavings = text.includes('SAVINGS');

    accounts.push({
      accountName: isChecking ? 'Chase Checking' : isSavings ? 'Chase Savings' : 'Chase Account',
      accountNumberMasked: accNum,
      accountType: isChecking ? 'CHECKING' : isSavings ? 'SAVINGS' : 'OTHER',
      currency: 'USD',
      openingBalance: openBal,
      closingBalance: closeBal,
      transactions: []
    });
  }

  private extractTransactions(
    doc: ExtractedPdfDocument,
    accounts: BankAccount[],
    startYear: number,
    endYear: number
  ): void {
    let currentAccount = accounts[0];
    let inTxDetail = false;

    for (const page of doc.pages) {
      for (const line of page.lines) {
        // Detect switch to Savings or another Account Detail
        if (line.includes('CHASE SAVINGS') || line.includes('SAVINGS SUMMARY')) {
          const savings = accounts.find((a) => a.accountType === 'SAVINGS');
          if (savings) currentAccount = savings;
        } else if (line.includes('CHASE TOTAL CHECKING') || line.includes('CHECKING SUMMARY')) {
          const checking = accounts.find((a) => a.accountType === 'CHECKING');
          if (checking) currentAccount = checking;
        }

        if (line.includes('TRANSACTION DETAIL') || line.includes('DEPOSITS AND ADDITIONS')) {
          inTxDetail = true;
          continue;
        }

        if (line.includes('Ending Balance') || line.includes('Total') || line.includes('SUMMARY')) {
          if (line.startsWith('Ending Balance')) {
            inTxDetail = false;
          }
        }

        if (inTxDetail && currentAccount) {
          // Transaction Line Regex: "MM/DD DESCRIPTION AMOUNT BALANCE"
          // E.g. "07/17 SAMPLE EMPLOYER PAYROLL 200.00 5,200.00"
          const txMatch = line.match(
            /^(\d{2}\/\d{2})\s+(.+?)\s+([-\$\s]*[\d,]+\.\d{2})\s+([-\$\s]*[\d,]+\.\d{2})$/
          );

          if (txMatch) {
            const [, dateStr, desc, amtStr, balStr] = txMatch;
            const [mm, dd] = dateStr.split('/');
            const monthNum = parseInt(mm, 10);
            const year = monthNum >= 10 && startYear < endYear ? startYear : endYear;
            const isoDate = `${year}-${mm}-${dd}`;

            const amount = this.parseCurrency(amtStr);
            const runningBalance = this.parseCurrency(balStr);

            // In Chase statement, subtractions are marked with negative sign or inferred
            const isDebit = amount < 0 || desc.toLowerCase().includes('withdrawal') || desc.toLowerCase().includes('debit');

            currentAccount.transactions.push({
              date: isoDate,
              description: desc.trim(),
              rawDescription: line,
              amount,
              type: amount >= 0 ? 'CREDIT' : 'DEBIT',
              runningBalance
            });
          }
        }
      }
    }
  }

  private parseCurrency(val: string): number {
    const isNegative = val.includes('-') || val.startsWith('(');
    const cleaned = val.replace(/[\$\(\),\s\+-]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNegative ? -num : num;
  }

  private monthNameToNumber(name: string): string {
    const months: Record<string, string> = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
      january: '01',
      february: '02',
      march: '03',
      april: '04',
      june: '06',
      july: '07',
      august: '08',
      september: '09',
      october: '10',
      november: '11',
      december: '12'
    };
    return months[name.toLowerCase()] || '01';
  }
}
