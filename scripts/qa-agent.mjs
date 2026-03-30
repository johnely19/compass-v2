#!/usr/bin/env node
/**
 * qa-agent.mjs — Self-improving QA orchestrator for Compass
 *
 * The full loop:
 *   screenshot all → score all → identify auto-fixable → run fixes →
 *   re-screenshot fixed pages → verify improved → update baseline →
 *   compile report → notify if needed
 *
 * Usage:
 *   node scripts/qa-agent.mjs [BASE_URL]                    # full run
 *   node scripts/qa-agent.mjs [BASE_URL] --mode=nightly     # nightly (notify on fail)
 *   node scripts/qa-agent.mjs [BASE_URL] --fix=auto         # auto-fix enabled
 *   node scripts/qa-agent.mjs [BASE_URL] --no-fix           # score only
 *   node scripts/qa-agent.mjs [BASE_URL] --pages=home-full,review-nyc  # specific pages
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

import { takeScreenshots } from './qa-screenshot.mjs';
import { scoreAll } from './qa-vision-score.mjs';
import { runAutoFixes } from './qa-auto-fix.mjs';
import { recordRunScores } from './qa-pattern-store.mjs';
import { compileReport, printReport, notify } from './qa-report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3002';
const MODE = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'manual';
const FIX_MODE = process.argv.includes('--no-fix') ? 'none'
  : process.argv.find(a => a.startsWith('--fix='))?.split('=')[1] || 'auto';
const PAGES_FILTER = process.argv.find(a => a.startsWith('--pages='))?.split('=')[1]?.split(',');

const BASELINE_DIR = join(REPO, 'qa', 'screenshots', 'baseline');
const LATEST_DIR = join(REPO, 'qa', 'screenshots', 'latest');
const REPORT_DIR = join(REPO, 'qa');

mkdirSync(BASELINE_DIR, { recursive: true });
mkdirSync(LATEST_DIR, { recursive: true });

async function run() {
  const startTime = Date.now();
  console.log(`\n🤖 Compass QA Agent — ${new Date().toISOString()}`);
  console.log(`   Mode: ${MODE} | Fix: ${FIX_MODE} | Target: ${BASE}`);
  if (PAGES_FILTER) console.log(`   Pages: ${PAGES_FILTER.join(', ')}`);
  console.log();

  // ── Step 1: Screenshots ──────────────────────────────────────────────────────
  console.log('Step 1/5 — Taking screenshots...');
  const screenshots = await takeScreenshots(BASE, {
    only: PAGES_FILTER,
  });
  const capturedCount = screenshots.filter(s => !s.error).length;
  console.log(`  → ${capturedCount}/${screenshots.length} captured\n`);

  // ── Step 2: Vision scoring ───────────────────────────────────────────────────
  console.log('Step 2/5 — Scoring with Claude Vision (claude-opus-4-6)...');
  let scoredResults = await scoreAll(screenshots, 600);
  const scoredCount = scoredResults.filter(r => r.score).length;
  console.log(`  → ${scoredCount}/${scoredResults.length} scored\n`);

  // Record scores to history
  const runRecord = recordRunScores(scoredResults);
  console.log(`  Average score: ${runRecord.averageOverall.toFixed(2)}/10\n`);

  // ── Step 3: Auto-fix ─────────────────────────────────────────────────────────
  let fixResults = { fixedCount: 0, failedCount: 0, skippedCount: 0, details: [] };

  if (FIX_MODE !== 'none') {
    const autoFixable = scoredResults.filter(r =>
      r.score?.issues?.some(i => i.severity === 'auto-fix')
    );

    if (autoFixable.length > 0) {
      console.log(`Step 3/5 — Running auto-fixes (${autoFixable.length} pages with fixable issues)...`);
      fixResults = await runAutoFixes(
        autoFixable.map(r => ({ ...r, url: r.url })),
        'john'
      );
      console.log(`  → Fixed: ${fixResults.fixedCount} | Failed: ${fixResults.failedCount}\n`);

      // ── Step 4: Re-screenshot fixed pages ──────────────────────────────────
      if (fixResults.fixedCount > 0) {
        console.log('Step 4/5 — Re-screening fixed pages to verify...');
        const fixedPageNames = [...new Set(fixResults.details.filter(d => d.success).map(d => d.page))];
        const verifyScreenshots = await takeScreenshots(BASE, { only: fixedPageNames });
        const verifyScores = await scoreAll(verifyScreenshots, 600);

        // Merge improved scores into results
        for (const vs of verifyScores) {
          if (!vs.score) continue;
          const orig = scoredResults.find(r => r.name === vs.name);
          if (orig?.score && vs.score.overall > orig.score.overall) {
            console.log(`  📈 ${vs.name}: ${orig.score.overall} → ${vs.score.overall} (+${(vs.score.overall - orig.score.overall).toFixed(1)})`);
            // Update baseline with improved screenshot
            const baselinePath = join(BASELINE_DIR, `${vs.name}.png`);
            if (existsSync(vs.path)) copyFileSync(vs.path, baselinePath);
            const baselineScorePath = join(BASELINE_DIR, `${vs.name}.score.json`);
            writeFileSync(baselineScorePath, JSON.stringify(vs.score, null, 2));
            // Update scored result
            scoredResults = scoredResults.map(r => r.name === vs.name ? { ...r, score: vs.score } : r);
          }
        }
        console.log();
      }
    } else {
      console.log('Step 3/5 — No auto-fixable issues found\n');
    }
  } else {
    console.log('Step 3/5 — Fix mode: none (skipped)\n');
  }

  // ── Step 5: Update baseline for green pages ──────────────────────────────────
  console.log('Step 5/5 — Updating baselines for high-scoring pages...');
  let baselineUpdated = 0;
  for (const result of scoredResults) {
    if (result.score?.overall >= 8 && result.path && existsSync(result.path)) {
      const baselinePath = join(BASELINE_DIR, `${result.name}.png`);
      copyFileSync(result.path, baselinePath);
      const baselineScorePath = join(BASELINE_DIR, `${result.name}.score.json`);
      writeFileSync(baselineScorePath, JSON.stringify(result.score, null, 2));
      baselineUpdated++;
    }
  }
  console.log(`  → Updated ${baselineUpdated} baselines\n`);

  // ── Report ────────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const report = compileReport(scoredResults, fixResults, {
    runTimestamp: new Date().toISOString(),
    baseUrl: BASE,
    elapsed,
  });

  printReport(report);

  // Save report JSON
  const reportPath = join(REPORT_DIR, 'last-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

  // Notify
  const notifyOpts = {
    silent: MODE === 'manual' && report.allGreen,
    alwaysNotify: MODE === 'nightly' && !report.allGreen,
  };
  await notify(report, notifyOpts);

  const exitCode = report.summary.red > 0 ? 1 : 0;
  console.log(`QA run complete in ${elapsed}s. Exit: ${exitCode}\n`);
  process.exit(exitCode);
}

run().catch(err => {
  console.error(`\n❌ QA Agent fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
});
