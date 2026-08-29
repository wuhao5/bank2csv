import { GoogleGenAI } from '@google/genai';
import type { BankStatement } from '../../core/types.js';
import { BankStatementSchema } from '../../core/types.js';
import { BankStatementJsonSchema } from './schema.js';
import { reconcileStatementAccounts } from '../../core/reconciler.js';

export interface GeminiIngestorOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Direct Multimodal AI Ingestor powered by Gemini.
 * Directly ingests raw PDF bytes or image files and extracts structured multi-account statements.
 */
export async function parseStatementWithGemini(
  pdfBuffer: Uint8Array | Buffer,
  options: GeminiIngestorOptions = {}
): Promise<BankStatement> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set in environment variables or options.\n' +
        'Please export GEMINI_API_KEY="your-api-key" to use AI direct ingestion.'
    );
  }

  const modelName = options.model || 'gemini-2.5-flash';
  const ai = new GoogleGenAI({ apiKey });

  const base64Data =
    pdfBuffer instanceof Buffer
      ? pdfBuffer.toString('base64')
      : Buffer.from(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength).toString('base64');

  const systemPrompt = `You are a high-precision financial document parser.
Analyze this bank statement PDF/document and extract all financial data accurately:
1. Identify all separate accounts in the statement (e.g. Checking, Savings, Credit Cards). Do not mix up transactions between accounts.
2. Extract exact opening and closing balances for each account.
3. Extract all individual transaction lines for each account with:
   - ISO Date (YYYY-MM-DD)
   - Clean, readable description
   - Signed Amount: Negative number for all debits/expenses/withdrawals/checks/fees; Positive number for deposits/income/credits.
   - Type: 'DEBIT' or 'CREDIT'.
   - Running balance if present.
   - Check number if it is a check transaction.
4. Ensure all transactions are captured without skipping any rows.`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: base64Data
            }
          },
          {
            text: systemPrompt
          }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: BankStatementJsonSchema
    }
  });

  const responseText = response.text;
  if (!responseText) {
    throw new Error('Gemini returned an empty response.');
  }

  const parsedJson = JSON.parse(responseText);

  // Validate and normalize through Zod schema
  const rawStatement = {
    institution: parsedJson.institution || 'Unknown Financial Institution',
    ingestor: 'ai-direct' as const,
    parserId: `gemini-${modelName}`,
    statementDate: parsedJson.statementDate,
    periodStart: parsedJson.periodStart,
    periodEnd: parsedJson.periodEnd,
    accounts: (parsedJson.accounts || []).map((acc: any) => ({
      accountName: acc.accountName || 'Bank Account',
      accountNumberMasked: acc.accountNumberMasked || 'UNKNOWN',
      accountType: acc.accountType || 'CHECKING',
      currency: acc.currency || 'USD',
      openingBalance: acc.openingBalance,
      closingBalance: acc.closingBalance,
      totalDeposits: acc.totalDeposits,
      totalWithdrawals: acc.totalWithdrawals,
      transactions: (acc.transactions || []).map((tx: any) => ({
        date: tx.date,
        postDate: tx.postDate,
        description: tx.description,
        rawDescription: tx.rawDescription,
        amount: Number(tx.amount),
        type: tx.type === 'DEBIT' || Number(tx.amount) < 0 ? ('DEBIT' as const) : ('CREDIT' as const),
        checkNumber: tx.checkNumber,
        runningBalance: tx.runningBalance,
        category: tx.category
      }))
    }))
  };

  const validated = BankStatementSchema.parse(rawStatement);

  // Reconcile accounts mathematically
  validated.accounts = reconcileStatementAccounts(validated.accounts);

  return validated;
}
