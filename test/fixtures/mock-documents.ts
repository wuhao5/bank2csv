import type { ExtractedPdfDocument } from '../../src/core/types.js';

function createMockDoc(pagesText: string[]): ExtractedPdfDocument {
  const pages = pagesText.map((text, idx) => ({
    pageNumber: idx + 1,
    text,
    lines: text.split('\n').map((l) => l.trim()).filter(Boolean),
    items: []
  }));

  return {
    numPages: pages.length,
    fullText: pagesText.join('\n\n--- PAGE BREAK ---\n\n'),
    pages
  };
}

export const mockChaseCheckingDocument: ExtractedPdfDocument = createMockDoc([
  `July 17, 2026 through August 18, 2026
JPMorgan Chase Bank, N.A.
Chase.com
Primary Account: 000000123456789
CONSOLIDATED BALANCE SUMMARY
ASSETS
Checking & Savings ACCOUNT BEGINNING BALANCE ENDING BALANCE
Chase Total Checking 000000123456789 $5,000.00 $5,400.00
Chase Savings 000000987654321 $1,000.00 $1,000.00
TOTAL ASSETS $6,000.00 $6,400.00
CHASE TOTAL CHECKING
Account Number: 000000123456789
CHECKING SUMMARY
Beginning Balance $5,000.00
Deposits and Additions 400.00
Ending Balance $5,400.00
TRANSACTION DETAIL
DATE DESCRIPTION AMOUNT BALANCE
Beginning Balance $5,000.00
07/17 SAMPLE EMPLOYER PAYROLL 200.00 5,200.00
07/31 SAMPLE EMPLOYER PAYROLL 200.00 5,400.00
Ending Balance $5,400.00`,

  `CHASE SAVINGS
Account Number: 000000987654321
SAVINGS SUMMARY
Beginning Balance $1,000.00
Ending Balance $1,000.00`
]);

export const mockBofADocument: ExtractedPdfDocument = createMockDoc([
  `Bank of America, N.A.
bankofamerica.com
Your Adv Plus Banking
for July 1, 2026 to July 31, 2026 Account number: 0004 1234 5678
Account summary
Beginning balance on July 1, 2026 $10,000.00
Deposits and other additions 5,000.00
Other subtractions -3,000.00
Checks -500.00
Ending balance on July 31, 2026 $11,500.00`,

  `IMPORTANT INFORMATION: BANK DEPOSIT ACCOUNTS`,

  `Deposits and other additions
Date Description Amount
07/02/26 SAMPLE PAYROLL DIRECT DEPOSIT 5,000.00
Total deposits and other additions $5,000.00
Withdrawals and other subtractions
Other subtractions
Date Description Amount
07/05/26 ELECTRIC UTILITY BILL ACH -1,000.00
07/15/26 ONLINE STORE PURCHASE -2,000.00
Total other subtractions -$3,000.00`,

  `Checks
Date Check # Amount
07/20/26 101 -500.00
Total checks -$500.00`
]);

export const mockChaseCreditCardPersonalDocument: ExtractedPdfDocument = createMockDoc([
  `www.chase.com/cardhelp
CHASE FREEDOM UNLIMITED
ACCOUNT SUMMARY
Account Number: XXXX XXXX XXXX 1111
Previous Balance $0.00
Payment, Credits $0.00
Purchases +$75.50
New Balance $75.50
Opening/Closing Date 02/14/26 - 03/13/26
Credit Limit $10,000`,

  `ACCOUNT ACTIVITY
Date of
Transaction Merchant Name or Transaction Description $ Amount
PURCHASE
02/20 TRANSIT FARE PASS 25.00
02/28 PHARMACY STORE 50.50`
]);

export const mockChaseCreditCardBusinessDocument: ExtractedPdfDocument = createMockDoc([
  `www.chase.com/cardhelp
CHASE ULTIMATE REWARDS
ACCOUNT SUMMARY
Account Number: XXXX XXXX XXXX 5555
Previous Balance $2,000.00
Payment, Credits -$2,000.00
Purchases +$3,500.00
New Balance $3,500.00
Opening/Closing Date 07/13/26 - 08/12/26
Revolving Credit Amount $25,000`,

  `ACCOUNT ACTIVITY
Date of
Transaction Merchant Name or Transaction Description $ Amount
08/06 AUTOMATIC PAYMENT - THANK YOU -2,000.00
07/15 OFFICE SUPPLIES STORE 1,500.00
07/20 CLOUD HOSTING SERVICE 1,000.00
ALICE SMITH
TRANSACTIONS THIS CYCLE (CARD 5555) $500.00
07/22 SOFTWARE SUBSCRIPTION 1,000.00
BOB SMITH
TRANSACTIONS THIS CYCLE (CARD 6666) $1000.00`
]);

export const mockCapitalOneCreditCardDocument: ExtractedPdfDocument = createMockDoc([
  `capitalone.com
Venture X Card | Visa Infinite ending in 8888
Jul 15, 2026 - Aug 14, 2026 | 31 days in Billing Cycle
Account Summary
Previous Balance $1,500.00
Payments - $1,500.00
Transactions + $2,200.00
New Balance = $2,200.00`,

  `Transactions
ALICE SMITH #8888: Payments, Credits and Adjustments
Trans Date Post Date Description Amount
Jul 20 Jul 20 ONLINE PAYMENT - $1,500.00
ALICE SMITH #8888: Transactions
Trans Date Post Date Description Amount
Jul 17 Jul 17 GROCERY STORE $1,200.00
BOB SMITH #9999: Transactions
Trans Date Post Date Description Amount
Jul 25 Jul 26 HARDWARE STORE $1,000.00`
]);
