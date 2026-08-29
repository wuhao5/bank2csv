import fs from 'fs';
import path from 'path';
import type { BankStatement, CsvPreset, ExtractedPdfDocument } from './core/types.js';
import { extractPdfDocument } from './core/pdf-extractor.js';
import { extractDocumentFromImages, extractTextFromImage, isScannedOrImageOnly } from './core/ocr-extractor.js';
import { defaultRouter, BankRouter } from './ingestors/rule-based/router.js';
import { parseStatementWithGemini, type GeminiIngestorOptions } from './ingestors/ai-direct/gemini.js';
import { exportToUnifiedCsv } from './exporters/csv-unified.js';
import { exportToSplitCsv, type SplitCsvOutput } from './exporters/csv-split.js';

export * from './core/types.js';
export * from './core/reconciler.js';
export * from './core/pdf-extractor.js';
export * from './core/ocr-extractor.js';
export * from './ingestors/rule-based/base.js';
export * from './ingestors/rule-based/router.js';
export * from './ingestors/rule-based/parsers/chase.js';
export * from './ingestors/rule-based/parsers/bofa.js';
export * from './ingestors/ai-direct/gemini.js';
export * from './exporters/csv-unified.js';
export * from './exporters/csv-split.js';
export * from './exporters/presets.js';

export interface ParseOptions {
  useAi?: boolean;
  useOcr?: boolean;
  aiOptions?: GeminiIngestorOptions;
  router?: BankRouter;
}

/**
 * High-level programmatic API to parse a bank statement (PDF or image) into a structured BankStatement.
 */
export async function parseStatement(
  input: string | Buffer | Uint8Array,
  options: ParseOptions = {}
): Promise<BankStatement> {
  const buffer = typeof input === 'string' ? fs.readFileSync(input) : input;
  const isImageFile =
    typeof input === 'string' &&
    /\.(png|jpe?g|tiff?|webp|bmp)$/i.test(path.extname(input));

  if (options.useAi) {
    return parseStatementWithGemini(buffer, options.aiOptions);
  }

  let doc: ExtractedPdfDocument;

  if (isImageFile || options.useOcr) {
    // OCR Extraction via Tesseract.js
    doc = await extractDocumentFromImages([buffer]);
  } else {
    // Digital PDF text extraction
    doc = await extractPdfDocument(buffer);

    // If PDF contains no selectable text (scanned PDF), check if OCR fallback is requested
    if (isScannedOrImageOnly(doc)) {
      throw new Error(
        'The statement PDF appears to be scanned or contains no selectable digital text.\n' +
          'Options:\n' +
          '1. Run with AI Direct Ingestion (--ai) to extract with multimodal vision.\n' +
          '2. Convert pages to images and parse with Tesseract.js OCR (--ocr).'
      );
    }
  }

  const router = options.router || defaultRouter;
  return router.route(doc);
}

/**
 * Convenience helper to parse a bank statement and directly export to CSV string(s).
 */
export async function convertStatementToCsv(
  input: string | Buffer | Uint8Array,
  options: ParseOptions & { split?: boolean; preset?: CsvPreset } = {}
): Promise<string | SplitCsvOutput[]> {
  const statement = await parseStatement(input, options);
  if (options.split) {
    return exportToSplitCsv(statement, options.preset);
  }
  return exportToUnifiedCsv(statement, options.preset);
}
