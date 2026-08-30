#!/usr/bin/env node
import { Command, Option, InvalidArgumentError } from 'commander';
import fs from 'fs';
import path from 'path';
import { parseStatement, terminateOcrWorker, collectFiles } from './index.js';
import { StatementCsvWriter } from './exporters/csv-unified.js';
import type { CsvPreset } from './core/types.js';

const program = new Command();

program
  .name('bank-stmt')
  .description('TypeScript Bank Statement Parser to CSV with multi-account, OCR & AI support')
  .version('1.0.0');

interface CliParseOptions {
  output: string;
  preset: string;
  unified?: string;
  depth?: number;
  ocr?: boolean;
  ai?: boolean;
  verbose?: boolean;
}

program
  .command('parse')
  .description('Parse bank statement PDF or image files into CSV transaction lists')
  .argument('<path>', 'PDF/image file or directory containing statement files')
  .option('-o, --output <dir>', 'Directory to save output CSV files', './output')
  .addOption(
    new Option('-p, --preset <preset>', 'CSV preset format (standard, ynab, quickbooks)')
      .choices(['standard', 'ynab', 'quickbooks'])
      .default('standard')
  )
  .addOption(
    new Option(
      '-u, --unified [filename]',
      'Combine all transactions across statements into a single unified CSV file (default: unified.csv)'
    ).preset('unified.csv')
  )
  .addOption(
    new Option(
      '-d, --depth [number]',
      'Subdirectory search depth (omit number or pass -d for unlimited recursion)'
    )
      .preset('infinity')
      .argParser((val: string) => {
        if (val === 'infinity') return Infinity;
        const parsed = parseInt(val, 10);
        if (isNaN(parsed) || parsed < 0) {
          throw new InvalidArgumentError('Must be a non-negative integer.');
        }
        return parsed;
      })
  )
  .option('--ocr', 'Force local Tesseract.js OCR extraction on image statements', false)
  .option('--ai', 'Use Direct Multimodal AI Ingestion (requires GEMINI_API_KEY)', false)
  .option('-v, --verbose', 'Print verbose debug & reconciliation logs', false)
  .action(async (targetPath: string, options: CliParseOptions) => {
    let unifiedWriter: StatementCsvWriter | null = null;
    let unifiedOutPath = '';
    try {
      const isDir = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
      const filesToProcess: string[] = [];

      const maxDepth = options.depth ?? 0;

      if (isDir) {
        filesToProcess.push(...collectFiles(targetPath, undefined, maxDepth));
      } else if (fs.existsSync(targetPath)) {
        filesToProcess.push(targetPath);
      } else {
        console.error(`Error: File or directory not found at ${targetPath}`);
        process.exit(1);
      }

      if (filesToProcess.length === 0) {
        console.log(`No supported PDF or image statement files found at ${targetPath}`);
        return;
      }

      const outputDir = path.resolve(options.output);
      fs.mkdirSync(outputDir, { recursive: true });

      const preset = options.preset as CsvPreset;
      const mode = options.ai ? 'AI-Direct' : options.ocr ? 'Tesseract-OCR' : 'Rule-Based';
      console.log(`Processing ${filesToProcess.length} statement(s)... Preset: [${preset}] Mode: [${mode}]\n`);

      if (options.unified) {
        const rawName =
          typeof options.unified === 'string' && options.unified.trim()
            ? options.unified.trim()
            : 'unified.csv';
        const unifiedFilename = rawName.toLowerCase().endsWith('.csv') ? rawName : `${rawName}.csv`;
        unifiedOutPath = path.isAbsolute(unifiedFilename)
          ? unifiedFilename
          : path.join(outputDir, unifiedFilename);
        unifiedWriter = new StatementCsvWriter(unifiedOutPath, preset);
      }

      let skipped = 0;
      for (const filePath of filesToProcess) {
        const filename = path.basename(filePath);
        console.log(`📄 Processing: ${filename}`);

        let statement;
        try {
          statement = await parseStatement(filePath, {
            useAi: Boolean(options.ai),
            useOcr: Boolean(options.ocr)
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`   ⚠️  Skipped: ${message}\n`);
          skipped++;
          continue;
        }

        console.log(`   🏦 Institution: ${statement.institution}`);
        console.log(`   📅 Period: ${statement.periodStart || 'N/A'} to ${statement.periodEnd || 'N/A'}`);
        console.log(`   📊 Accounts Found: ${statement.accounts.length}`);

        for (const acc of statement.accounts) {
          const recon = acc.reconciliation;
          const status = recon?.isBalanced ? '✅ Reconciled' : '⚠️ Discrepancy';
          console.log(
            `      • [${acc.accountType}] ${acc.accountName} (${acc.accountNumberMasked}): ` +
              `${acc.transactions.length} txs | Bal: $${acc.openingBalance ?? 'N/A'} ➔ $${acc.closingBalance ?? 'N/A'} | ${status}`
          );
          if (options.verbose && recon && !recon.isBalanced) {
            console.log(
              `        Discrepancy: $${recon.discrepancy.toFixed(2)} (Calc: $${recon.calculatedClosingBalance.toFixed(2)} vs Rep: $${recon.closingBalance.toFixed(2)})`
            );
          }
        }

        if (unifiedWriter) {
          const txCount = unifiedWriter.writeStatement(statement);
          console.log(`   💾 Streamed ${txCount} transaction(s) to unified CSV`);
        } else {
          const baseName = path.parse(filename).name;
          const outPath = path.join(outputDir, `${baseName}.csv`);
          const writer = new StatementCsvWriter(outPath, preset);
          writer.writeStatement(statement);
          await writer.finish();
          console.log(`   💾 Exported Statement CSV: ${path.relative(process.cwd(), outPath)}`);
        }
        console.log('');
      }

      if (unifiedWriter) {
        const totalTx = await unifiedWriter.finish();
        console.log(`💾 Finalized Combined Unified CSV (${filesToProcess.length} statement(s), ${totalTx} transactions): ${path.relative(process.cwd(), unifiedOutPath)}\n`);
      }

      await terminateOcrWorker();
      if (skipped > 0) {
        console.log(`⚠️  ${skipped} file(s) skipped (no matching parser). See warnings above.`);
      }
      console.log(`🎉 ${filesToProcess.length - skipped} of ${filesToProcess.length} statement(s) successfully processed and saved to ${outputDir}`);
    } catch (err: unknown) {
      if (unifiedWriter) {
        unifiedWriter.close();
      }
      await terminateOcrWorker();
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ Error:`, message);
      process.exit(1);
    }
  });

program.parse(process.argv);
