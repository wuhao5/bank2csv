import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  BankTransaction,
  ExtractedPdfDocument
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class TargetRedCardParser implements BankParser {
  readonly id = 'target-redcard-v1';
  readonly name = 'Target RedCard Credit Card Statement Parser';

  /**
   * Signature detection matching Target RedCard statements.
   */
  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('REDCARD') ||
        text.includes('TARGET CARD SERVICES') ||
        text.includes('TARGET.COM/MYREDCARD')) &&
      (text.includes('TD BANK USA') ||
        text.includes('SUMMARYOFACCOUNTACTIVITY') ||
        text.includes('SUMMARY OF ACCOUNT ACTIVITY') ||
        text.includes('MANAGE MY REDCARD') ||
        text.includes('MANAGEMYREDCARD'))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract period
    const { statementDate, periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Extract account summary & transactions
    const account = this.extractAccountSummary(fullText);
    this.extractTransactions(doc, account, startYear, endYear);

    // 3. Reconcile
    const reconciledAccounts = reconcileStatementAccounts([account]);

    return {
      institution: 'TD Bank USA, N.A. (Target RedCard)',
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

    // Pattern 1: "StatementClosingDate: July16,2023" or "StatementClosingDate: July 16, 2023"
    const closeDateMatch = text.match(
      /StatementClosingDate\s*[:]?\s*([A-Za-z]+)\s*(\d{1,2}),?\s*(\d{4})/i
    );
    if (closeDateMatch) {
      const [, mStr, dStr, yStr] = closeDateMatch;
      const mm = this.monthNameToNumber(mStr);
      const dd = dStr.padStart(2, '0');
      const yyyy = parseInt(yStr, 10);
      statementDate = `${yyyy}-${mm}-${dd}`;
      periodEnd = statementDate;
      endYear = yyyy;
      startYear = yyyy;
    } else {
      // Pattern 2: "StatementClosingDate 7/16/2023"
      const slashMatch = text.match(/StatementClosingDate\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
      if (slashMatch) {
        const [, mm, dd, yyyy] = slashMatch;
        statementDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
        periodEnd = statementDate;
        endYear = parseInt(yyyy, 10);
        startYear = endYear;
      }
    }

    // Infer periodStart if Days in Billing Cycle is known
    const daysMatch = text.match(/Days(?:in|\s+in\s+)BillingCycle\s+(\d+)/i);
    if (daysMatch && statementDate) {
      const days = parseInt(daysMatch[1], 10);
      const endDate = new Date(statementDate);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days + 1);
      periodStart = startDate.toISOString().split('T')[0];
      startYear = startDate.getFullYear();
    }

    return { statementDate, periodStart, periodEnd, startYear, endYear };
  }

  private extractAccountSummary(text: string): BankAccount {
    // Card Ending in
    const cardMatch =
      text.match(/RedCardEndingin\s*[:]?\s*(\d{4})/i) ||
      text.match(/AccountNumberEndingin\s*(\d{4})/i) ||
      text.match(/AccountIdentificationNumber\s*[:]?\s*(\d+)/i);

    const last4 = cardMatch ? cardMatch[1].slice(-4) : 'UNKNOWN';
    const accountNumberMasked = last4 !== 'UNKNOWN' ? `...${last4}` : 'UNKNOWN';

    // Balances & totals
    let openingBalance: number | undefined;
    let closingBalance: number | undefined;
    let totalDeposits: number | undefined;
    let totalWithdrawals: number | undefined;

    const prevBalMatch = text.match(/PreviousBalance\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
    if (prevBalMatch) {
      openingBalance = this.parseCurrency(prevBalMatch[1]);
    }

    const newBalMatch = text.match(/NewBalance\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
    if (newBalMatch) {
      closingBalance = this.parseCurrency(newBalMatch[1]);
    }

    const payMatch = text.match(/PaymentsandOtherCredits\s+([-$s]*[\d,]+\.\d{2})/i);
    if (payMatch) {
      totalDeposits = Math.abs(this.parseCurrency(payMatch[1]));
    }

    const purMatch = text.match(/PurchasesandOtherDebits\s+([-+$s]*[\d,]+\.\d{2})/i);
    if (purMatch) {
      totalWithdrawals = Math.abs(this.parseCurrency(purMatch[1]));
    }

    return {
      accountName: 'Target RedCard',
      accountNumberMasked,
      accountType: 'CREDIT_CARD',
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
    let currentSection: 'PAYMENTS' | 'PURCHASES' | null = null;
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

        if (
          line.includes('PaymentsAndOtherCredits') ||
          line.includes('Payments And Other Credits') ||
          line.includes('Payments and Other Credits')
        ) {
          flushPending();
          currentSection = 'PAYMENTS';
          continue;
        }

        if (
          line.includes('PurchasesAndOtherDebits') ||
          line.includes('Purchases And Other Debits') ||
          line.includes('Purchases and Other Debits')
        ) {
          flushPending();
          currentSection = 'PURCHASES';
          continue;
        }

        if (
          line.includes('TOTALPAYMENTS') ||
          line.includes('TOTALPURCHASES') ||
          line.includes('TotalsYear-to-Date') ||
          line.includes('InterestChargeCalculation') ||
          line.includes('NOTICE:SEE') ||
          line.includes('INCLUDETHISPORTION') ||
          line.includes('BILLING RIGHTS SUMMARY')
        ) {
          flushPending();
          currentSection = null;
          continue;
        }

        if (
          line.startsWith('TransDate Description') ||
          line.startsWith('TransDate') ||
          line.startsWith('Transactions')
        ) {
          continue;
        }

        if (currentSection) {
          // Date format: "Jun.18", "Jun. 18", "Jun 18", "06/18"
          const txMatch = line.match(
            /^([A-Za-z]{3,4}\.?\s*\d{1,2}|\d{1,2}\/\d{1,2})\s+(.+?)\s+([-$+]?\s*\$?\s*[\d,]+\.\d{2})$/
          );

          if (txMatch) {
            flushPending();
            const [, dStr, desc, amtStr] = txMatch;
            const isoDate = this.formatDate(dStr, startYear, endYear);

            const rawAmt = Math.abs(this.parseCurrency(amtStr));
            // In Target RedCard: Payments are CREDIT (positive), Purchases are DEBIT (negative)
            const isPayment = currentSection === 'PAYMENTS' || amtStr.includes('-');
            const amount = isPayment ? rawAmt : -rawAmt;

            pendingTx = {
              date: isoDate,
              description: desc.trim(),
              rawDescription: line,
              amount,
              type: isPayment ? 'CREDIT' : 'DEBIT',
              category: currentSection === 'PAYMENTS' ? 'Payments and Credits' : 'Purchases'
            };
            pendingDescLines = [];
            continue;
          }

          // Continuation line
          if (pendingTx) {
            if (
              !line.startsWith('RedCardEndingin') &&
              !line.startsWith('AccountIdentification') &&
              !line.startsWith('Page') &&
              !line.startsWith('*00000*')
            ) {
              pendingDescLines.push(line.trim());
            }
          }
        }
      }
      flushPending();
    }
  }

  private formatDate(dStr: string, startYear: number, endYear: number): string {
    // If MM/DD format
    if (dStr.includes('/')) {
      const [mm, dd] = dStr.split('/');
      const month = parseInt(mm, 10);
      const year = month >= 10 && startYear < endYear ? startYear : endYear;
      return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }

    // Format like "Jun.18" or "Jul.1" or "Jun 18"
    const cleaned = dStr.replace('.', '').trim();
    const parts = cleaned.match(/^([A-Za-z]+)\s*(\d+)$/);
    if (parts) {
      const [, mName, day] = parts;
      const mm = this.monthNameToNumber(mName);
      const month = parseInt(mm, 10);
      const year = month >= 10 && startYear < endYear ? startYear : endYear;
      return `${year}-${mm}-${day.padStart(2, '0')}`;
    }

    return `${endYear}-01-01`;
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
      july: '07',
      june: '06',
      august: '08',
      september: '09'
    };
    return months[name.toLowerCase()] || '01';
  }
}
