import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  BankTransaction,
  ExtractedPdfDocument
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class ChaseCreditCardParser implements BankParser {
  readonly id = 'chase-credit-card-v1';
  readonly name = 'JPMorgan Chase Credit Card Parser';

  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('CHASE') || text.includes('JPMORGAN')) &&
      (text.includes('CARDHELP') ||
        text.includes('CHASE FREEDOM') ||
        text.includes('CHASE SAPPHIRE') ||
        text.includes('CHASE INK') ||
        text.includes('CHASE CARD SERVICES') ||
        text.includes('CHASE ULTIMATE REWARDS') ||
        (text.includes('OPENING/CLOSING DATE') && (text.includes('CREDIT LIMIT') || text.includes('REVOLVING CREDIT AMOUNT'))) ||
        text.includes('ACCOUNT ACTIVITY'))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract Period
    const { periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Extract Product & Account Info
    const account = this.extractAccountSummary(fullText, doc);

    // 3. Extract Transactions across all pages
    this.extractTransactions(doc, account, startYear, endYear);

    const reconciledAccounts = reconcileStatementAccounts([account]);

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
    // Pattern: "Opening/Closing Date 07/13/26 - 08/12/26"
    const periodMatch = text.match(/Opening\/Closing Date\s+(\d{2})\/(\d{2})\/(\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{2})/i);
    if (periodMatch) {
      const [, sm, sd, sy, em, ed, ey] = periodMatch;
      const startFullYear = parseInt(sy, 10) < 50 ? 2000 + parseInt(sy, 10) : 1900 + parseInt(sy, 10);
      const endFullYear = parseInt(ey, 10) < 50 ? 2000 + parseInt(ey, 10) : 1900 + parseInt(ey, 10);

      return {
        periodStart: `${startFullYear}-${sm}-${sd}`,
        periodEnd: `${endFullYear}-${em}-${ed}`,
        startYear: startFullYear,
        endYear: endFullYear
      };
    }
    return { startYear: currentYear, endYear: currentYear };
  }

  private extractAccountSummary(text: string, doc: ExtractedPdfDocument): BankAccount {
    // Product Name (e.g. "CHASE FREEDOM UNLIMITED", "CHASE INK BUSINESS", "CHASE ULTIMATE REWARDS")
    let accountName = 'Chase Credit Card';
    const prodMatch = text.match(/(CHASE\s+(?:FREEDOM|SAPPHIRE|INK|PRIME|SLATE|ULTIMATE\s+REWARDS|BUSINESS)[A-Z\s®]*)/i);
    if (prodMatch) {
      accountName = prodMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/®/g, '').trim();
    }

    // Account Number: "Account Number: XXXX XXXX XXXX 6058"
    const accMatch = text.match(/Account Number:\s*(?:[X\*\d\s]+)(\d{4})/i);
    const last4 = accMatch ? accMatch[1] : 'UNKNOWN';
    const accountNumberMasked = last4 !== 'UNKNOWN' ? `...${last4}` : 'UNKNOWN';

    // Balances
    let openingBalance: number | undefined;
    let closingBalance: number | undefined;
    let totalDeposits: number | undefined;
    let totalWithdrawals: number | undefined;

    const prevBalMatch = text.match(/Previous Balance\s+([-\$\s]*[\d,]+\.\d{2})/i);
    if (prevBalMatch) {
      openingBalance = this.parseCurrency(prevBalMatch[1]);
    }

    const newBalMatch = text.match(/New Balance\s+([-\$\s]*[\d,]+\.\d{2})/i);
    if (newBalMatch) {
      closingBalance = this.parseCurrency(newBalMatch[1]);
    }

    const payMatch = text.match(/Payment,\s*Credits\s+([-\$\s]*[\d,]+\.\d{2})/i);
    if (payMatch) {
      totalDeposits = Math.abs(this.parseCurrency(payMatch[1]));
    }

    const purMatch = text.match(/Purchases\s+([-\+\$\s]*[\d,]+\.\d{2})/i);
    if (purMatch) {
      totalWithdrawals = Math.abs(this.parseCurrency(purMatch[1]));
    }

    return {
      accountName,
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
    let inTxSection = false;
    let sectionType: 'PAYMENTS' | 'PURCHASES' | 'FEES' | 'INTEREST' = 'PURCHASES';

    for (const page of doc.pages) {
      for (const line of page.lines) {
        if (line.includes('ACCOUNT ACTIVITY') || line.includes('TRANSACTIONS')) {
          inTxSection = true;
          continue;
        }

        if (inTxSection) {
          if (line.includes('PAYMENTS AND OTHER CREDITS') || line.trim() === 'PAYMENTS') {
            sectionType = 'PAYMENTS';
            continue;
          } else if (line.includes('PURCHASE') || line.includes('PURCHASES')) {
            sectionType = 'PURCHASES';
            continue;
          } else if (line.includes('FEES CHARGED')) {
            sectionType = 'FEES';
            continue;
          } else if (line.includes('INTEREST CHARGED')) {
            sectionType = 'INTEREST';
            continue;
          }

          if (
            line.includes('Totals Year-to-Date') ||
            line.includes('INTEREST CHARGES') ||
            line.includes('Your Annual Percentage Rate') ||
            line.includes('Page 2 of 2') ||
            line.includes('Page 3 of 3')
          ) {
            inTxSection = false;
            continue;
          }

          if (
            line.startsWith('Date of') ||
            line.startsWith('Merchant Name') ||
            line.startsWith('Trans Date') ||
            line.includes('TRANSACTIONS THIS CYCLE') ||
            line.includes('INCLUDING PAYMENTS RECEIVED')
          ) {
            continue;
          }

          // Format: "07/12 99 RANCH #1772 MOUNTAIN VIEW CA 12.93"
          // Format: "08/06 AUTOMATIC PAYMENT - THANK YOU -3,337.94"
          // Format: "07/15 07/16 MERCHANT NAME 25.00"
          const txMatch = line.match(/^(\d{2}\/\d{2})(?:\s+(\d{2}\/\d{2}))?\s+(.+?)\s+([-\$\s]*[\d,]+\.\d{2})$/);
          if (txMatch) {
            const [, transDate, postDate, desc, amtStr] = txMatch;
            const [mm, dd] = transDate.split('/');
            const monthNum = parseInt(mm, 10);
            const year = monthNum >= 10 && startYear < endYear ? startYear : endYear;
            const isoDate = `${year}-${mm}-${dd}`;

            const rawAmt = Math.abs(this.parseCurrency(amtStr));
            const isPayment =
              sectionType === 'PAYMENTS' ||
              amtStr.includes('-') ||
              desc.toUpperCase().includes('AUTOMATIC PAYMENT') ||
              desc.toUpperCase().includes('PAYMENT THANK YOU') ||
              desc.toUpperCase().includes('PAYMENT - THANK YOU');

            const signedAmt = isPayment ? rawAmt : -rawAmt;

            account.transactions.push({
              date: isoDate,
              postDate: postDate ? `${year}-${postDate.replace('/', '-')}` : undefined,
              description: desc.trim(),
              rawDescription: line,
              amount: signedAmt,
              type: isPayment ? 'CREDIT' : 'DEBIT',
              category: sectionType !== 'PURCHASES' ? sectionType : undefined
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
}
