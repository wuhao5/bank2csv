import { describe, it, expect, afterAll } from 'vitest';
import { isScannedOrImageOnly, terminateOcrWorker } from '../src/core/ocr-extractor.js';
import type { ExtractedPdfDocument } from '../src/core/types.js';

describe('OCR Extractor & Detection', () => {
  afterAll(async () => {
    await terminateOcrWorker();
  });

  it('detects scanned or empty PDF documents', () => {
    const emptyDoc: ExtractedPdfDocument = {
      numPages: 1,
      fullText: '',
      pages: [{ pageNumber: 1, text: '', lines: [], items: [] }]
    };
    expect(isScannedOrImageOnly(emptyDoc)).toBe(true);

    const textDoc: ExtractedPdfDocument = {
      numPages: 1,
      fullText: 'JPMorgan Chase Bank, N.A. Statement for checking account ...1234 with transactions',
      pages: [
        {
          pageNumber: 1,
          text: 'JPMorgan Chase Bank, N.A. Statement for checking account ...1234 with transactions',
          lines: ['JPMorgan Chase Bank, N.A. Statement for checking account ...1234 with transactions'],
          items: []
        }
      ]
    };
    expect(isScannedOrImageOnly(textDoc)).toBe(false);
  });
});
