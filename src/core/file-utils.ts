import fs from 'fs';
import path from 'path';

export const DEFAULT_STATEMENT_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.webp', '.bmp'];

/**
 * Recursively or shallowly searches a directory for files matching specified extensions,
 * respecting an optional maximum search depth.
 *
 * @param dirPath The directory to search.
 * @param validExts List of allowed file extensions (e.g. ['.pdf', '.png']).
 * @param maxDepth Maximum recursion depth (0 for top-level directory only, Infinity for all subdirectories).
 * @param currentDepth Current recursion depth level (internal use).
 * @returns Array of paths to matching files.
 */
export function collectFiles(
  dirPath: string,
  validExts: string[] = DEFAULT_STATEMENT_EXTENSIONS,
  maxDepth: number = 0,
  currentDepth: number = 0
): string[] {
  const files: string[] = [];
  const normalizedExts = validExts.map((ext) => ext.toLowerCase());

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();

      // Handle symlinks safely
      if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(fullPath);
          isDirectory = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          // Ignore broken symlinks
          continue;
        }
      }

      if (isDirectory) {
        if (currentDepth < maxDepth) {
          files.push(...collectFiles(fullPath, normalizedExts, maxDepth, currentDepth + 1));
        }
      } else if (isFile) {
        const ext = path.extname(entry.name).toLowerCase();
        if (normalizedExts.includes(ext)) {
          files.push(fullPath);
        }
      }
    } catch {
      // Ignore unreadable entries
    }
  }

  return files;
}

