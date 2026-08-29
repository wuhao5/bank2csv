import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  BankTransaction,
  ExtractedPdfDocument,
  AccountType
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class BofABankParser implements BankParser {
  readonly id = 'bofa-v1';
  readonly name = 'Bank of America Statement Parser';

  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('BANK OF AMERICA') || text.includes('BOFA REWARDS') || text.includes('BANKOFAMERICA.COM')) &&
      (text.includes('ACCOUNT SUMMARY') || text.includes('ADV PLUS BANKING') || text.includes('DEPOSITS AND OTHER ADDITIONS'))
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract Period
    const { periodStart, periodEnd } = this.extractPeriod(fullText);

    // 2. Extract Account Metadata & Summary Balances
    const account = this.extractAccountSummary(fullText);

    // 3. Extract Transactions across sections
    this.extractDeposits(doc, account);
    this.extractWithdrawals(doc, account);
    this.extractChecks(doc, account);

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

  private extractPeriod(text: string): { periodStart?: string; periodEnd?: string } {
    // Example: "for July 1, 2026 to July 31, 2026"
    const periodMatch = text.match(/for\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+to\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
    if (periodMatch) {
      const [, startMStr, startD, startY, endMStr, endD, endY] = periodMatch;
      const startM = this.monthNameToNumber(startMStr);
      const endM = this.monthNameToNumber(endMStr);
      return {
        periodStart: `${startY}-${startM.padStart(2, '0')}-${startD.padStart(2, '0')}`,
        periodEnd: `${endY}-${endM.padStart(2, '0')}-${endD.padStart(2, '0')}`
      };
    }
    return {};
  }

  private extractAccountSummary(text: string): BankAccount {
    // Account Number: "Account number: 0004 4897 5489"
    const accNumMatch = text.match(/Account number:\s*([0-9\s]{8,20})/i) || text.match(/Account #\s*([0-9\s]{8,20})/i);
    const accountNumber = accNumMatch ? accNumMatch[1].trim() : 'UNKNOWN';

    // Account Name / Product
    let accountName = 'Adv Plus Banking';
    if (text.includes('Adv Plus Banking')) {
      accountName = 'Adv Plus Banking';
    } else if (text.includes('Preferred Rewards')) {
      accountName = 'Bank of America Preferred Banking';
    }

    let openingBalance: number | undefined;
    let closingBalance: number | undefined;
    let totalDeposits: number | undefined;
    let totalWithdrawals: number | undefined;

    // Balances
    const openMatch = text.match(/Beginning balance on [A-Za-z]+\s+\d{1,2},\s*\d{4}\s+\$?([-\d,]+\.\d{2})/i);
    if (openMatch) openingBalance = parseFloat(openMatch[1].replace(/,/g, ''));

    const closeMatch = text.match(/Ending balance on [A-Za-z]+\s+\d{1,2},\s*\d{4}\s+\$?([-\d,]+\.\d{2})/i);
    if (closeMatch) closingBalance = parseFloat(closeMatch[1].replace(/,/g, ''));

    const depMatch = text.match(/Deposits and other additions\s+\$?([\d,]+\.\d{2})/i);
    if (depMatch) totalDeposits = parseFloat(depMatch[1].replace(/,/g, ''));

    const withMatch = text.match(/Other subtractions\s+\$?([-\d,]+\.\d{2})/i);
    if (withMatch) totalWithdrawals = Math.abs(parseFloat(withMatch[1].replace(/,/g, '')));

    return {
      accountName,
      accountNumberMasked: accountNumber,
      accountType: 'CHECKING',
      currency: 'USD',
      openingBalance,
      closingBalance,
      totalDeposits,
      totalWithdrawals,
      transactions: []
    };
  }

  private extractDeposits(doc: ExtractedPdfDocument, account: BankAccount): void {
    let inDepositsSection = false;

    for (const page of doc.pages) {
      for (const line of page.lines) {
        if (line.includes('Deposits and other additions') && !line.includes('Total deposits')) {
          inDepositsSection = true;
          continue;
        }
        if (inDepositsSection) {
          if (
            line.startsWith('Total deposits and other additions') ||
            line.startsWith('Withdrawals and other subtractions') ||
            line.startsWith('Other subtractions') ||
            line.startsWith('Checks')
          ) {
            inDepositsSection = false;
            break;
          }

          if (line.startsWith('Date') || line.startsWith('Page ') || line.includes('! Account #')) {
            continue;
          }

          // Format: "07/02/26 ACME CORP DES:PAYROLL ID:123456789 INDN:Jane Doe CO ID:JXXXXXXXXX PPD 4,975.65"
          const match = line.match(/^(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s+([\d,]+\.\d{2})$/);
          if (match) {
            const [, dateStr, desc, amtStr] = match;
            const isoDate = this.normalizeBofADate(dateStr);
            const amount = parseFloat(amtStr.replace(/,/g, ''));

            account.transactions.push({
              date: isoDate,
              description: desc.trim(),
              rawDescription: line,
              amount: Math.abs(amount), // deposits are positive credits
              type: 'CREDIT'
            });
          }
        }
      }
    }
  }

  private extractWithdrawals(doc: ExtractedPdfDocument, account: BankAccount): void {
    let inWithdrawalsSection = false;
    let currentTx: { date: string; descParts: string[]; rawLines: string[]; amount: number } | null = null;

    for (const page of doc.pages) {
      for (const line of page.lines) {
        if (line.includes('Other subtractions') && !line.includes('Total other subtractions')) {
          inWithdrawalsSection = true;
          continue;
        }
        if (inWithdrawalsSection) {
          if (
            line.startsWith('Total other subtractions') ||
            line.startsWith('Total withdrawals') ||
            line.startsWith('Checks') ||
            line.includes('Introducing My Credit') ||
            line.includes('Service fees')
          ) {
            if (currentTx) {
              this.pushWithdrawalTx(account, currentTx);
              currentTx = null;
            }
            inWithdrawalsSection = false;
            break;
          }

          if (line.startsWith('Date') || line.startsWith('Page ') || line.includes('! Account #')) {
            continue;
          }

          // Check if new transaction row starts with Date (MM/DD/YY)
          const newRowMatch = line.match(/^(\d{2}\/\d{2}\/\d{2})\s+(.*)$/);
          if (newRowMatch) {
            if (currentTx) {
              this.pushWithdrawalTx(account, currentTx);
              currentTx = null;
            }

            const [, dateStr, rest] = newRowMatch;
            const isoDate = this.normalizeBofADate(dateStr);

            // Check if amount is on the same line
            const endAmtMatch = rest.match(/([-\$]?[\d,]+\.\d{2})$/);
            if (endAmtMatch) {
              const amountStr = endAmtMatch[1];
              const desc = rest.substring(0, rest.length - amountStr.length).trim();
              const amt = Math.abs(parseFloat(amountStr.replace(/[$,]/g, '')));
              currentTx = {
                date: isoDate,
                descParts: desc ? [desc] : [],
                rawLines: [line],
                amount: amt
              };
            } else {
              currentTx = {
                date: isoDate,
                descParts: [rest.trim()],
                rawLines: [line],
                amount: 0
              };
            }
          } else if (currentTx) {
            // Continuation line of multi-line description or trailing amount
            const endAmtMatch = line.match(/([-\$]?[\d,]+\.\d{2})$/);
            if (endAmtMatch && currentTx.amount === 0) {
              const amountStr = endAmtMatch[1];
              const desc = line.substring(0, line.length - amountStr.length).trim();
              if (desc) currentTx.descParts.push(desc);
              currentTx.amount = Math.abs(parseFloat(amountStr.replace(/[$,]/g, '')));
              currentTx.rawLines.push(line);
            } else {
              currentTx.descParts.push(line.trim());
              currentTx.rawLines.push(line);
            }
          }
        }
      }
    }

    if (currentTx) {
      this.pushWithdrawalTx(account, currentTx);
    }
  }

  private pushWithdrawalTx(
    account: BankAccount,
    tx: { date: string; descParts: string[]; rawLines: string[]; amount: number }
  ): void {
    const cleanedDesc = tx.descParts.join(' ').replace(/\s+/g, ' ').trim();
    account.transactions.push({
      date: tx.date,
      description: cleanedDesc,
      rawDescription: tx.rawLines.join('\n'),
      amount: -Math.abs(tx.amount), // withdrawals are negative debits
      type: 'DEBIT'
    });
  }

  private extractChecks(doc: ExtractedPdfDocument, account: BankAccount): void {
    let inChecksSection = false;

    for (const page of doc.pages) {
      for (const line of page.lines) {
        if (line.trim() === 'Checks' || line.startsWith('Checks\n')) {
          inChecksSection = true;
          continue;
        }
        if (inChecksSection) {
          if (
            line.startsWith('Total checks') ||
            line.startsWith('Check images') ||
            line.includes('Braille and Large Print') ||
            line.includes('Service fees')
          ) {
            inChecksSection = false;
            break;
          }

          if (line.startsWith('Date') || line.startsWith('Page ') || line.includes('! Account #')) {
            continue;
          }

          // Format: "07/09/26 214 -600.00"
          const match = line.match(/^(\d{2}\/\d{2}\/\d{2})\s+(\d+)\s+([-\$]?[\d,]+\.\d{2})$/);
          if (match) {
            const [, dateStr, checkNum, amtStr] = match;
            const isoDate = this.normalizeBofADate(dateStr);
            const amt = Math.abs(parseFloat(amtStr.replace(/[$,]/g, '')));

            account.transactions.push({
              date: isoDate,
              description: `Check #${checkNum}`,
              rawDescription: line,
              checkNumber: checkNum,
              amount: -amt, // check is a debit
              type: 'DEBIT'
            });
          }
        }
      }
    }
  }

  private normalizeBofADate(mmddyy: string): string {
    const [mm, dd, yy] = mmddyy.split('/');
    const fullYear = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
    return `${fullYear}-${mm}-${dd}`;
  }

  private monthNameToNumber(name: string): string {
    const months: Record<string, string> = {
      january: '01',
      jan: '01',
      february: '02',
      feb: '02',
      march: '03',
      mar: '03',
      april: '04',
      apr: '04',
      may: '05',
      june: '06',
      jun: '06',
      july: '07',
      jul: '07',
      august: '08',
      aug: '08',
      september: '09',
      sep: '09',
      october: '10',
      oct: '10',
      november: '11',
      nov: '11',
      december: '12',
      dec: '12'
    };
    return months[name.toLowerCase()] || '01';
  }
}
