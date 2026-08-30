import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  BankTransaction,
  ExtractedPdfDocument,
  AccountType
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class MarcusBankParser implements BankParser {
  readonly id = 'marcus-v1';
  readonly name = 'Marcus by Goldman Sachs Statement Parser';

  /**
   * Signature detection matching Goldman Sachs / Marcus statements.
   */
  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('GOLDMAN SACHS') || text.includes('MARCUS.COM')) &&
      (text.includes('ONLINE SAVINGS') ||
        text.includes('STATEMENT SUMMARY') ||
        text.includes('GOLDMAN SACHS BANK USA') ||
        text.includes('EXPLORE THE MARCUS RESOURCE CENTER'))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract period
    const { statementDate, periodStart, periodEnd } = this.extractPeriod(fullText);

    // 2. Extract account and activity
    const accounts = this.extractAccounts(doc);

    // 3. Reconcile
    const reconciledAccounts = reconcileStatementAccounts(accounts);

    return {
      institution: 'Goldman Sachs Bank USA',
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
  } {
    let statementDate: string | undefined;
    let periodStart: string | undefined;
    let periodEnd: string | undefined;

    // Pattern: "Statement Period 04/01/2025 to 04/30/2025" or "04/01/2025 to 04/30/2025"
    const periodMatch = text.match(
      /(?:Statement Period\s+)?(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i
    );

    if (periodMatch) {
      const [, startStr, endStr] = periodMatch;
      periodStart = this.formatDate(startStr);
      periodEnd = this.formatDate(endStr);
      statementDate = periodEnd;
    }

    return { statementDate, periodStart, periodEnd };
  }

  private extractAccounts(doc: ExtractedPdfDocument): BankAccount[] {
    const fullText = doc.fullText;

    // Account Name
    let accountName = 'Online Savings';
    const nameMatch = fullText.match(/Account Name\s+([A-Za-z\s]+?)(?:\n|STATEMENT|$)/i);
    if (nameMatch) {
      accountName = nameMatch[1].trim();
    }

    const isSavings = accountName.toLowerCase().includes('savings');
    const isChecking = accountName.toLowerCase().includes('checking');
    const accountType: AccountType = isSavings ? 'SAVINGS' : isChecking ? 'CHECKING' : 'OTHER';

    // Account Number
    const accMatch = fullText.match(/Account Number\s+(\d{6,17})/i);
    const rawAccNum = accMatch ? accMatch[1].trim() : 'UNKNOWN';
    const accountNumberMasked =
      rawAccNum.length > 4 ? `...${rawAccNum.slice(-4)}` : rawAccNum;

    // Balances
    let openingBalance: number | undefined;
    let closingBalance: number | undefined;
    let totalDeposits: number | undefined;
    let totalWithdrawals: number | undefined;

    const beginMatch = fullText.match(/Beginning Balance\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
    if (beginMatch) {
      openingBalance = this.parseCurrency(beginMatch[1]);
    }

    const endMatch = fullText.match(/Ending Balance\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
    if (endMatch) {
      closingBalance = this.parseCurrency(endMatch[1]);
    }

    const depMatch = fullText.match(/Deposits and Other Credits\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
    if (depMatch) {
      totalDeposits = Math.abs(this.parseCurrency(depMatch[1]));
    }

    const wdlMatch = fullText.match(/Withdrawals and Other Debits\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
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

    // Extract Activity
    this.extractTransactions(doc, account);

    return [account];
  }

  private extractTransactions(doc: ExtractedPdfDocument, account: BankAccount): void {
    let inActivity = false;
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

        if (line.includes('ACCOUNT ACTIVITY')) {
          inActivity = true;
          continue;
        }

        if (
          line.includes('Explore the Marcus') ||
          line.includes('In Case of Errors') ||
          line.includes('STMTCMB100')
        ) {
          flushPending();
          inActivity = false;
          continue;
        }

        if (
          line.startsWith('Date Description') ||
          line.startsWith('Date Description Credits Debits')
        ) {
          continue;
        }

        if (inActivity) {
          // Transaction Line Match: "04/01/2025 ACH Withdrawal CAPITAL ONE MOBILE PMT $8,555.03 $358,472.11"
          const txMatch = line.match(
            /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([$]?\s*[\d,]+\.\d{2})(?:\s+([$]?\s*[\d,]+\.\d{2}))?$/
          );

          if (txMatch) {
            const [, dateStr, desc, amtStr, balStr] = txMatch;

            // Skip beginning and ending balance rows
            if (
              desc.trim().toLowerCase() === 'beginning balance' ||
              desc.trim().toLowerCase() === 'ending balance'
            ) {
              flushPending();
              continue;
            }

            flushPending();
            const isoDate = this.formatDate(dateStr);
            const rawAmt = Math.abs(this.parseCurrency(amtStr));
            const runningBalance = balStr ? this.parseCurrency(balStr) : undefined;

            const lowerDesc = desc.toLowerCase();
            let isDebit = false;
            let isCredit = false;

            if (
              lowerDesc.includes('withdrawal') ||
              lowerDesc.includes('debit') ||
              lowerDesc.includes('fee') ||
              lowerDesc.includes('pmt') ||
              lowerDesc.includes('payment')
            ) {
              isDebit = true;
            } else if (
              lowerDesc.includes('interest') ||
              lowerDesc.includes('bonus') ||
              lowerDesc.includes('deposit') ||
              lowerDesc.includes('promotion') ||
              lowerDesc.includes('refund') ||
              lowerDesc.includes('credit')
            ) {
              isCredit = true;
            } else {
              isDebit = true;
            }

            const amount = isCredit && !isDebit ? rawAmt : -rawAmt;

            pendingTx = {
              date: isoDate,
              description: desc.trim(),
              rawDescription: line,
              amount,
              type: amount >= 0 ? 'CREDIT' : 'DEBIT',
              runningBalance
            };
            pendingDescLines = [];
            continue;
          }

          // Continuation line
          if (pendingTx) {
            if (
              !line.startsWith('Page ') &&
              !line.startsWith('Goldman Sachs') &&
              !line.includes('Ending Balance') &&
              !line.includes('Beginning Balance')
            ) {
              pendingDescLines.push(line.trim());
            }
          }
        }
      }
      flushPending();
    }
  }

  private formatDate(dStr: string): string {
    const [mm, dd, yyyy] = dStr.split('/');
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  private parseCurrency(val: string): number {
    const isNegative = val.includes('-') || val.startsWith('(');
    const cleaned = val.replace(/[$(),\s+-]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNegative ? -num : num;
  }
}
