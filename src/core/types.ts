import { z } from 'zod';

export const BankTransactionSchema = z.object({
  date: z.string().describe('ISO YYYY-MM-DD date of transaction'),
  postDate: z.string().optional().describe('ISO YYYY-MM-DD posting date if different'),
  description: z.string().describe('Cleaned, readable merchant or transaction description'),
  rawDescription: z.string().optional().describe('Original multi-line or raw description from statement'),
  amount: z.number().describe('Signed amount: negative for debits/expenses/withdrawals, positive for deposits/credits'),
  type: z.enum(['DEBIT', 'CREDIT']),
  checkNumber: z.string().optional().describe('Check number if transaction was a check'),
  runningBalance: z.number().optional().describe('Running balance after transaction, if present'),
  category: z.string().optional().describe('Inferred or stated transaction category')
});

export type BankTransaction = z.infer<typeof BankTransactionSchema>;

export const ReconciliationResultSchema = z.object({
  isBalanced: z.boolean().describe('True if opening balance + credits - debits equals closing balance within 0.01 tolerance'),
  openingBalance: z.number(),
  closingBalance: z.number(),
  totalCredits: z.number(),
  totalDebits: z.number(),
  calculatedClosingBalance: z.number(),
  discrepancy: z.number().describe('Calculated closing balance minus reported closing balance'),
  notes: z.array(z.string()).optional()
});

export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;

export const AccountTypeSchema = z.enum([
  'CHECKING',
  'SAVINGS',
  'CREDIT_CARD',
  'MONEY_MARKET',
  'LOAN',
  'INVESTMENT',
  'OTHER'
]);

export type AccountType = z.infer<typeof AccountTypeSchema>;

export const BankAccountSchema = z.object({
  accountName: z.string().describe('Account name or product type, e.g. Chase Total Checking'),
  accountNumberMasked: z.string().describe('Masked or full account number, e.g. ...9729'),
  accountType: AccountTypeSchema.default('CHECKING'),
  currency: z.string().default('USD'),
  openingBalance: z.number().optional(),
  closingBalance: z.number().optional(),
  totalDeposits: z.number().optional(),
  totalWithdrawals: z.number().optional(),
  transactions: z.array(BankTransactionSchema).default([]),
  reconciliation: ReconciliationResultSchema.optional()
});

export type BankAccount = z.infer<typeof BankAccountSchema>;

export const BankStatementSchema = z.object({
  institution: z.string().describe('Bank name or financial institution, e.g. JPMorgan Chase Bank, N.A.'),
  ingestor: z.enum(['rule-based', 'ai-direct']),
  parserId: z.string().optional().describe('Identifier of the parser used, e.g. chase-v1 or gemini-2.5-flash'),
  statementDate: z.string().optional().describe('ISO YYYY-MM-DD statement generation date'),
  periodStart: z.string().optional().describe('ISO YYYY-MM-DD start of statement cycle'),
  periodEnd: z.string().optional().describe('ISO YYYY-MM-DD end of statement cycle'),
  accounts: z.array(BankAccountSchema).min(1).describe('Accounts contained within the statement')
});

export type BankStatement = z.infer<typeof BankStatementSchema>;

/**
 * Text extraction representations for deterministic PDF parsing
 */
export interface ExtractedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  lines: string[];
  items: ExtractedTextItem[];
}

export interface ExtractedPdfDocument {
  numPages: number;
  fullText: string;
  pages: ExtractedPage[];
}

export type CsvPreset = 'standard' | 'ynab' | 'quickbooks';

export interface CsvExportOptions {
  preset?: CsvPreset;
  splitByAccount?: boolean;
  includeAccountColumn?: boolean;
}
