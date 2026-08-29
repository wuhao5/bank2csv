import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  ExtractedPdfDocument,
  AccountType
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class ChaseBankParser implements BankParser {
  readonly id = 'chase-v1';
  readonly name = 'JPMorgan Chase Bank Parser';

  canHandle(doc: ExtractedPdfDocument): boolean {
    const text = doc.fullText.toUpperCase();
    return (
      (text.includes('CHASE') && (text.includes('JPMORGAN CHASE BANK') || text.includes('CHASE.COM'))) ||
      text.includes('CHASE TOTAL CHECKING') ||
      text.includes('CHASE SAVINGS')
    );
  }

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract statement period
    const { periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Discover accounts from Consolidated Balance Summary table
    const accountsMap = new Map<string, BankAccount>();
    this.extractConsolidatedSummary(fullText, accountsMap);

    // 3. Extract Checking Account details and transactions
    this.extractCheckingAccount(doc, accountsMap, startYear, endYear);

    // 4. Extract Savings Account details
    this.extractSavingsAccount(doc, accountsMap);

    // Fallback if no accounts detected
    if (accountsMap.size === 0) {
      const primaryMatch = fullText.match(/Primary Account:\s*(\d+)/i);
      const accNum = primaryMatch ? primaryMatch[1] : 'UNKNOWN';
      accountsMap.set(accNum, {
        accountName: 'Chase Account',
        accountNumberMasked: accNum,
        accountType: 'CHECKING',
        currency: 'USD',
        transactions: []
      });
    }

    const accounts = Array.from(accountsMap.values());
    const reconciledAccounts = reconcileStatementAccounts(accounts);

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
    const periodMatch = text.match(
      /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+through\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i
    );

    if (periodMatch) {
      const [, startMonthStr, startDay, startYr, endMonthStr, endDay, endYr] = periodMatch;
      const startMonth = this.monthNameToNumber(startMonthStr);
      const endMonth = this.monthNameToNumber(endMonthStr);
      const startYearNum = parseInt(startYr, 10);
      const endYearNum = parseInt(endYr, 10);

      const periodStart = `${startYearNum}-${startMonth.padStart(2, '0')}-${startDay.padStart(2, '0')}`;
      const periodEnd = `${endYearNum}-${endMonth.padStart(2, '0')}-${endDay.padStart(2, '0')}`;

      return { periodStart, periodEnd, startYear: startYearNum, endYear: endYearNum };
    }

    return { startYear: currentYear, endYear: currentYear };
  }

  private extractConsolidatedSummary(text: string, accountsMap: Map<string, BankAccount>): void {
    // Matches: Chase Total Checking 123456789012345 $8,075.31 $8,774.65
    // or: Chase Savings 123456789012345 523.40 523.40
    const summaryRegex = /(Chase\s+(?:Total\s+)?(?:Checking|Savings|Premier|Sapphire|Business))\s+(\d{9,17})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/gi;
    let match: RegExpExecArray | null;

    while ((match = summaryRegex.exec(text)) !== null) {
      const [, name, accNum, openBalStr, closeBalStr] = match;
      const openingBalance = parseFloat(openBalStr.replace(/,/g, ''));
      const closingBalance = parseFloat(closeBalStr.replace(/,/g, ''));
      const accountType: AccountType = name.toLowerCase().includes('savings') ? 'SAVINGS' : 'CHECKING';

      accountsMap.set(accNum, {
        accountName: name.trim(),
        accountNumberMasked: accNum,
        accountType,
        currency: 'USD',
        openingBalance,
        closingBalance,
        transactions: []
      });
    }
  }

  private extractCheckingAccount(
    doc: ExtractedPdfDocument,
    accountsMap: Map<string, BankAccount>,
    startYear: number,
    endYear: number
  ): void {
    let checkingAccNum: string | null = null;

    // Find checking account number from page header or map
    for (const page of doc.pages) {
      const m = page.text.match(/CHASE\s+TOTAL\s+CHECKING[\s\S]{1,100}?Account Number:\s*(\d+)/i);
      if (m) {
        checkingAccNum = m[1];
        break;
      }
    }

    if (!checkingAccNum) {
      for (const [num, acc] of accountsMap.entries()) {
        if (acc.accountType === 'CHECKING') {
          checkingAccNum = num;
          break;
        }
      }
    }

    if (!checkingAccNum) return;

    let account = accountsMap.get(checkingAccNum);
    if (!account) {
      account = {
        accountName: 'Chase Total Checking',
        accountNumberMasked: checkingAccNum,
        accountType: 'CHECKING',
        currency: 'USD',
        transactions: []
      };
      accountsMap.set(checkingAccNum, account);
    }

    // Extract checking summary figures
    const checkSummaryMatch = doc.fullText.match(
      /CHECKING\s+SUMMARY[\s\S]{1,200}?Beginning Balance\s+\$?([\d,]+\.\d{2})[\s\S]{1,100}?(?:Deposits and Additions\s+([\d,]+\.\d{2}))?[\s\S]{1,100}?Ending Balance\s+\$?([\d,]+\.\d{2})/i
    );
    if (checkSummaryMatch) {
      if (checkSummaryMatch[1]) account.openingBalance = parseFloat(checkSummaryMatch[1].replace(/,/g, ''));
      if (checkSummaryMatch[2]) account.totalDeposits = parseFloat(checkSummaryMatch[2].replace(/,/g, ''));
      if (checkSummaryMatch[3]) account.closingBalance = parseFloat(checkSummaryMatch[3].replace(/,/g, ''));
    }

    // Extract Transactions under TRANSACTION DETAIL
    const txLines: string[] = [];
    let inTxSection = false;

    for (const page of doc.pages) {
      for (const line of page.lines) {
        if (line.includes('TRANSACTION DETAIL')) {
          inTxSection = true;
          continue;
        }
        if (inTxSection) {
          if (
            line.startsWith('You were not charged') ||
            line.startsWith('CHASE SAVINGS') ||
            line.startsWith('SAVINGS SUMMARY') ||
            line.includes('IN CASE OF ERRORS') ||
            line.includes('*start*post transaction detail message')
          ) {
            inTxSection = false;
            break;
          }
          txLines.push(line);
        }
      }
    }

    // Parse transaction lines:
    // Format: "07/17 ACME CORP Payroll PPD ID: 123456789 200.00 8,275.31"
    const txRegex = /^(\d{2}\/\d{2})\s+(.+?)\s+([-\$]?[\d,]+\.\d{2})(?:\s+\$?([\d,]+\.\d{2}))?$/;

    let previousBalance = account.openingBalance ?? 0;

    for (const rawLine of txLines) {
      const line = rawLine.trim();
      if (
        line.startsWith('DATE') ||
        line.startsWith('Beginning Balance') ||
        line.startsWith('Ending Balance') ||
        line.startsWith('*')
      ) {
        continue;
      }

      const match = line.match(txRegex);
      if (match) {
        const [, dateMMDD, desc, amtStr, balStr] = match;
        const [mm, dd] = dateMMDD.split('/');
        const monthNum = parseInt(mm, 10);
        const year = monthNum >= 10 && startYear < endYear ? startYear : endYear;
        const isoDate = `${year}-${mm}-${dd}`;

        const rawAmt = parseFloat(amtStr.replace(/[$,]/g, ''));
        const runningBal = balStr ? parseFloat(balStr.replace(/[$,]/g, '')) : undefined;

        let isCredit = true;
        if (rawAmt < 0 || amtStr.startsWith('-')) {
          isCredit = false;
        } else if (runningBal !== undefined) {
          isCredit = runningBal >= previousBalance;
        }

        const signedAmount = isCredit ? Math.abs(rawAmt) : -Math.abs(rawAmt);
        if (runningBal !== undefined) {
          previousBalance = runningBal;
        }

        account.transactions.push({
          date: isoDate,
          description: desc.trim(),
          rawDescription: line,
          amount: signedAmount,
          type: isCredit ? 'CREDIT' : 'DEBIT',
          runningBalance: runningBal
        });
      }
    }
  }

  private extractSavingsAccount(doc: ExtractedPdfDocument, accountsMap: Map<string, BankAccount>): void {
    let savingsAccNum: string | null = null;

    for (const page of doc.pages) {
      const m = page.text.match(/CHASE\s+SAVINGS[\s\S]{1,100}?Account Number:\s*(\d+)/i);
      if (m) {
        savingsAccNum = m[1];
        break;
      }
    }

    if (!savingsAccNum) {
      for (const [num, acc] of accountsMap.entries()) {
        if (acc.accountType === 'SAVINGS') {
          savingsAccNum = num;
          break;
        }
      }
    }

    if (!savingsAccNum) return;

    let account = accountsMap.get(savingsAccNum);
    if (!account) {
      account = {
        accountName: 'Chase Savings',
        accountNumberMasked: savingsAccNum,
        accountType: 'SAVINGS',
        currency: 'USD',
        transactions: []
      };
      accountsMap.set(savingsAccNum, account);
    }

    const summaryMatch = doc.fullText.match(
      /SAVINGS\s+SUMMARY[\s\S]{1,200}?Beginning Balance\s+\$?([\d,]+\.\d{2})[\s\S]{1,100}?Ending Balance\s+\$?([\d,]+\.\d{2})/i
    );
    if (summaryMatch) {
      account.openingBalance = parseFloat(summaryMatch[1].replace(/,/g, ''));
      account.closingBalance = parseFloat(summaryMatch[2].replace(/,/g, ''));
    }
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
