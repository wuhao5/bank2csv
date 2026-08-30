import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  BankTransaction,
  ExtractedPdfDocument,
  AccountType
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class WellsFargoBankParser implements BankParser {
  readonly id = 'wells-fargo-v1';
  readonly name = 'Wells Fargo Statement Parser';

  /**
   * Signature detection matching Wells Fargo statements.
   */
  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('WELLS FARGO') || text.includes('WELLSFARGO.COM') || text.includes('1-800-TO-WELLS')) &&
      (text.includes('TRANSACTION HISTORY') ||
        text.includes('STATEMENT PERIOD ACTIVITY SUMMARY') ||
        text.includes('WAY2SAVE') ||
        text.includes('EVERYDAY CHECKING') ||
        text.includes('WELLS FARGO BANK, N.A.'))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract statement period and years
    const { statementDate, periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Extract account summary metadata
    const accounts = this.extractAccounts(doc, startYear, endYear);

    // 3. Reconcile balances
    const reconciledAccounts = reconcileStatementAccounts(accounts);

    return {
      institution: 'Wells Fargo Bank, N.A.',
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

    // Pattern 1: Header date: "September 16, 2022 Page 1 of 5" or "January 31, 2022 Page 1 of 4"
    const headerDateMatch = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+Page\s+\d+\s+of/i);
    if (headerDateMatch) {
      const [, mStr, dStr, yStr] = headerDateMatch;
      const mm = this.monthNameToNumber(mStr);
      const dd = dStr.padStart(2, '0');
      const yyyy = parseInt(yStr, 10);
      statementDate = `${yyyy}-${mm}-${dd}`;
      periodEnd = statementDate;
      endYear = yyyy;
      startYear = yyyy;
    }

    // Pattern 2: Fee period: "Fee period 08/16/2022 - 09/16/2022"
    const feePeriodMatch = text.match(/Fee period\s+(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (feePeriodMatch) {
      const [, sm, sd, sy, em, ed, ey] = feePeriodMatch;
      periodStart = `${sy}-${sm}-${sd}`;
      periodEnd = `${ey}-${em}-${ed}`;
      startYear = parseInt(sy, 10);
      endYear = parseInt(ey, 10);
    } else {
      // Pattern 3: Beginning balance date: "Beginning balance on 8/16" and "Ending balance on 9/16"
      const beginBalMatch = text.match(/Beginning balance on\s+(\d{1,2})\/(\d{1,2})/i);
      const endBalMatch = text.match(/Ending balance on\s+(\d{1,2})\/(\d{1,2})/i);
      if (beginBalMatch && endBalMatch && statementDate) {
        const startM = parseInt(beginBalMatch[1], 10);
        const endM = parseInt(endBalMatch[1], 10);
        const sYear = startM > endM ? endYear - 1 : endYear;
        startYear = sYear;
        periodStart = `${sYear}-${String(startM).padStart(2, '0')}-${beginBalMatch[2].padStart(2, '0')}`;
        periodEnd = `${endYear}-${String(endM).padStart(2, '0')}-${endBalMatch[2].padStart(2, '0')}`;
      }
    }

    return { statementDate, periodStart, periodEnd, startYear, endYear };
  }

  private extractAccounts(
    doc: ExtractedPdfDocument,
    startYear: number,
    endYear: number
  ): BankAccount[] {
    const fullText = doc.fullText;

    // Account Product Name
    let accountName = 'Wells Fargo Account';
    if (fullText.includes('Way2Save Savings')) {
      accountName = 'Wells Fargo Way2Save Savings';
    } else if (fullText.includes('Everyday Checking')) {
      accountName = 'Wells Fargo Everyday Checking';
    } else {
      const nameMatch = fullText.match(/Wells Fargo\s+([A-Za-z0-9\s]+?(?:Checking|Savings|Account))/i);
      if (nameMatch) {
        accountName = `Wells Fargo ${nameMatch[1].trim()}`;
      }
    }

    const isSavings = accountName.toLowerCase().includes('savings');
    const isChecking = accountName.toLowerCase().includes('checking');
    const accountType: AccountType = isSavings ? 'SAVINGS' : isChecking ? 'CHECKING' : 'OTHER';

    // Account Number
    const accNumMatch = fullText.match(/Account [Nn]umber:\s*(\d{6,17})/i);
    const rawAccNum = accNumMatch ? accNumMatch[1].trim() : 'UNKNOWN';
    const accountNumberMasked =
      rawAccNum.length > 4 ? `...${rawAccNum.slice(-4)}` : rawAccNum;

    // Balances & Totals from Activity Summary
    let openingBalance: number | undefined;
    let closingBalance: number | undefined;
    let totalDeposits: number | undefined;
    let totalWithdrawals: number | undefined;

    const beginMatch = fullText.match(/Beginning balance on\s+\d{1,2}\/\d{1,2}\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
    if (beginMatch) {
      openingBalance = this.parseCurrency(beginMatch[1]);
    }

    const endMatch = fullText.match(/Ending balance on\s+\d{1,2}\/\d{1,2}\s+\$?\s*([-$s]*[\d,]+\.\d{2})/i);
    if (endMatch) {
      closingBalance = this.parseCurrency(endMatch[1]);
    }

    const depMatch = fullText.match(/Deposits\/Additions\s+([-$s]*[\d,]+\.\d{2})/i);
    if (depMatch) {
      totalDeposits = Math.abs(this.parseCurrency(depMatch[1]));
    }

    const wdlMatch = fullText.match(/Withdrawals\/Subtractions\s+([-$s]*[\d,]+\.\d{2})/i);
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
    let inTxHistory = false;
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

        if (line.includes('Transaction history')) {
          inTxHistory = true;
          continue;
        }

        if (
          line.startsWith('Ending balance on') ||
          line.startsWith('Totals $') ||
          line.startsWith('Summary of checks written') ||
          line.startsWith('Monthly service fee summary') ||
          line.startsWith('IMPORTANT ACCOUNT INFORMATION') ||
          line.startsWith('Worksheet to balance your account')
        ) {
          if (inTxHistory && (line.startsWith('Ending balance on') || line.startsWith('Summary of checks') || line.startsWith('Monthly service fee'))) {
            flushPending();
            inTxHistory = false;
          }
          continue;
        }

        if (
          line.startsWith('Check Deposits/') ||
          line.startsWith('Deposits/ Withdrawals/') ||
          line.startsWith('Date Number Description') ||
          line.startsWith('Date Description Additions')
        ) {
          continue;
        }

        if (inTxHistory) {
          // Check for transaction start line: starts with M/D or MM/DD
          // Case A: Check row e.g. "8/26 130 Check 2,500.00 26,015.07" or "9/12 133 Check 128.00"
          const checkMatch = line.match(/^(\d{1,2}\/\d{1,2})\s+(\d+)\s+(Check)\s+([-$s]*[\d,]+\.\d{2})(?:\s+([-$s]*[\d,]+\.\d{2}))?$/i);
          if (checkMatch) {
            flushPending();
            const [, dStr, chkNum, , amtStr, balStr] = checkMatch;
            const isoDate = this.formatDate(dStr, startYear, endYear);
            const amount = -Math.abs(this.parseCurrency(amtStr));
            const runningBalance = balStr ? this.parseCurrency(balStr) : undefined;

            pendingTx = {
              date: isoDate,
              description: `Check #${chkNum}`,
              rawDescription: line,
              amount,
              type: 'DEBIT',
              checkNumber: chkNum,
              runningBalance
            };
            pendingDescLines = [];
            continue;
          }

          // Case B: General transaction row e.g. "8/24 Venmo Payment ... 55.15 27,030.07" or "8/26 Information Res Reg.Salary ... 1,500.00"
          const txMatch = line.match(/^(\d{1,2}\/\d{1,2})\s+(.+?)\s+([-$s]*[\d,]+\.\d{2})(?:\s+([-$s]*[\d,]+\.\d{2}))?$/);
          if (txMatch) {
            flushPending();
            const [, dStr, desc, num1, num2] = txMatch;
            const isoDate = this.formatDate(dStr, startYear, endYear);

            // Determine if num1 is addition or subtraction, and if num2 is balance
            const amt1 = this.parseCurrency(num1);
            let amount: number;
            let runningBalance: number | undefined;

            const itemMatch = this.determineTypeFromItems(page, dStr, num1);
            if (itemMatch !== null) {
              amount = itemMatch === 'CREDIT' ? Math.abs(amt1) : -Math.abs(amt1);
              if (num2) {
                runningBalance = this.parseCurrency(num2);
              }
            } else {
              // Heuristic fallback
              const lowerDesc = desc.toLowerCase();
              const isCredit =
                lowerDesc.includes('interest payment') ||
                lowerDesc.includes('deposit') ||
                lowerDesc.includes('salary') ||
                lowerDesc.includes('payroll') ||
                lowerDesc.includes('credit') ||
                lowerDesc.includes('refund');

              amount = isCredit ? Math.abs(amt1) : -Math.abs(amt1);
              if (num2) {
                runningBalance = this.parseCurrency(num2);
              }
            }

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

          // Continuation line for description (e.g. "01/24/22" or additional ACH info)
          if (pendingTx) {
            if (
              !line.startsWith('The Ending Daily Balance') &&
              !line.startsWith('Sheet Seq') &&
              !line.startsWith('Sheet ') &&
              !line.startsWith('Page ') &&
              !line.startsWith('January') &&
              !line.startsWith('September')
            ) {
              pendingDescLines.push(line.trim());
            }
          }
        }
      }
      flushPending();
    }
  }

  private determineTypeFromItems(
    page: ExtractedPdfDocument['pages'][0],
    dateStr: string,
    amountStr: string
  ): 'CREDIT' | 'DEBIT' | null {
    if (!page.items || page.items.length === 0) return null;

    const cleanedAmt = amountStr.replace(/[$,\s]/g, '');
    const matchingItems = page.items.filter(
      (it) => it.text.trim() === cleanedAmt || it.text.includes(cleanedAmt)
    );

    for (const item of matchingItems) {
      if (item.x >= 380 && item.x < 450) {
        return 'CREDIT';
      }
      if (item.x >= 450 && item.x < 520) {
        return 'DEBIT';
      }
    }

    return null;
  }

  private formatDate(dStr: string, startYear: number, endYear: number): string {
    const [mStr, dStrPart] = dStr.split('/');
    const month = parseInt(mStr, 10);
    const day = parseInt(dStrPart, 10);
    const year = month >= 10 && startYear < endYear ? startYear : endYear;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
