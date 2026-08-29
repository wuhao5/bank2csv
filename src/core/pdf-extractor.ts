import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ExtractedPdfDocument, ExtractedPage, ExtractedTextItem } from './types.js';

/**
 * Extracts text and 2D layout lines from a PDF buffer using pdfjs-dist.
 */
export async function extractPdfDocument(pdfBuffer: Uint8Array | Buffer): Promise<ExtractedPdfDocument> {
  // Ensure we pass a clean Uint8Array (Node.js Buffer is a subclass, which pdfjs-dist rejects)
  const data = new Uint8Array(
    pdfBuffer.buffer,
    pdfBuffer.byteOffset,
    pdfBuffer.byteLength
  );

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false
  });

  const pdfDoc = await loadingTask.promise;
  const pages: ExtractedPage[] = [];
  const fullTextParts: string[] = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

    const items: ExtractedTextItem[] = [];
    for (const item of textContent.items) {
      if ('str' in item && typeof item.str === 'string' && item.str.length > 0) {
        items.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
          fontName: item.fontName
        });
      }
    }

    // Cluster text items into horizontal lines (within 3.5px Y tolerance)
    const lineBuckets: { y: number; items: ExtractedTextItem[] }[] = [];
    const sortedItems = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

    for (const item of sortedItems) {
      let bucket = lineBuckets.find((b) => Math.abs(b.y - item.y) <= 3.5);
      if (!bucket) {
        bucket = { y: item.y, items: [] };
        lineBuckets.push(bucket);
      }
      bucket.items.push(item);
    }

    // Sort buckets top-to-bottom
    lineBuckets.sort((a, b) => b.y - a.y);

    const lines = lineBuckets
      .map((bucket) => {
        bucket.items.sort((a, b) => a.x - b.x);
        return bucket.items.map((it) => it.text).join(' ').replace(/\s+/g, ' ').trim();
      })
      .filter((l) => l.length > 0);

    const pageText = lines.join('\n');
    fullTextParts.push(pageText);

    pages.push({
      pageNumber: pageNum,
      text: pageText,
      lines,
      items
    });
  }

  return {
    numPages: pdfDoc.numPages,
    fullText: fullTextParts.join('\n\n--- PAGE BREAK ---\n\n'),
    pages
  };
}
