import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  BankTransaction,
  ExtractedPdfDocument,
  AccountType
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class AllyBankParser implements BankParser {
  readonly id = 'ally-v1';
  readonly name = 'Ally Bank Statement Parser';

  /**
   * Fast signature detection matching unique institutional markers.
   */
  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('ALLY BANK') || text.includes('ALLY.COM') || text.includes('877-247-ALLY')) &&
      (text.includes('COMBINED CUSTOMER STATEMENT') ||
        text.includes('COMBINED CUST OMER ST AT EMENT') ||
        text.includes('ONLINE SAVINGS ACCOUNT') ||
        text.includes('INTEREST CHECKING') ||
        text.includes('CUSTOMER STATEMENT'))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    // 1. Extract Statement Period & Dates
    const { statementDate, periodStart, periodEnd } = this.extractPeriod(doc);

    // 2. Discover and Extract Accounts & Transactions
    const accounts = this.extractAccounts(doc);

    // 3. Reconcile Balances for all accounts
    const reconciledAccounts = reconcileStatementAccounts(accounts);

    return {
      institution: 'Ally Bank',
      ingestor: 'rule-based',
      parserId: this.id,
      statementDate,
      periodStart,
      periodEnd,
      accounts: reconciledAccounts
    };
  }

  private extractPeriod(doc: ExtractedPdfDocument): {
    statementDate?: string;
    periodStart?: string;
    periodEnd?: string;
  } {
    let statementDate: string | undefined;
    let periodStart: string | undefined;
    let periodEnd: string | undefined;

    const fullText = doc.fullText;

    // Statement Date header: "Statement Date\n02/03/2022" or "Statement Date 02/03/2022"
    const stmtDateMatch = fullText.match(/Statement Date\s*\n?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (stmtDateMatch) {
      statementDate = this.formatDate(stmtDateMatch[1]);
    }

    // Beginning balance date: "Beginning Balance, as of 01/04/2022"
    const beginMatch = fullText.match(/Beginning Balance,\s*as of\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (beginMatch) {
      periodStart = this.formatDate(beginMatch[1]);
    }

    // Ending balance date: "Ending Balance, as of 02/03/2022"
    const endMatch = fullText.match(/Ending Balance,\s*as of\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (endMatch) {
      periodEnd = this.formatDate(endMatch[1]);
    }

    if (!periodEnd && statementDate) {
      periodEnd = statementDate;
    }

    return { statementDate, periodStart, periodEnd };
  }

  private extractAccounts(doc: ExtractedPdfDocument): BankAccount[] {
    // 1. Check Page 1 for Customer Statement summary table to seed account metadata
    const summaryAccountMap = new Map<
      string,
      { name: string; openingBalance?: number; closingBalance?: number }
    >();

    const p1Text = doc.pages[0]?.text || '';
    if (p1Text.includes('CUSTOMER STATEMENT') || p1Text.includes('Account Name Account Number')) {
      const summaryRegex = /^(.+?)\s+([xX0-9]{6,17})\s+([-$s]*[\d,]+\.\d{2})\s+([-$s]*[\d,]+\.\d{2})$/gm;
      let sMatch: RegExpExecArray | null;
      while ((sMatch = summaryRegex.exec(p1Text)) !== null) {
        const rawName = sMatch[1].trim();
        const accNum = sMatch[2].trim();
        const openBal = this.parseCurrency(sMatch[3]);
        const closeBal = this.parseCurrency(sMatch[4]);
        if (!rawName.startsWith('Total')) {
          summaryAccountMap.set(accNum.toLowerCase(), {
            name: rawName,
            openingBalance: openBal,
            closingBalance: closeBal
          });
        }
      }
    }

    // 2. Iterate pages and parse each account section
    const accounts: BankAccount[] = [];
    let currentAccount: BankAccount | null = null;
    let inActivity = false;
    let pendingTx: BankTransaction | null = null;
    let pendingDescLines: string[] = [];

    const flushPending = () => {
      if (pendingTx && currentAccount) {
        if (pendingDescLines.length > 0) {
          const extraDesc = pendingDescLines.join(' ').trim();
          pendingTx.rawDescription = `${pendingTx.description} ${extraDesc}`.trim();

          const checkMatch = extraDesc.match(/Check Paid #(\d+)/i);
          if (checkMatch) {
            pendingTx.checkNumber = checkMatch[1];
            pendingTx.description = `Check #${checkMatch[1]}`;
          } else {
            pendingTx.description = `${pendingTx.description} - ${extraDesc}`;
          }
        }
        currentAccount.transactions.push(pendingTx);
        pendingTx = null;
        pendingDescLines = [];
      }
    };

    for (let pIdx = 0; pIdx < doc.pages.length; pIdx++) {
      const page = doc.pages[pIdx];
      const lines = page.lines;

      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const line = lines[lIdx];

        // Detect account header: "Account Number: xxxxxx3156 Open Date: 11/10/2019"
        if (line.includes('Account Number:') && line.includes('Open Date:')) {
          flushPending();
          inActivity = false;

          const accNumMatch = line.match(/Account Number:\s*([xX0-9]+)/i);
          const accNum = accNumMatch ? accNumMatch[1].trim() : 'UNKNOWN';

          // Detect account name from summary table, preceding lines, or product line
          const seeded = summaryAccountMap.get(accNum.toLowerCase());
          let accName = seeded?.name;

          if (!accName) {
            // Check lines above "Account Number:" (e.g. "Checking - TN Memphis www.ally.com")
            for (let k = 1; k <= 3; k++) {
              const candidate = lines[lIdx - k] || '';
              const cleaned = candidate.replace(/www\.ally\.com/gi, '').trim();
              if (
                cleaned &&
                !cleaned.startsWith('Customer Care') &&
                !cleaned.startsWith('Toll Free') &&
                !cleaned.startsWith('Statement Date') &&
                !cleaned.startsWith('Page ') &&
                !cleaned.startsWith('Summary For:') &&
                !cleaned.startsWith('COMBINED')
              ) {
                accName = cleaned;
                break;
              }
            }
          }

          // Check product line: "Product: Interest Checking Account Ownership: Single"
          const nextLine = lines[lIdx + 1] || '';
          const prodMatch = nextLine.match(/Product:\s*([^A]+?)(?:Account Ownership|$)/i);
          const prodName = prodMatch ? prodMatch[1].trim() : '';

          if (!accName || accName === 'Ally Account') {
            accName = prodName || 'Ally Account';
          }

          const isSavings =
            prodName.toLowerCase().includes('savings') || accName.toLowerCase().includes('savings');
          const isChecking =
            prodName.toLowerCase().includes('checking') || accName.toLowerCase().includes('checking');

          const accountType: AccountType = isSavings
            ? 'SAVINGS'
            : isChecking
              ? 'CHECKING'
              : 'OTHER';

          currentAccount = {
            accountName: accName,
            accountNumberMasked: accNum,
            accountType,
            currency: 'USD',
            openingBalance: seeded?.openingBalance,
            closingBalance: seeded?.closingBalance,
            transactions: []
          };
          accounts.push(currentAccount);
          continue;
        }

        // Account balances from per-account summary
        if (currentAccount && line.includes('Beginning Balance, as of')) {
          const match = line.match(
            /Beginning Balance,\s*as of\s*\d{2}\/\d{2}\/\d{4}\s+([-$s]*[\d,]+\.\d{2})/i
          );
          if (match) currentAccount.openingBalance = this.parseCurrency(match[1]);
        }

        if (currentAccount && line.includes('Ending Balance, as of')) {
          const match = line.match(
            /Ending Balance,\s*as of\s*\d{2}\/\d{2}\/\d{4}\s+([-$s]*[\d,]+\.\d{2})/i
          );
          if (match) currentAccount.closingBalance = this.parseCurrency(match[1]);
        }

        if (currentAccount && line.includes('Deposits and Other Credits')) {
          const match = line.match(/Deposits and Other Credits\s+([-$s]*[\d,]+\.\d{2})/i);
          if (match) currentAccount.totalDeposits = this.parseCurrency(match[1]);
        }

        if (currentAccount && line.includes('Withdrawals and Other Debits')) {
          const match = line.match(/Withdrawals and Other Debits\s+([-$s]*[\d,]+\.\d{2})/i);
          if (match) currentAccount.totalWithdrawals = Math.abs(this.parseCurrency(match[1]));
        }

        // Activity Table header
        if (line === 'Activity' || line.startsWith('Date Description Credits Debits Balance')) {
          inActivity = true;
          continue;
        }

        // Section end / page footer markers
        if (
          line.includes('Ally Bank Member FDIC') ||
          line.includes('Regulatory Requirement:') ||
          line.includes('Send Correspondence to:') ||
          line.includes('CHECKS OUTSTANDING TO BALANCE YOUR ACCOUNT')
        ) {
          flushPending();
          inActivity = false;
          continue;
        }

        if (inActivity && currentAccount) {
          // Transaction Line: "MM/DD/YYYY Description Credits Debits Balance"
          const txMatch = line.match(
            /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([-$s]*[\d,]+\.\d{2})\s+([-$s]*[\d,]+\.\d{2})\s+([-$s]*[\d,]+\.\d{2})$/
          );
          const balMatch = line.match(
            /^(\d{2}\/\d{2}\/\d{4})\s+(Beginning Balance|Ending Balance)\s+([-$s]*[\d,]+\.\d{2})$/
          );

          if (balMatch) {
            flushPending();
            continue;
          }

          if (txMatch) {
            flushPending();
            const [, dStr, desc, crStr, dbStr, balStr] = txMatch;
            const credits = this.parseCurrency(crStr);
            const debits = this.parseCurrency(dbStr);
            const runningBalance = this.parseCurrency(balStr);

            const isCredit =
              credits > 0 ||
              (credits === 0 && debits === 0 && desc.toLowerCase().includes('deposit'));
            const amount = isCredit ? credits : debits !== 0 ? debits : -credits;

            pendingTx = {
              date: this.formatDate(dStr),
              description: desc.trim(),
              rawDescription: desc.trim(),
              amount,
              type: amount >= 0 ? 'CREDIT' : 'DEBIT',
              runningBalance
            };
            pendingDescLines = [];
            continue;
          }

          // Continuation lines for description
          if (pendingTx) {
            if (
              !line.startsWith('COMBINED') &&
              !line.startsWith('Statement Date') &&
              !line.startsWith('Page ') &&
              !line.startsWith('Customer Care') &&
              !line.startsWith('Toll Free') &&
              !line.startsWith('www.ally.com') &&
              !line.match(/^\d{6}-\d{2}-\d{2}/) &&
              !line.match(/^\d{6}\/\d{7}\/\//)
            ) {
              pendingDescLines.push(line.trim());
            }
          }
        }
      }
      flushPending();
    }

    return accounts;
  }

  private parseCurrency(val: string): number {
    const isNegative = val.includes('-') || val.startsWith('(');
    const cleaned = val.replace(/[$(),\s+-]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNegative ? -num : num;
  }

  private formatDate(dStr: string): string {
    const [mm, dd, yyyy] = dStr.split('/');
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
}

