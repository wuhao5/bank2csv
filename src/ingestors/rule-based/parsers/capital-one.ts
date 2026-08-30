import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  ExtractedPdfDocument
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class CapitalOneCreditCardParser implements BankParser {
  readonly id = 'capital-one-v1';
  readonly name = 'Capital One Credit Card Parser';

  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      text.includes('CAPITALONE.COM') ||
      text.includes('VENTURE X CARD') ||
      text.includes('QUICKSILVER') ||
      text.includes('SAVOR') ||
      (text.includes('CAPITAL ONE') &&
        (text.includes('BILLING CYCLE') ||
          text.includes('DAYS IN BILLING CYCLE') ||
          text.includes('CAPITAL ONE, N.A.') ||
          text.includes('WWW.CAPITALONE.COM')))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract Statement Period
    const { periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Extract Account Summary & Balances
    const account = this.extractAccountSummary(fullText);

    // 3. Extract Multi-Cardholder Transactions
    this.extractTransactions(doc, account, startYear, endYear);

    const reconciledAccounts = reconcileStatementAccounts([account]);

    return {
      institution: 'Capital One, N.A.',
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
    // Pattern: "Jul 15, 2026 - Aug 14, 2026 | 31 days in Billing Cycle"
    const periodMatch = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
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

  private extractAccountSummary(text: string): BankAccount {
    // Product Name
    let accountName = 'Capital One Credit Card';
    const prodMatch = text.match(/(?:Page\s+\d+\s+of\s+\d+\s+)?([A-Za-z0-9\s]+Card)\s*\|\s*Visa/i);
    if (prodMatch) {
      accountName = prodMatch[1].replace(/Page\s+\d+\s+of\s+\d+/i, '').trim();
    }

    // Account Number: "Visa Infinite ending in 4192" or "Account ending in 4192"
    const accMatch = text.match(/ending in\s*(\d{4})/i);
    const last4 = accMatch ? accMatch[1] : 'UNKNOWN';
    const accountNumberMasked = last4 !== 'UNKNOWN' ? `...${last4}` : 'UNKNOWN';

    // Balances
    let openingBalance: number | undefined;
    let closingBalance: number | undefined;
    let totalDeposits: number | undefined;
    let totalWithdrawals: number | undefined;

    const prevBalMatch = text.match(/Previous Balance\s+\$?([\d,]+\.\d{2})/i);
    if (prevBalMatch) {
      openingBalance = parseFloat(prevBalMatch[1].replace(/,/g, ''));
    }

    const newBalMatch =
      text.match(/New Balance\s*=\s*\$?([\d,]+\.\d{2})/i) ||
      text.match(/New Balance\s+Minimum Payment Due[\s\S]*?\$?([\d,]+\.\d{2})/i);
    if (newBalMatch) {
      closingBalance = parseFloat(newBalMatch[1].replace(/,/g, ''));
    }

    const payMatch = text.match(/Payments\s*-\s*\$?([\d,]+\.\d{2})/i);
    if (payMatch) {
      totalDeposits = parseFloat(payMatch[1].replace(/,/g, ''));
    }

    const txTotalMatch = text.match(/Transactions\s*\+\s*\$?([\d,]+\.\d{2})/i);
    if (txTotalMatch) {
      totalWithdrawals = parseFloat(txTotalMatch[1].replace(/,/g, ''));
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
    let currentCardholder = '';
    let currentSection: 'PAYMENTS' | 'TRANSACTIONS' | 'OTHER' = 'TRANSACTIONS';

    for (const page of doc.pages) {
      for (const line of page.lines) {
        // Detect cardholder section headers, e.g.:
        // "CARDHOLDER_NAME #1234: Payments, Credits and Adjustments"
        // "CARDHOLDER_NAME #1234: Transactions"
        const headerMatch = line.match(/^([A-Za-z\s]+#\d{4}):\s*(Payments, Credits and Adjustments|Transactions)/i);
        if (headerMatch) {
          currentCardholder = headerMatch[1].trim();
          currentSection = headerMatch[2].toLowerCase().includes('payments') ? 'PAYMENTS' : 'TRANSACTIONS';
          continue;
        }

        if (
          line.startsWith('Total Transactions for This Period') ||
          line.startsWith('Fees') ||
          line.startsWith('Interest Charged') ||
          line.startsWith('Totals Year-to-Date') ||
          line.includes('Interest Charge Calculation')
        ) {
          continue;
        }

        // Transaction line regex:
        // Format: "MMM DD MMM DD DESCRIPTION AMOUNT"
        const txMatch = line.match(
          /^([A-Za-z]{3})\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(.+?)\s+([-$]?[\d,]+\.\d{2})$/
        );

        if (txMatch) {
          const [, tMonth, tDay, pMonth, pDay, desc, amtStr] = txMatch;

          const tmNum = this.monthNameToNumber(tMonth);
          const pmNum = this.monthNameToNumber(pMonth);

          const tYear = parseInt(tmNum, 10) >= 10 && startYear < endYear ? startYear : endYear;
          const pYear = parseInt(pmNum, 10) >= 10 && startYear < endYear ? startYear : endYear;

          const transIso = `${tYear}-${tmNum.padStart(2, '0')}-${tDay.padStart(2, '0')}`;
          const postIso = `${pYear}-${pmNum.padStart(2, '0')}-${pDay.padStart(2, '0')}`;

          const rawAmt = Math.abs(parseFloat(amtStr.replace(/[$,-]/g, '')));

          const isPayment =
            currentSection === 'PAYMENTS' || amtStr.includes('-') || desc.toUpperCase().includes('PAYMENT');
          const signedAmount = isPayment ? rawAmt : -rawAmt;

          const description = currentCardholder ? `[${currentCardholder}] ${desc.trim()}` : desc.trim();

          account.transactions.push({
            date: transIso,
            postDate: postIso,
            description,
            rawDescription: line,
            amount: signedAmount,
            type: isPayment ? 'CREDIT' : 'DEBIT',
            category: currentCardholder ? `Cardholder: ${currentCardholder}` : undefined
          });
        }
      }
    }
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
      august: '08',
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
      september: '09',
      october: '10',
      november: '11',
      december: '12'
    };
    return months[name.toLowerCase()] || '01';
  }
}
