import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { collectFiles, DEFAULT_STATEMENT_EXTENSIONS } from '../src/core/file-utils.js';

describe('collectFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-stmt-test-'));

    // Create directory hierarchy:
    // tempDir/
    //   root1.pdf
    //   root2.PNG
    //   ignore.txt
    //   level1/
    //     sub1.pdf
    //     sub1.jpg
    //     ignore.docx
    //     level2/
    //       sub2.pdf
    //       sub2.webp
    //       level3/
    //         sub3.pdf
    fs.writeFileSync(path.join(tempDir, 'root1.pdf'), 'content');
    fs.writeFileSync(path.join(tempDir, 'root2.PNG'), 'content');
    fs.writeFileSync(path.join(tempDir, 'ignore.txt'), 'content');

    const level1 = path.join(tempDir, 'level1');
    fs.mkdirSync(level1);
    fs.writeFileSync(path.join(level1, 'sub1.pdf'), 'content');
    fs.writeFileSync(path.join(level1, 'sub1.jpg'), 'content');
    fs.writeFileSync(path.join(level1, 'ignore.docx'), 'content');

    const level2 = path.join(level1, 'level2');
    fs.mkdirSync(level2);
    fs.writeFileSync(path.join(level2, 'sub2.pdf'), 'content');
    fs.writeFileSync(path.join(level2, 'sub2.webp'), 'content');

    const level3 = path.join(level2, 'level3');
    fs.mkdirSync(level3);
    fs.writeFileSync(path.join(level3, 'sub3.pdf'), 'content');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should find only root files when maxDepth is 0 (non-recursive)', () => {
    const files = collectFiles(tempDir, DEFAULT_STATEMENT_EXTENSIONS, 0);
    const basenames = files.map((f) => path.basename(f)).sort();

    expect(basenames).toEqual(['root1.pdf', 'root2.PNG'].sort());
  });

  it('should find files up to depth 1 when maxDepth is 1', () => {
    const files = collectFiles(tempDir, DEFAULT_STATEMENT_EXTENSIONS, 1);
    const basenames = files.map((f) => path.basename(f)).sort();

    expect(basenames).toEqual(['root1.pdf', 'root2.PNG', 'sub1.pdf', 'sub1.jpg'].sort());
  });

  it('should find files up to depth 2 when maxDepth is 2', () => {
    const files = collectFiles(tempDir, DEFAULT_STATEMENT_EXTENSIONS, 2);
    const basenames = files.map((f) => path.basename(f)).sort();

    expect(basenames).toEqual(['root1.pdf', 'root2.PNG', 'sub1.pdf', 'sub1.jpg', 'sub2.pdf', 'sub2.webp'].sort());
  });

  it('should find all files recursively when maxDepth is Infinity', () => {
    const files = collectFiles(tempDir, DEFAULT_STATEMENT_EXTENSIONS, Infinity);
    const basenames = files.map((f) => path.basename(f)).sort();

    expect(basenames).toEqual(
      ['root1.pdf', 'root2.PNG', 'sub1.pdf', 'sub1.jpg', 'sub2.pdf', 'sub2.webp', 'sub3.pdf'].sort()
    );
  });

  it('should filter by specific custom extensions', () => {
    const files = collectFiles(tempDir, ['.pdf'], Infinity);
    const basenames = files.map((f) => path.basename(f)).sort();

    expect(basenames).toEqual(['root1.pdf', 'sub1.pdf', 'sub2.pdf', 'sub3.pdf'].sort());
  });
});

