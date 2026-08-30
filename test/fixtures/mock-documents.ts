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

export const mockAllyStatementDocument: ExtractedPdfDocument = createMockDoc([
  `COMBINED CUSTOMER STATEMENT
Ally Bank
Statement Date 08/15/2026
Page 1
Customer Care Information
Toll Free 877-247-ALLY (2559)
www.ally.com
ACME TEST USER
100 MAIN STREET
ANYTOWN CA 94000
CUSTOMER STATEMENT
Account Name Account Number Beginning Balance Ending Balance
Interest Checking xxxxxx1234 $1,000.00 $1,500.00
Online Savings Account xxxxxx5678 $10,000.00 $12,050.00
Total Account Balances: $11,000.00 $13,550.00
Ally Bank Member FDIC STMTCMB100 05/2013`,

  `COMBINED CUSTOMER STATEMENT
Statement Date
08/15/2026
Page 2
Customer Care Information
Toll Free 877-247-ALLY (2559)
Interest Checking www.ally.com
Summary For: ACME TEST USER
Account Number: xxxxxx1234 Open Date: 01/15/2021
Product: Interest Checking Account Ownership: Individual
Summary
Beginning Balance, as of 07/16/2026 $1,000.00 Days In Statement Period 31
Deposits and Other Credits $1,200.00 Annual Percentage Yield Earned 0.10%
Interest Paid This Period $0.50 Average Daily Balance This Period $1,200.00
Withdrawals and Other Debits -$700.50
Ending Balance, as of 08/15/2026 $1,500.00
Activity
Date Description Credits Debits Balance
07/16/2026 Beginning Balance $1,000.00
07/20/2026 Direct Deposit $1,200.00 -$0.00 $2,200.00
EMPLOYER PAYROLL DIRECT DEPOSIT
07/25/2026 ACH Withdrawal $0.00 -$200.50 $1,999.50
ELECTRIC UTILITY BILL
08/01/2026 Check $0.00 -$500.00 $1,499.50
Check Paid #101
08/15/2026 Interest Paid $0.50 -$0.00 $1,500.00
08/15/2026 Ending Balance $1,500.00
Ally Bank Member FDIC STMTCMB100 05/2013`,

  `COMBINED CUSTOMER STATEMENT
Statement Date
08/15/2026
Page 3
Customer Care Information
Toll Free 877-247-ALLY (2559)
Online Savings Account www.ally.com
Summary For: ACME TEST USER
Account Number: xxxxxx5678 Open Date: 01/15/2021
Product: Online Savings Account Account Ownership: Individual
Summary
Beginning Balance, as of 07/16/2026 $10,000.00 Days In Statement Period 31
Deposits and Other Credits $2,000.00 Annual Percentage Yield Earned 0.50%
Interest Paid This Period $50.00 Average Daily Balance This Period $11,000.00
Withdrawals and Other Debits $0.00
Ending Balance, as of 08/15/2026 $12,050.00
Activity
Date Description Credits Debits Balance
07/16/2026 Beginning Balance $10,000.00
07/18/2026 ACH Deposit $2,000.00 -$0.00 $12,000.00
EXTERNAL TRANSFER FROM MAIN CHECKING
08/15/2026 Interest Paid $50.00 -$0.00 $12,050.00
08/15/2026 Ending Balance $12,050.00
Ally Bank Member FDIC STMTCMB100 05/2013`
]);

export const mockWellsFargoCheckingDocument: ExtractedPdfDocument = createMockDoc([
  `Wells Fargo Everyday Checking
September 16, 2026 Page 1 of 3
Online: wellsfargo.com
Write: Wells Fargo Bank, N.A. (114)
Statement period activity summary Account number: 7361701234
Beginning balance on 8/16 $5,000.00
Deposits/Additions 2,500.00
Withdrawals/Subtractions - 1,500.00
Ending balance on 9/16 $6,000.00`,

  `September 16, 2026 Page 2 of 3
Transaction history
Check Deposits/ Withdrawals/ Ending daily
Date Number Description Additions Subtractions balance
8/20 Salary Direct Deposit Payroll 2,500.00 7,500.00
8/25 101 Check 500.00 7,000.00
9/05 Utility Payment Online 1,000.00 6,000.00
Ending balance on 9/16 6,000.00
Totals $2,500.00 $1,500.00`
]);

export const mockWellsFargoSavingsDocument: ExtractedPdfDocument = createMockDoc([
  `Wells Fargo Way2Save Savings
January 31, 2026 Page 1 of 2
Online: wellsfargo.com
Write: Wells Fargo Bank, N.A. (114)
Statement period activity summary Account number: 7296535678
Beginning balance on 1/1 $10,000.00
Deposits/Additions 10.50
Withdrawals/Subtractions - 2,000.00
Ending balance on 1/31 $8,010.50`,

  `January 31, 2026 Page 2 of 2
Transaction history
Deposits/ Withdrawals/ Ending daily
Date Description Additions Subtractions balance
1/15 Online Transfer to Checking 2,000.00 8,000.00
1/31 Interest Payment 10.50 8,010.50
Ending balance on 1/31 8,010.50
Totals $10.50 $2,000.00`
]);

