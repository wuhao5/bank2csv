# Bank & Credit Card Statement to CSV Parser (TypeScript)

A TypeScript library and CLI tool that parses bank and credit card statement PDFs/scans (including multi-account statements and multi-cardholder statements) and converts them into normalized CSV transaction lists with automated mathematical balance reconciliation.

---

## Supported Banks & Statement Types

1. **JPMorgan Chase**:
   - Checking & Savings statements (`Chase Total Checking`, `Chase Savings` in consolidated multi-account statements)
   - Credit Card statements (`Chase Freedom Unlimited`, `Sapphire`, `Ink`, etc.)
2. **Bank of America**:
   - Checking & Savings statements with category subtables (`Deposits`, `Other Subtractions`, `Checks`) and multi-line descriptions
3. **Capital One**:
   - Credit Card statements (`Venture X Card`, `Quicksilver`, `Savor`, etc.) with **multi-cardholder / authorized user transaction segmentation**
4. **Local Tesseract.js OCR**:
   - Offline pure JS/WASM OCR for image statements (`.png`, `.jpg`, `.jpeg`, `.tiff`) and scanned PDFs
5. **Direct Multimodal AI Ingestor**:
   - Optional Gemini Flash ingestion (`--ai`) for unsupported banks or photos of paper receipts/bills

---

## Installation & Setup

```bash
pnpm install
pnpm build
```

---

## CLI Usage

### Parse statements in a directory or single file:
```bash
# Parse all PDFs/images in a directory and generate unified CSVs
pnpm start parse ./samples --output ./out

# Split multi-account statements into individual per-account CSVs
pnpm start parse ./samples --output ./out --split

# Use local Tesseract.js OCR for image-based statements
pnpm start parse ./samples --output ./out --ocr

# Use YNAB preset format
pnpm start parse ./samples --output ./out --preset ynab

# Use Direct AI Ingestion (requires GEMINI_API_KEY)
export GEMINI_API_KEY="your-api-key"
pnpm start parse ./samples --output ./out --ai
```

### CLI Options:
| Flag | Description | Default |
| :--- | :--- | :--- |
| `-o, --output <dir>` | Directory to save generated CSV files | `./output` |
| `-p, --preset <preset>` | CSV format: `standard` \| `ynab` \| `quickbooks` | `standard` |
| `-s, --split` | Generate separate CSV files for each bank account | `false` |
| `--ocr` | Run local Tesseract.js OCR on scanned image statements | `false` |
| `--ai` | Use Direct Multimodal AI Ingestion | `false` |
| `-v, --verbose` | Show verbose reconciliation diagnostics | `false` |

---

## Programmatic API

```typescript
import { parseStatement, exportToUnifiedCsv, exportToSplitCsv } from 'bank-stmt';
import fs from 'fs';

const pdfBuffer = fs.readFileSync('statement.pdf');

// 1. Parse statement (bank, credit card, OCR, or AI)
const statement = await parseStatement(pdfBuffer);

console.log(statement.institution); // "Capital One, N.A."
console.log(statement.accounts[0].reconciliation?.isBalanced); // true

// 2. Export to CSV
const csv = exportToUnifiedCsv(statement, 'standard');
const splitCsvs = exportToSplitCsv(statement, 'ynab');
```

---

## Adding New Banks

See [`src/ingestors/rule-based/GUIDE.md`](./src/ingestors/rule-based/GUIDE.md) for the step-by-step developer and AI agent recipe for onboarding new bank layouts and writing tests.

---

## Running Tests

```bash
./node_modules/.bin/vitest run
```
