import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  BankTransaction,
  ExtractedPdfDocument,
  AccountType
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class USBankParser implements BankParser {
  readonly id = 'us-bank-v1';
  readonly name = 'U.S. Bank Statement Parser';

  /**
   * Signature detection matching U.S. Bank statements.
   */
  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('U.S. BANK') || text.includes('USBANK.COM') || text.includes('US BANK')) &&
      (text.includes('UNI- STATEMENT') ||
        text.includes('UNI-STATEMENT') ||
        text.includes('PLATINUM CHECKING') ||
        text.includes('U.S. BANK NATIONAL ASSOCIATION') ||
        text.includes('BALANCE YOUR ACCOUNT') ||
        text.includes('WEALTH MANAGEMENT'))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract period
    const { statementDate, periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Extract accounts and transactions
    const accounts = this.extractAccounts(doc, startYear, endYear);

    // 3. Reconcile
    const reconciledAccounts = reconcileStatementAccounts(accounts);

    return {
      institution: 'U.S. Bank National Association',
      ingestor: 'rule-based',
      parserId: this.id,
      statementDate,
      periodStart,
      periodEnd,
      accounts: reconciledAccounts
    };
  }

  private extractPeriod(text: string): {
    statementDate?: string;
    periodStart?: string;
    periodEnd?: string;
    startYear: number;
    endYear: number;
  } {
    const currentYear = new Date().getFullYear();
    let statementDate: string | undefined;
    let periodStart: string | undefined;
    let periodEnd: string | undefined;
    let startYear = currentYear;
    let endYear = currentYear;

    // Pattern: "Statement Period : Jan 14, 2022 through Feb 11, 2022"
    const periodMatch = text.match(
      /Statement Period\s*:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})[\s\S]*?through[\s\S]*?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i
    );

    if (periodMatch) {
      const [, smStr, sd, sy, emStr, ed, ey] = periodMatch;
      const startM = this.monthNameToNumber(smStr);
      const endM = this.monthNameToNumber(emStr);
      const startYearNum = parseInt(sy, 10);
      const endYearNum = parseInt(ey, 10);

      periodStart = `${startYearNum}-${startM.padStart(2, '0')}-${sd.padStart(2, '0')}`;
      periodEnd = `${endYearNum}-${endM.padStart(2, '0')}-${ed.padStart(2, '0')}`;
      statementDate = periodEnd;
      startYear = startYearNum;
      endYear = endYearNum;
    }

    return { statementDate, periodStart, periodEnd, startYear, endYear };
  }

  private extractAccounts(
    doc: ExtractedPdfDocument,
    startYear: number,
    endYear: number
  ): BankAccount[] {
    const fullText = doc.fullText;

    // Product Name
    let accountName = 'U.S. Bank Checking';
    const prodMatch = fullText.match(/(U\.S\.\s*BANK\s+[A-Za-z\s]+?(?:CHECKING|SAVINGS|ACCOUNT))/i);
    if (prodMatch) {
      accountName = prodMatch[1].replace(/\s+/g, ' ').trim();
    }

    const isSavings = accountName.toLowerCase().includes('savings');
    const isChecking = accountName.toLowerCase().includes('checking');
    const accountType: AccountType = isSavings ? 'SAVINGS' : isChecking ? 'CHECKING' : 'OTHER';

    // Account Number
    const accMatch =
      fullText.match(/Account Number\s+([0-9-]+)/i) ||
      fullText.match(/Account Number[:\s]+(\d[\d\s-]{6,20}\d)/i);
    const rawAccNum = accMatch ? accMatch[1].replace(/[\s-]/g, '').trim() : 'UNKNOWN';
    const accountNumberMasked =
      rawAccNum.length > 4 ? `...${rawAccNum.slice(-4)}` : rawAccNum;

    // Balances
    let openingBalance: number | undefined;
    let closingBalance: number | undefined;
    let totalDeposits: number | undefined;
    let totalWithdrawals: number | undefined;

    const beginMatch = fullText.match(/Beginning Balance on\s+[A-Za-z]+\s+\d+\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
    if (beginMatch) {
      openingBalance = this.parseCurrency(beginMatch[1]);
    }

    const endMatch = fullText.match(/Ending Balance on\s+[A-Za-z]+\s+\d+,\s*\d{4}\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
    if (endMatch) {
      closingBalance = this.parseCurrency(endMatch[1]);
    }

    const depMatch = fullText.match(/Deposits\s*\/\s*Credits\s+([-$s]*[\d,]+\.\d{2})/i);
    if (depMatch) {
      totalDeposits = Math.abs(this.parseCurrency(depMatch[1]));
    }

    const wdlMatch = fullText.match(/(?:Other\s+)?Withdrawals\s+([-$s]*[\d,]+\.\d{2}\s*-?)/i);
    if (wdlMatch) {
      totalWithdrawals = Math.abs(this.parseCurrency(wdlMatch[1]));
    }

    const account: BankAccount = {
      accountName,
      accountNumberMasked,
      accountType,
      currency: 'USD',
      openingBalance,
      closingBalance,
      totalDeposits,
      totalWithdrawals,
      transactions: []
    };

    // Extract Transactions
    this.extractTransactions(doc, account, startYear, endYear);

    return [account];
  }

  private extractTransactions(
    doc: ExtractedPdfDocument,
    account: BankAccount,
    startYear: number,
    endYear: number
  ): void {
    let currentSection: 'CREDITS' | 'DEBITS' | null = null;
    let pendingTx: BankTransaction | null = null;
    let pendingDescLines: string[] = [];

    const flushPending = () => {
      if (pendingTx) {
        if (pendingDescLines.length > 0) {
          const extraDesc = pendingDescLines.join(' ').trim();
          pendingTx.rawDescription = `${pendingTx.description} ${extraDesc}`.trim();
          pendingTx.description = `${pendingTx.description} ${extraDesc}`.trim();
        }
        account.transactions.push(pendingTx);
        pendingTx = null;
        pendingDescLines = [];
      }
    };

    for (const page of doc.pages) {
      const lines = page.lines;

      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const line = lines[lIdx];

        // Section start detectors
        if (
          (line.includes('Deposits / Credits') ||
            line.includes('Customer Deposits') ||
            line.includes('Other Deposits') ||
            line.includes('Electronic Deposits')) &&
          !line.includes('Total')
        ) {
          flushPending();
          currentSection = 'CREDITS';
          continue;
        }

        if (
          (line.includes('Other Withdrawals') ||
            line.includes('Electronic Withdrawals') ||
            line.includes('Card Transactions') ||
            line.includes('Checks Presented') ||
            line.includes('Customer Withdrawals')) &&
          !line.includes('Total')
        ) {
          flushPending();
          currentSection = 'DEBITS';
          continue;
        }

        // Section end detectors
        if (
          line.startsWith('Total Deposits') ||
          line.startsWith('Total Other Withdrawals') ||
          line.startsWith('Total Withdrawals') ||
          line.startsWith('Balance Summary') ||
          line.startsWith('Balances only appear') ||
          line.startsWith('BALANCE YOUR ACCOUNT') ||
          line.startsWith('IMPORTANT DISCLOSURES') ||
          line.startsWith('This page intentionally left blank')
        ) {
          flushPending();
          currentSection = null;
          continue;
        }

        if (
          line.startsWith('Date Description of Transaction') ||
          line.startsWith('Date Description Ref Number')
        ) {
          continue;
        }

        if (currentSection) {
          // Transaction Line Match: "Jan 21 Mobile Banking Transfer ... $ 50,000.00"
          const txMatch = line.match(
            /^([A-Za-z]{3})\s+(\d{1,2})\s+(.+?)\s+([$]?\s*[\d,]+\.\d{2}\s*-?)$/
          );

          if (txMatch) {
            flushPending();
            const [, mStr, dStr, desc, amtStr] = txMatch;
            const month = this.monthNameToNumber(mStr);
            const monthNum = parseInt(month, 10);
            const year = monthNum >= 10 && startYear < endYear ? startYear : endYear;
            const isoDate = `${year}-${month.padStart(2, '0')}-${dStr.padStart(2, '0')}`;

            const rawAmt = Math.abs(this.parseCurrency(amtStr));
            const amount = currentSection === 'CREDITS' ? rawAmt : -rawAmt;

            // Check if check number
            let checkNumber: string | undefined;
            const chkMatch = desc.match(/Check\s+(?:Number\s+)?(\d+)/i);
            if (chkMatch) {
              checkNumber = chkMatch[1];
            }

            pendingTx = {
              date: isoDate,
              description: desc.trim(),
              rawDescription: line,
              amount,
              type: amount >= 0 ? 'CREDIT' : 'DEBIT',
              checkNumber
            };
            pendingDescLines = [];
            continue;
          }

          // Continuation line
          if (pendingTx) {
            if (
              !line.startsWith('Page ') &&
              !line.startsWith('U.S. BANK') &&
              !line.startsWith('Account Number') &&
              !line.startsWith('Statement Period') &&
              !line.startsWith('Number of Days') &&
              !line.startsWith('Ending Balance on')
            ) {
              pendingDescLines.push(line.trim());
            }
          }
        }
      }
      flushPending();
    }
  }

  private parseCurrency(val: string): number {
    const isNegative = val.includes('-') || val.startsWith('(');
    const cleaned = val.replace(/[$(),\s+-]/g, '').trim();
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
      may_full: '05',
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
