# Agent & Developer Guide: Adding a New Bank Statement Parser

This guide provides a standardized, repeatable protocol for AI coding agents and human developers to onboard new bank statement layouts into the rule-based ingestion pipeline.

---

## 1. Overview

Rule-based parsers provide **instant, deterministic, 100% offline, zero-API-cost** parsing of digital bank statement PDFs.

Every parser must implement the `BankParser` interface:

```typescript
export interface BankParser {
  readonly id: string;                                // e.g. "wells-fargo-v1", "citi-v1"
  readonly name: string;                              // Human-readable bank name
  readonly stringHints: readonly (string | RegExp)[]; // Fast institutional signature markers
  parse(doc: ExtractedPdfDocument): BankStatement;
}
```

### Fast Centralized Routing with `matchesDocHints`
To avoid repeatedly performing expensive full-text searches or case conversions across dozens of parsers, the router (`BankRouter`) centrally evaluates `stringHints` (string literals or regular expressions) against the document using `matchesDocHints`:
- Strings are matched case-insensitively against precomputed uppercase text.
- RegExps are evaluated against the document text.

---

## 2. Step-by-Step Implementation Recipe

### Step 1: Inspect the New Sample PDF
Before writing code, inspect the text structure and layout lines extracted from the sample:

```bash
npx tsx -e '
import fs from "fs";
import { extractPdfDocument } from "./src/core/pdf-extractor.ts";

async function inspect() {
  const buf = fs.readFileSync("samples/YOUR_NEW_SAMPLE.pdf");
  const doc = await extractPdfDocument(buf);
  console.log("Pages:", doc.numPages);
  doc.pages.forEach((p, idx) => {
    console.log(`\n=== PAGE ${idx + 1} ===\n`, p.lines.join("\n"));
  });
}
inspect();
'
```

Key questions to answer from inspection:
1. **Bank Identification**: What unique strings/headers appear (e.g. `WELLSFARGO.COM`, `877-247-ALLY`, `CITI.COM`)? Define them in `stringHints`.
2. **Account Structure**: Does the statement contain multiple accounts (e.g., Checking + Savings summary) or a single account?
3. **Period & Date Format**: Are dates `MM/DD/YYYY`, `MM/DD/YY`, or `MM/DD`? (If `MM/DD`, extract statement years to infer full ISO dates).
4. **Table Layout**:
   - Single chronological table with running balance (like Chase)?
   - Split category sub-tables (like BofA: `Deposits`, `Other Subtractions`, `Checks`)?
   - Multi-line descriptions (merchant name on line 1, ACH metadata on line 2)?
5. **Reconciliation Math**: Note Opening Balance, Total Deposits, Total Withdrawals, and Ending Balance.

---

### Step 2: Create the Parser (`src/ingestors/rule-based/parsers/<bank>.ts`)

Use this standard boilerplate:

```typescript
import type { BankParser } from '../base.js';
import type {
  BankStatement,
  BankAccount,
  ExtractedPdfDocument,
  AccountType
} from '../../../core/types.js';
import { reconcileStatementAccounts } from '../../../core/reconciler.js';

export class YourBankParser implements BankParser {
  readonly id = 'yourbank-v1';
  readonly name = 'Your Bank Statement Parser';

  /**
   * Fast signature hints matching unique institutional markers.
   */
  readonly stringHints = [
    'YOURBANK.COM',
    '1-800-YOUR-BANK',
    'YOUR BANK NAME, N.A.'
  ] as const;

  parse(doc: ExtractedPdfDocument): BankStatement {
    const fullText = doc.fullText;

    // 1. Extract statement period
    const { periodStart, periodEnd, startYear, endYear } = this.extractPeriod(fullText);

    // 2. Discover accounts (single or multi-account)
    const accounts = this.extractAccounts(doc, startYear, endYear);

    // 3. Reconcile all accounts mathematically
    const reconciledAccounts = reconcileStatementAccounts(accounts);

    return {
      institution: 'Your Bank Name, N.A.',
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
    // Implement date period regex matching statement header
    const currentYear = new Date().getFullYear();
    // Return ISO dates: YYYY-MM-DD
    return { startYear: currentYear, endYear: currentYear };
  }

  private extractAccounts(
    doc: ExtractedPdfDocument,
    startYear: number,
    endYear: number
  ): BankAccount[] {
    // Extract accounts, summary balances, and transactions
    const account: BankAccount = {
      accountName: 'Checking Account',
      accountNumberMasked: '...XXXX',
      accountType: 'CHECKING',
      currency: 'USD',
      openingBalance: 0,
      closingBalance: 0,
      transactions: []
    };

    // Extract transaction lines & push to account.transactions
    return [account];
  }
}
```

---

### Step 3: Register in `src/ingestors/rule-based/router.ts`

Import and instantiate your parser in `BankRouter`:

```typescript
import { YourBankParser } from './parsers/yourbank.js';

export class BankRouter {
  constructor() {
    this.register(new ChaseBankParser());
    this.register(new BofABankParser());
    this.register(new YourBankParser()); // <-- Register here
  }
}
```

---

### Step 4: Write Automated Tests (`test/<bank>-parser.test.ts`)

> [!WARNING]
> **Data Privacy**: PDFs in `samples/` may contain personal data and must **NEVER** be committed or referenced in automated unit tests. Instead, create synthetic, anonymized `ExtractedPdfDocument` fixtures in `test/fixtures/mock-documents.ts`.

Create a unit test validating parsing and 100% balance reconciliation using mock fixtures:

```typescript
import { describe, it, expect } from 'vitest';
import { matchesDocHints } from '../src/ingestors/rule-based/base.js';
import { YourBankParser } from '../src/ingestors/rule-based/parsers/yourbank.js';
import { mockYourBankDocument } from './fixtures/mock-documents.js';

describe('YourBankParser', () => {
  const parser = new YourBankParser();

  it('matches stringHints for Your Bank statements', () => {
    expect(matchesDocHints(mockYourBankDocument, parser.stringHints)).toBe(true);
  });

  it('correctly parses statement and reconciles balances with 0 discrepancy', () => {
    const statement = parser.parse(mockYourBankDocument);
    expect(statement.institution).toBe('Your Bank Name, N.A.');
    expect(statement.accounts.length).toBeGreaterThanOrEqual(1);

    for (const acc of statement.accounts) {
      expect(acc.reconciliation?.isBalanced).toBe(true);
      expect(acc.reconciliation?.discrepancy).toBe(0);
    }
  });
});
```

---

## 3. Best Practices & Rules of Thumb

1. **Exact Currency Arithmetic**:
   Always let `reconcileStatementAccounts` compute final balances. Do not do floating point additions (`0.1 + 0.2`).
2. **Transaction Signs**:
   - Deposits / Income / Credits must have `type: 'CREDIT'` and **positive** `amount`.
   - Expenses / Debits / Withdrawals / Fees / Checks must have `type: 'DEBIT'` and **negative** `amount`.
3. **Institutional Markers in stringHints / RegExps**:
   Ensure common payee words (like `PURCHASE` matching `CHASE` or merchant names like `CAPITAL ONE` or transfer recipient `ALLY BANK`) do not cause false-positive router matches. Use institutional URLs, phone numbers, or word boundaries `/\b...\b/`.
4. **Multi-Line Continuations**:
   When parsing multi-line transaction descriptions, keep an active accumulator object until the next line matching a date pattern is encountered.
5. **Year Boundaries (December to January)**:
   If a statement spans `Dec 15, 2025` to `Jan 14, 2026`, ensure transactions with month `12` get year `2025` and month `01` get year `2026`.
