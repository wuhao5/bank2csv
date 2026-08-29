#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { parseStatement, terminateOcrWorker } from './index.js';
import { exportToUnifiedCsv } from './exporters/csv-unified.js';
import { exportToSplitCsv } from './exporters/csv-split.js';
import type { CsvPreset } from './core/types.js';

const program = new Command();

program
  .name('bank-stmt')
  .description('TypeScript Bank Statement Parser to CSV with multi-account, OCR & AI support')
  .version('1.0.0');

program
  .command('parse')
  .description('Parse bank statement PDF or image files into CSV transaction lists')
  .argument('<path>', 'PDF/image file or directory containing statement files')
  .option('-o, --output <dir>', 'Directory to save output CSV files', './output')
  .option('-p, --preset <preset>', 'CSV preset format (standard, ynab, quickbooks)', 'standard')
  .option('-s, --split', 'Generate separate CSV files for each bank account in multi-account statements', false)
  .option('--ocr', 'Force local Tesseract.js OCR extraction on image statements', false)
  .option('--ai', 'Use Direct Multimodal AI Ingestion (requires GEMINI_API_KEY)', false)
  .option('-v, --verbose', 'Print verbose debug & reconciliation logs', false)
  .action(async (targetPath: string, options: any) => {
    try {
      const isDir = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
      const filesToProcess: string[] = [];

      const validExts = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.webp', '.bmp'];

      if (isDir) {
        const entries = fs.readdirSync(targetPath);
        for (const file of entries) {
          const ext = path.extname(file).toLowerCase();
          if (validExts.includes(ext)) {
            filesToProcess.push(path.join(targetPath, file));
          }
        }
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

      const mode = options.ai ? 'AI-Direct' : options.ocr ? 'Tesseract-OCR' : 'Rule-Based';
      console.log(`Processing ${filesToProcess.length} statement(s)... Preset: [${options.preset}] Mode: [${mode}]\n`);

      for (const filePath of filesToProcess) {
        const filename = path.basename(filePath);
        console.log(`📄 Processing: ${filename}`);

        const statement = await parseStatement(filePath, {
          useAi: Boolean(options.ai),
          useOcr: Boolean(options.ocr)
        });

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

        const preset = options.preset as CsvPreset;

        if (options.split) {
          const splitOutputs = exportToSplitCsv(statement, preset);
          for (const item of splitOutputs) {
            const outPath = path.join(outputDir, item.suggestedFilename);
            fs.writeFileSync(outPath, item.csvContent, 'utf-8');
            console.log(`   💾 Exported Account CSV: ${path.relative(process.cwd(), outPath)}`);
          }
        } else {
          const csvContent = exportToUnifiedCsv(statement, preset);
          const baseName = path.parse(filename).name;
          const outPath = path.join(outputDir, `${baseName}.csv`);
          fs.writeFileSync(outPath, csvContent, 'utf-8');
          console.log(`   💾 Exported Unified CSV: ${path.relative(process.cwd(), outPath)}`);
        }
        console.log('');
      }

      await terminateOcrWorker();
      console.log(`🎉 All statements successfully processed and saved to ${outputDir}`);
    } catch (err: any) {
      await terminateOcrWorker();
      console.error(`\n❌ Error:`, err.message || err);
      process.exit(1);
    }
  });

program.parse(process.argv);
