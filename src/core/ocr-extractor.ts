import { createWorker, type Worker } from 'tesseract.js';
import type { ExtractedPdfDocument, ExtractedPage, ExtractedTextItem } from './types.js';

let sharedWorker: Worker | null = null;

/**
 * Get or initialize a singleton Tesseract.js OCR worker.
 */
export async function getOcrWorker(): Promise<Worker> {
  if (!sharedWorker) {
    sharedWorker = await createWorker('eng');
  }
  return sharedWorker;
}

/**
 * Terminate the active OCR worker.
 */
export async function terminateOcrWorker(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate();
    sharedWorker = null;
  }
}

/**
 * Checks if an extracted document is empty or likely a scanned/image-only PDF.
 */
export function isScannedOrImageOnly(doc: ExtractedPdfDocument): boolean {
  const trimmed = doc.fullText.replace(/--- PAGE BREAK ---/g, '').trim();
  return trimmed.length < 50 || doc.pages.every((p) => p.lines.length === 0);
}

/**
 * Extracts structured text, lines, and bounding boxes from a single image buffer using Tesseract.js.
 */
export async function extractTextFromImage(
  imageBuffer: Buffer | Uint8Array,
  pageNumber: number = 1
): Promise<ExtractedPage> {
  const worker = await getOcrWorker();
  const buffer = imageBuffer instanceof Buffer ? imageBuffer : Buffer.from(imageBuffer);

  const result = await worker.recognize(buffer);
  const data = result.data as any;

  const lines: string[] = [];
  const items: ExtractedTextItem[] = [];

  if (data.lines && Array.isArray(data.lines) && data.lines.length > 0) {
    for (const line of data.lines) {
      const lineText = (line.text || '').trim();
      if (lineText.length > 0) {
        lines.push(lineText);
      }
      if (line.bbox) {
        items.push({
          text: lineText,
          x: line.bbox.x0,
          y: line.bbox.y0,
          width: line.bbox.x1 - line.bbox.x0,
          height: line.bbox.y1 - line.bbox.y0
        });
      }
    }
  } else if (data.text) {
    const rawLines = String(data.text)
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);
    lines.push(...rawLines);
  }

  const pageText = lines.join('\n');

  return {
    pageNumber,
    text: pageText,
    lines,
    items
  };
}

/**
 * Converts multiple image pages into a unified ExtractedPdfDocument for downstream rule-based parsing.
 */
export async function extractDocumentFromImages(
  imageBuffers: (Buffer | Uint8Array)[]
): Promise<ExtractedPdfDocument> {
  const pages: ExtractedPage[] = [];
  const fullTextParts: string[] = [];

  for (let i = 0; i < imageBuffers.length; i++) {
    const page = await extractTextFromImage(imageBuffers[i], i + 1);
    pages.push(page);
    fullTextParts.push(page.text);
  }

  return {
    numPages: pages.length,
    fullText: fullTextParts.join('\n\n--- PAGE BREAK ---\n\n'),
    pages
  };
}
