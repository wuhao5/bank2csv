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

  readonly stringHints = [
    'CARDHELP',
    'CHASE FREEDOM',
    'CHASE SAPPHIRE',
    'CHASE INK',
    'CHASE CARD SERVICES',
    'CHASE ULTIMATE REWARDS',
    /CHASE[\s\S]*?OPENING\/CLOSING DATE/i
  ] as const;

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract Period
    const { periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Extract Product & Account Info
    const account = this.extractAccountSummary(fullText);

    // 3. Extract Transactions across all pages with multi-cardholder segmentation
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
    // Pattern: "Opening/Closing Date 07/04/26 - 08/03/26"
    const periodMatch = text.match(/Opening\/Closing Date\s+(\d{2})\/(\d{2})\/(\d{2,4})\s*-\s*(\d{2})\/(\d{2})\/(\d{2,4})/i);
    if (periodMatch) {
      const [, sm, sd, sy, em, ed, ey] = periodMatch;
      const startFullYear = sy.length === 2 ? 2000 + parseInt(sy, 10) : parseInt(sy, 10);
      const endFullYear = ey.length === 2 ? 2000 + parseInt(ey, 10) : parseInt(ey, 10);

      return {
        periodStart: `${startFullYear}-${sm}-${sd}`,
        periodEnd: `${endFullYear}-${em}-${ed}`,
        startYear: startFullYear,
        endYear: endFullYear
      };
    }
    return { startYear: currentYear, endYear: currentYear };
  }

  private extractAccountSummary(text: string): BankAccount {
    // Product Name (e.g. "CHASE FREEDOM UNLIMITED", "CHASE INK BUSINESS", "CHASE ULTIMATE REWARDS")
    let accountName = 'Chase Credit Card';
    const prodMatch = text.match(/(CHASE\s+(?:FREEDOM|SAPPHIRE|INK|PRIME|SLATE|ULTIMATE\s+REWARDS|BUSINESS)[A-Z\s®]*)/i);
    if (prodMatch) {
      accountName = prodMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/®/g, '').trim();
    }

    // Account Number: "Account Number: XXXX XXXX XXXX 6058"
    const accMatch = text.match(/Account Number:\s*(?:[X*\d\s]+)(\d{4})/i);
    const last4 = accMatch ? accMatch[1] : 'UNKNOWN';
    const accountNumberMasked = last4 !== 'UNKNOWN' ? `...${last4}` : 'UNKNOWN';

    // Balances
    let openingBalance: number | undefined;
    let closingBalance: number | undefined;
    let totalDeposits: number | undefined;
    let totalWithdrawals: number | undefined;

    const prevBalMatch = text.match(/Previous Balance\s+([-$s]*[\d,]+\.\d{2})/i);
    if (prevBalMatch) {
      openingBalance = this.parseCurrency(prevBalMatch[1]);
    }

    const newBalMatch = text.match(/New Balance\s+([-$s]*[\d,]+\.\d{2})/i);
    if (newBalMatch) {
      closingBalance = this.parseCurrency(newBalMatch[1]);
    }

    const payMatch = text.match(/Payment,\s*Credits\s+([-$s]*[\d,]+\.\d{2})/i);
    if (payMatch) {
      totalDeposits = Math.abs(this.parseCurrency(payMatch[1]));
    }

    const purMatch = text.match(/Purchases\s+([-+$s]*[\d,]+\.\d{2})/i);
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
    const pendingTransactions: BankTransaction[] = [];
    let previousLine = '';

    for (const page of doc.pages) {
      for (const line of page.lines) {
        // Check for Cardholder cycle end block FIRST
        // Format:
        // "CARDHOLDER NAME"
        // "TRANSACTIONS THIS CYCLE (CARD XXXX) $1234.56"
        const cardCycleMatch = line.match(/TRANSACTIONS THIS CYCLE\s*\(CARD\s*(\d{4})\)/i);
        if (cardCycleMatch) {
          const cardNum = cardCycleMatch[1];
          const cardholderName = previousLine.trim();

          for (const tx of pendingTransactions) {
            const prefix = cardholderName ? `[${cardholderName} #${cardNum}] ` : `[CARD #${cardNum}] `;
            tx.description = `${prefix}${tx.description}`;
            tx.category = `Cardholder: ${cardholderName || 'Card'} #${cardNum}`;
          }

          account.transactions.push(...pendingTransactions);
          pendingTransactions.length = 0;
          previousLine = line;
          continue;
        }

        if (line.includes('ACCOUNT ACTIVITY') || line.trim() === 'TRANSACTIONS') {
          inTxSection = true;
          previousLine = line;
          continue;
        }

        if (inTxSection) {
          if (line.includes('PAYMENTS AND OTHER CREDITS') || line.trim() === 'PAYMENTS') {
            sectionType = 'PAYMENTS';
            previousLine = line;
            continue;
          } else if (line.includes('PURCHASE') || line.includes('PURCHASES')) {
            sectionType = 'PURCHASES';
            previousLine = line;
            continue;
          } else if (line.includes('FEES CHARGED')) {
            sectionType = 'FEES';
            previousLine = line;
            continue;
          } else if (line.includes('INTEREST CHARGED')) {
            sectionType = 'INTEREST';
            previousLine = line;
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
            previousLine = line;
            continue;
          }

          if (
            line.startsWith('Date of') ||
            line.startsWith('Merchant Name') ||
            line.startsWith('Trans Date') ||
            line.includes('INCLUDING PAYMENTS RECEIVED')
          ) {
            previousLine = line;
            continue;
          }

          // Format: "MM/DD MERCHANT NAME AMOUNT"
          // Format: "MM/DD AUTOMATIC PAYMENT - THANK YOU -123.45"
          // Format: "MM/DD MM/DD MERCHANT NAME AMOUNT"
          const txMatch = line.match(/^(\d{2}\/\d{2})(?:\s+(\d{2}\/\d{2}))?\s+(.+?)\s+([-$s]*[\d,]+\.\d{2})$/);
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

            pendingTransactions.push({
              date: isoDate,
              postDate: postDate ? `${year}-${postDate.replace('/', '-')}` : undefined,
              description: desc.trim(),
              rawDescription: line,
              amount: signedAmt,
              type: isPayment ? 'CREDIT' : 'DEBIT',
              category: sectionType !== 'PURCHASES' ? sectionType : undefined
            });
          }

          previousLine = line;
        }
      }
    }

    // Push any remaining transactions (e.g. for personal cards without sub-account summaries)
    if (pendingTransactions.length > 0) {
      account.transactions.push(...pendingTransactions);
    }
  }

  private parseCurrency(val: string): number {
    const isNegative = val.includes('-') || val.startsWith('(');
    const cleaned = val.replace(/[$(),\s+-]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNegative ? -num : num;
  }
}
