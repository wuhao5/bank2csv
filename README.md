# Bank Statement to CSV Parser (TypeScript)

A TypeScript library and CLI tool that parses bank statement PDFs and image scans (including multi-account statements) and converts them into normalized CSV transaction lists with automated mathematical balance reconciliation.

---

## Key Features

- **Dual Ingestion Architecture**:
  - **Deterministic Rule-Based Ingestors**: Fast, 100% offline, zero-API-cost parsers for supported banks (`Chase`, `Bank of America`).
  - **Local OCR Extraction (`tesseract.js`)**: Pure JavaScript / WebAssembly OCR for image-based statements (`.png`, `.jpg`, `.jpeg`, `.tiff`) and scanned PDFs running completely offline without external binaries or cloud dependencies.
  - **Direct AI Ingestor (Multimodal)**: Ingests raw PDF bytes directly with Gemini Flash (`--ai`), bypassing OCR/routing for unsupported banks or phone photos.
- **Multi-Account Statements**: Automatically segregates multiple accounts in a single PDF (e.g., Checking + Savings in a Chase consolidated statement).
- **Exact Balance Reconciliation**: Validates that $\text{Opening Balance} + \sum \text{Credits} - \sum \text{Debits} = \text{Closing Balance}$ using `decimal.js`. Flags any discrepancy or missed transaction.
- **Multi-Format CSV Export**:
  - Unified CSV (with Account columns) or split per-account CSV files (`--split`).
  - Presets for **Standard**, **YNAB** (You Need A Budget), and **QuickBooks**.
- **Agent & Developer Guide**: Standardized recipe and boilerplate in [`src/ingestors/rule-based/GUIDE.md`](./src/ingestors/rule-based/GUIDE.md) to quickly add new bank layouts.

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

// 1. Parse statement (digital, scanned with OCR, or AI)
const statement = await parseStatement(pdfBuffer, { useOcr: false });

console.log(statement.institution); // "JPMorgan Chase Bank, N.A."
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
