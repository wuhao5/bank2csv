import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  BankTransaction,
  ExtractedPdfDocument
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class BofABankParser implements BankParser {
  readonly id = 'bofa-v1';
  readonly name = 'Bank of America Statement Parser';

  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('BANK OF AMERICA') || text.includes('BANKOFAMERICA.COM')) &&
      (text.includes('YOUR ADV PLUS BANKING') ||
        text.includes('ACCOUNT SUMMARY') ||
        text.includes('BANK DEPOSIT ACCOUNTS'))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract Statement Period
    const { periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Extract Account Summary & Balances
    const account = this.extractAccountSummary(fullText, doc);

    // 3. Extract Transactions across subtables
    this.extractTransactions(doc, account, startYear, endYear);

    const reconciledAccounts = reconcileStatementAccounts([account]);

    return {
      institution: 'Bank of America, N.A.',
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
    // Pattern: "for July 1, 2026 to July 31, 2026"
    const periodMatch = text.match(
      /for\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+to\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i
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

  private extractAccountSummary(text: string, doc: ExtractedPdfDocument): BankAccount {
    // Product Name (e.g. "Your Adv Plus Banking", "Core Checking")
    let accountName = 'Adv Plus Banking';
    const prodMatch = text.match(/Your\s+([A-Za-z0-9\s]+?Banking)/i);
    if (prodMatch) {
      accountName = prodMatch[1].trim();
    }

    // Account Number: "Account number: 0004 1234 5678"
    const accMatch = text.match(/Account number:\s*([0-9\s]+)/i);
    const accountNumberMasked = accMatch ? accMatch[1].trim() : 'UNKNOWN';

    // Balances
    let openingBalance: number | undefined;
    let closingBalance: number | undefined;
    let totalDeposits: number | undefined;
    let totalWithdrawals: number | undefined;

    const beginMatch = text.match(/Beginning balance on\s+[A-Za-z0-9,\s]+\$([-\$\s]*[\d,]+\.\d{2})/i);
    if (beginMatch) {
      openingBalance = this.parseCurrency(beginMatch[1]);
    }

    const endMatch = text.match(/Ending balance on\s+[A-Za-z0-9,\s]+\$([-\$\s]*[\d,]+\.\d{2})/i);
    if (endMatch) {
      closingBalance = this.parseCurrency(endMatch[1]);
    }

    const depMatch = text.match(/Deposits and other additions\s+([-\$\s]*[\d,]+\.\d{2})/i);
    if (depMatch) {
      totalDeposits = this.parseCurrency(depMatch[1]);
    }

    const subMatch = text.match(/Other subtractions\s+([-\$\s]*[\d,]+\.\d{2})/i);
    const checksMatch = text.match(/Checks\s+([-\$\s]*[\d,]+\.\d{2})/i);

    let totalSub = 0;
    if (subMatch) totalSub += Math.abs(this.parseCurrency(subMatch[1]));
    if (checksMatch) totalSub += Math.abs(this.parseCurrency(checksMatch[1]));
    if (totalSub > 0) totalWithdrawals = totalSub;

    return {
      accountName,
      accountNumberMasked,
      accountType: 'CHECKING',
      currency: 'USD',
      openingBalance,
      closingBalance,
      totalDeposits,
      totalWithdrawals,
      transactions: []
    };
  }

  private extractTransactions(
    doc: ExtractedPdfDocument,
    account: BankAccount,
    startYear: number,
    endYear: number
  ): void {
    type Section = 'NONE' | 'DEPOSITS' | 'SUBTRACTIONS' | 'CHECKS' | 'FEES';
    let currentSection: Section = 'NONE';

    for (const page of doc.pages) {
      let pendingDesc: string[] = [];
      let pendingTx: { date: string; amount: number; isCredit: boolean; checkNumber?: string } | null = null;

      const flushPending = () => {
        if (pendingTx) {
          account.transactions.push({
            date: pendingTx.date,
            description: pendingDesc.join(' ').trim(),
            rawDescription: pendingDesc.join(' ').trim(),
            amount: pendingTx.isCredit ? pendingTx.amount : -pendingTx.amount,
            type: pendingTx.isCredit ? 'CREDIT' : 'DEBIT',
            checkNumber: pendingTx.checkNumber,
            category: currentSection !== 'NONE' ? currentSection : undefined
          });
          pendingTx = null;
          pendingDesc = [];
        }
      };

      for (const line of page.lines) {
        // Sub-table section detection
        if (line.includes('Deposits and other additions') || line.includes('Total deposits and other additions')) {
          if (line.startsWith('Total')) {
            flushPending();
            currentSection = 'NONE';
          } else {
            flushPending();
            currentSection = 'DEPOSITS';
          }
          continue;
        }

        if (line.includes('Other subtractions') || line.includes('Total other subtractions')) {
          if (line.startsWith('Total')) {
            flushPending();
            currentSection = 'NONE';
          } else {
            flushPending();
            currentSection = 'SUBTRACTIONS';
          }
          continue;
        }

        if (line.includes('Checks') || line.includes('Total checks')) {
          if (line.startsWith('Total')) {
            flushPending();
            currentSection = 'NONE';
          } else {
            flushPending();
            currentSection = 'CHECKS';
          }
          continue;
        }

        if (line.includes('Service fees') || line.includes('Total service fees')) {
          if (line.startsWith('Total')) {
            flushPending();
            currentSection = 'NONE';
          } else {
            flushPending();
            currentSection = 'FEES';
          }
          continue;
        }

        if (currentSection === 'NONE') {
          continue;
        }

        // 1. Checks Table: "MM/DD/YY CHECK# AMOUNT"
        if (currentSection === 'CHECKS') {
          const checkMatch = line.match(/^(\d{2}\/\d{2}\/\d{2})\s+(\d+)\s+([-\$\s]*[\d,]+\.\d{2})/);
          if (checkMatch) {
            flushPending();
            const [, dStr, chkNum, amtStr] = checkMatch;
            const iso = this.formatBofADate(dStr, startYear, endYear);
            const amount = Math.abs(this.parseCurrency(amtStr));

            account.transactions.push({
              date: iso,
              description: `Check #${chkNum}`,
              rawDescription: line,
              amount: -amount,
              type: 'DEBIT',
              checkNumber: chkNum,
              category: 'CHECKS'
            });
            continue;
          }
        }

        // 2. Deposits or Subtractions Table: "MM/DD/YY DESCRIPTION AMOUNT"
        const txMatch = line.match(/^(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s+([-\$\s]*[\d,]+\.\d{2})$/);
        if (txMatch) {
          flushPending();
          const [, dStr, desc, amtStr] = txMatch;
          const iso = this.formatBofADate(dStr, startYear, endYear);
          const amount = Math.abs(this.parseCurrency(amtStr));
          const isCredit = currentSection === 'DEPOSITS';

          pendingTx = { date: iso, amount, isCredit };
          pendingDesc = [desc.trim()];
          continue;
        }

        // Multi-line description continuation
        if (pendingTx && !line.includes('Page ') && !line.includes('Bank of America')) {
          pendingDesc.push(line.trim());
        }
      }

      flushPending();
    }
  }

  private formatBofADate(dStr: string, startYear: number, endYear: number): string {
    const [mm, dd, yy] = dStr.split('/');
    const year = parseInt(yy, 10) < 50 ? 2000 + parseInt(yy, 10) : 1900 + parseInt(yy, 10);
    return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
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
