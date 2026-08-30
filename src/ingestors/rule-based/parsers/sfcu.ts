import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  BankTransaction,
  ExtractedPdfDocument,
  AccountType
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class SFCUBankParser implements BankParser {
  readonly id = 'sfcu-v1';
  readonly name = 'Stanford Federal Credit Union Statement Parser';

  readonly stringHints = [
    'STANFORD FEDERAL CREDIT UNION',
    'SFCU.ORG',
    /MEMBER NUMBER:[\s\S]*?DIVIDEND PERIOD:/i
  ] as const;

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract period
    const { statementDate, periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Discover accounts and parse transactions
    const accounts = this.extractAccounts(doc, startYear, endYear);

    // 3. Reconcile all accounts
    const reconciledAccounts = reconcileStatementAccounts(accounts);

    return {
      institution: 'Stanford Federal Credit Union',
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

    // Statement Date: 08-31-2023 or 08/31/2023
    const stmtDateMatch = text.match(/Statement Date:\s*(\d{2})[-/](\d{2})[-/](\d{4})/i);
    if (stmtDateMatch) {
      const [, mm, dd, yyyy] = stmtDateMatch;
      statementDate = `${yyyy}-${mm}-${dd}`;
      periodEnd = statementDate;
      endYear = parseInt(yyyy, 10);
      startYear = endYear;
    }

    // Dividend Period: 08-01-2023 to 08-31-2023
    const periodMatch = text.match(
      /Dividend Period:\s*(\d{2})[-/](\d{2})[-/](\d{4})\s+to\s+(\d{2})[-/](\d{2})[-/](\d{4})/i
    );
    if (periodMatch) {
      const [, sm, sd, sy, em, ed, ey] = periodMatch;
      periodStart = `${sy}-${sm}-${sd}`;
      periodEnd = `${ey}-${em}-${ed}`;
      startYear = parseInt(sy, 10);
      endYear = parseInt(ey, 10);
      if (!statementDate) statementDate = periodEnd;
    }

    return { statementDate, periodStart, periodEnd, startYear, endYear };
  }

  private extractAccounts(
    doc: ExtractedPdfDocument,
    startYear: number,
    endYear: number
  ): BankAccount[] {
    const accounts: BankAccount[] = [];
    let currentAccount: BankAccount | null = null;
    let inTransactions = false;
    let pendingTx: BankTransaction | null = null;
    let pendingDescLines: string[] = [];

    const flushPending = () => {
      if (pendingTx && currentAccount) {
        if (pendingDescLines.length > 0) {
          const extraDesc = pendingDescLines.join(' ').trim();
          pendingTx.rawDescription = `${pendingTx.description} ${extraDesc}`.trim();
          pendingTx.description = `${pendingTx.description} ${extraDesc}`.trim();
        }
        currentAccount.transactions.push(pendingTx);
        pendingTx = null;
        pendingDescLines = [];
      }
    };

    for (const page of doc.pages) {
      const lines = page.lines;

      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const line = lines[lIdx];

        // Account Header Detection:
        // E.g. "BASIC CHECKING (CHECKING) xxxxxx0761"
        // E.g. "AUTO USED FIXED - 2017TESLAMODEL X (CONSUMER LOAN) xxxxxx7730"
        // E.g. "SAVINGS (SAVINGS) xxxxxx1234"
        const accHeaderMatch = line.match(
          /^([A-Z0-9\s-]+(?:\([A-Z\s]+\))?)\s+([xX0-9]{6,17})$/
        );

        if (accHeaderMatch && !line.startsWith('ACCOUNT SUMMARY')) {
          flushPending();
          inTransactions = false;

          const rawTitle = accHeaderMatch[1].trim();
          const rawNum = accHeaderMatch[2].trim();
          const last4 = rawNum.slice(-4);
          const accountNumberMasked = `...${last4}`;

          let accountType: AccountType = 'CHECKING';
          if (rawTitle.includes('LOAN') || rawTitle.includes('AUTO USED')) {
            accountType = 'LOAN';
          } else if (rawTitle.includes('SAVINGS') || rawTitle.includes('MONEY MARKET')) {
            accountType = 'SAVINGS';
          }

          // Clean account name
          let accountName = rawTitle
            .replace(/\((?:CHECKING|CONSUMER LOAN|SAVINGS|LOAN)\)/gi, '')
            .trim();
          accountName = accountName
            .toLowerCase()
            .split(' ')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

          currentAccount = {
            accountName,
            accountNumberMasked,
            accountType,
            currency: 'USD',
            transactions: []
          };
          accounts.push(currentAccount);
          continue;
        }

        if (currentAccount) {
          // Balances
          if (line.includes('Beginning Balance:')) {
            const m = line.match(/Beginning Balance:\s*\$?\s*([-$s]*[\d,]+\.\d{2})/i);
            if (m) currentAccount.openingBalance = this.parseCurrency(m[1]);
          }

          if (line.includes('Ending Balance:')) {
            const m = line.match(/Ending Balance:\s*\$?\s*([-$s]*[\d,]+\.\d{2})/i);
            if (m) currentAccount.closingBalance = this.parseCurrency(m[1]);
          }

          if (line.includes('Deposits:')) {
            const m = line.match(/Deposits:\s*\$?\s*([-$s]*[\d,]+\.\d{2})/i);
            if (m) currentAccount.totalDeposits = Math.abs(this.parseCurrency(m[1]));
          }

          if (line.includes('Withdrawals:') && !line.includes('Date Date')) {
            const m = line.match(/Withdrawals:\s*\$?\s*([-$s]*[\d,]+\.\d{2})/i);
            if (m) currentAccount.totalWithdrawals = Math.abs(this.parseCurrency(m[1]));
          }

          // Transactions table header
          if (line === 'TRANSACTIONS') {
            inTransactions = true;
            continue;
          }

          // Transactions end
          if (
            line.startsWith('Summary of Overdraft') ||
            line.startsWith('Stanford Federal Credit Union') ||
            line.startsWith('Member Number:')
          ) {
            flushPending();
            inTransactions = false;
            continue;
          }

          if (inTransactions) {
            if (
              line.startsWith('Posted Effective') ||
              line.startsWith('Date Date Description') ||
              line.startsWith('Payments') ||
              line.startsWith('Date Effective Transaction') ||
              line.startsWith('Posted Date Description') ||
              line.startsWith('Beginning Balance') ||
              line.startsWith('Previous Balance') ||
              line.startsWith('Ending Balance')
            ) {
              if (line.startsWith('Ending Balance')) {
                flushPending();
              }
              continue;
            }

            if (currentAccount.accountType === 'LOAN') {
              // Loan Payment Transaction row
              // Format: "08/01 08/01 Regular Payment 1,115.02 1,018.28 96.74 0.00 34,135.21"
              const loanTxMatch = line.match(
                /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+([-$s]*[\d,]+\.\d{2})\s+([-$s]*[\d,]+\.\d{2})\s+([-$s]*[\d,]+\.\d{2})\s+([-$s]*[\d,]+\.\d{2})\s+([$]?\s*[\d,]+\.\d{2})$/
              );

              if (loanTxMatch) {
                flushPending();
                const [, postDate, effDate, desc, , principalStr, financeStr, , balStr] =
                  loanTxMatch;
                const [mm, dd] = postDate.split('/');
                const month = parseInt(mm, 10);
                const year = month >= 10 && startYear < endYear ? startYear : endYear;
                const isoDate = `${year}-${mm}-${dd}`;
                const effIso = `${year}-${effDate.replace('/', '-')}`;

                // For loan liability account, principal paid reduces balance
                const principalPaid = Math.abs(this.parseCurrency(principalStr));
                const financeCharge = Math.abs(this.parseCurrency(financeStr));
                const runningBalance = this.parseCurrency(balStr);

                pendingTx = {
                  date: isoDate,
                  postDate: effIso,
                  description: `${desc.trim()} (Principal: $${principalPaid.toFixed(2)}, Interest: $${financeCharge.toFixed(2)})`,
                  rawDescription: line,
                  amount: principalPaid,
                  type: 'CREDIT',
                  runningBalance
                };
                pendingDescLines = [];
                continue;
              }
            } else {
              // Case B: Checking / Deposit Transaction row
              // Format: "08/01 08/01 Withdrawal Transfer to 702797730 1,115.02 $1,167.83"
              // Format: "08/03 08/03 ACH Credit GOOGLE LLC 00000000000 - 500.00 $1,667.83"
              const checkingTxMatch = line.match(
                /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+([-$s]*[\d,]+\.\d{2})\s+([$]?\s*[\d,]+\.\d{2})$/
              );

              if (checkingTxMatch) {
                flushPending();
                const [, postDate, effDate, desc, amtStr, balStr] = checkingTxMatch;
                const [mm, dd] = postDate.split('/');
                const month = parseInt(mm, 10);
                const year = month >= 10 && startYear < endYear ? startYear : endYear;
                const isoDate = `${year}-${mm}-${dd}`;
                const effIso = `${year}-${effDate.replace('/', '-')}`;

                const rawAmt = Math.abs(this.parseCurrency(amtStr));
                const lowerDesc = desc.toLowerCase();
                const isCredit =
                  lowerDesc.includes('credit') ||
                  lowerDesc.includes('deposit') ||
                  lowerDesc.includes('payroll') ||
                  lowerDesc.includes('dividend') ||
                  lowerDesc.includes('interest');

                const amount = isCredit ? rawAmt : -rawAmt;
                const runningBalance = this.parseCurrency(balStr);

                pendingTx = {
                  date: isoDate,
                  postDate: effIso,
                  description: desc.trim(),
                  rawDescription: line,
                  amount,
                  type: amount >= 0 ? 'CREDIT' : 'DEBIT',
                  runningBalance
                };
                pendingDescLines = [];
                continue;
              }
            }

            // Continuation description line (e.g. "PAYROLL")
            if (pendingTx) {
              if (
                !line.startsWith('Page:') &&
                !line.startsWith('Member Number:') &&
                !line.startsWith('Statement Date:')
              ) {
                pendingDescLines.push(line.trim());
              }
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
}