export const mockUSBankCheckingDocument: ExtractedPdfDocument = createMockDoc([
  `Wealth Management
Uni- Statement
Account Number:
1 575 2213 1234
Statement Period :
Jan 14, 2026
through
Feb 11, 2026
Page 1 of 2
U.S. BANK PLATINUM CHECKING Member FDIC
U.S. Bank National Association Account Number 1-575-2213-1234
Account Summary
Beginning Balance on Jan 14 $ 1,000.00
Deposits / Credits 3,000.50
Other Withdrawals 1,500.00 -
Ending Balance on Feb 11, 2026 $ 2,500.50
Deposits / Credits
Date Description of Transaction Ref Number Amount
Jan 20 Direct Deposit Payroll $ 3,000.00
Feb 11 Interest Paid 1100036838 0.50
Total Deposits / Credits $ 3,000.50
Other Withdrawals
Date Description of Transaction Ref Number Amount
Jan 25 Electronic Withdrawal Mortgage $ 1,500.00 -
REF=1234567890 TRANSFER
Total Other Withdrawals $ 1,500.00 -`
]);

export const mockTargetRedCardDocument: ExtractedPdfDocument = createMockDoc([
  `RedCardEndingin:1234
AccountIdentificationNumber:00012345678 StatementClosingDate: July16,2026
SummaryofAccountActivity PaymentInformation
PreviousBalance $100.00 NewBalance $150.00
PaymentsandOtherCredits -$100.00
PurchasesandOtherDebits +$150.00
NewBalance $150.00
DaysinBillingCycle 30
ManageMyRedCard Target.com/myRedCard
TargetCardServices 1-800-424-6888
Transactions
TransDate DescriptionofTransactionorCredit Location Amount
PaymentsAndOtherCredits
Jun.20 E-PAYMENT,TARGET.COM -$100.00
TOTALPAYMENTSANDOTHERCREDITSFORTHISPERIOD -$100.00`,

  `RedCardEndingin:1234
StatementClosingDate: July16,2026
Transactions(cont.)
TransDate DescriptionofTransactionorCredit Location Amount
PurchasesAndOtherDebits
Jun.25 TARGET STORE 0001 SUNNYVALE,CA $100.00
Jul.02 TARGET STORE 0002 MOUNTAINVIEW,CA $50.00
TOTALPURCHASESANDOTHERDEBITSFORTHISPERIOD $150.00
TD Bank USA, N.A.`
]);

export const mockSFCUDocument: ExtractedPdfDocument = createMockDoc([
  `Member Number: 12345678
Statement Date: 08-31-2026
Page: 1 of 2
Stanford Federal Credit Union | sfcu.org
ACCOUNT SUMMARY
Basic Checking $3,000.00 Auto Used Fixed $20,000.00
BASIC CHECKING (CHECKING) xxxxxx1234
Beginning Balance: $2,000.00 Dividend Period: 08-01-2026 to 08-31-2026
Deposits: $2,000.00
Withdrawals: $1,000.00
Ending Balance: $3,000.00
TRANSACTIONS
Posted Effective
Date Date Description Withdrawals Deposit Balance
Beginning Balance $2,000.00
08/05 08/05 ACH Credit EMPLOYER PAYROLL 2,000.00 $4,000.00
08/10 08/10 Withdrawal Online Transfer 1,000.00 $3,000.00
Ending Balance $3,000.00`,

  `Member Number: 12345678
Statement Date: 08-31-2026
Page: 2 of 2
AUTO USED FIXED - 2020 MODEL 3 (CONSUMER LOAN) xxxxxx5678
Beginning Balance: $20,500.00
Ending Balance: $20,000.00
TRANSACTIONS
Payments
Date Effective Transaction Credit, or Finance Fee or Late
Posted Date Description Amount Debits Charge Charges Balance
Previous Balance $20,500.00
08/15 08/15 Regular Payment 550.00 500.00 50.00 0.00 20,000.00
Ending Balance $20,000.00
Stanford Federal Credit Union | sfcu.org`
]);

export const mockMarcusDocument: ExtractedPdfDocument = createMockDoc([
  `Statement Period
Goldman Sachs Bank USA 04/01/2026 to 04/30/2026
PO Box 70379 Page 1 of 1
Marcus.com
ONLINE SAVINGS ACCOUNT STATEMENT
Account Number 300012345678
Account Name Online Savings
STATEMENT SUMMARY as of 04/30/2026
Beginning Balance $50,000.00
Deposits and Other Credits $500.00
Withdrawals and Other Debits $1,000.00
Ending Balance $49,500.00
ACCOUNT ACTIVITY
Date Description Credits Debits Balance
04/01/2026 Beginning Balance $50,000.00
04/10/2026 ACH Withdrawal CREDIT CARD PAYMENT $1,000.00 $49,000.00
04/30/2026 Interest Paid $500.00 $49,500.00
04/30/2026 Ending Balance $49,500.00
Explore the Marcus Resource Center`
]);

