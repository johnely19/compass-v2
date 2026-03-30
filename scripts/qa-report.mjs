#!/usr/bin/env node
/**
 * qa-report.mjs — Report generation and notification for Compass QA
 *
 * Compiles score results into a human-readable report.
 * Posts to Discord #devclaw on failures; silent on all-green.
 */

import { getScoreTrend } from './qa-pattern-store.mjs';

const DISCORD_WEBHOOK = process.env.QA_DISCORD_WEBHOOK; // optional
const TELEGRAM_BOT_TOKEN = '8440863363:AAHzMhU9poyklO0ifSPjhvJSd9hFPKnrTL0';
const TELEGRAM_CHAT_ID = '1422716904';

/**
 * Compile a QA run into a report object.
 */
export function compileReport(scoredResults, fixResults, opts = {}) {
  const { runTimestamp = new Date().toISOString(), baseUrl = '' } = opts;

  const scored = scoredResults.filter(r => r.score);
  const failed = scoredResults.filter(r => r.error && !r.score);
  const avg = scored.length
    ? scored.reduce((s, r) => s + r.score.overall, 0) / scored.length
    : 0;

  const red = scored.filter(r => r.score.overall < 5);
  const yellow = scored.filter(r => r.score.overall >= 5 && r.score.overall < 7);
  const green = scored.filter(r => r.score.overall >= 7);

  const escalateIssues = scored.flatMap(r =>
    (r.score.issues || [])
      .filter(i => i.severity === 'escalate')
      .map(i => ({ page: r.name, ...i }))
  );

  const trend = getScoreTrend(7);

  return {
    timestamp: runTimestamp,
    baseUrl,
    summary: {
      total: scoredResults.length,
      scored: scored.length,
      failed: failed.length,
      averageScore: parseFloat(avg.toFixed(2)),
      green: green.length,
      yellow: yellow.length,
      red: red.length,
    },
    fixes: fixResults || { fixedCount: 0, failedCount: 0, skippedCount: 0 },
    escalations: escalateIssues,
    scores: scored.map(r => ({
      name: r.name,
      overall: r.score.overall,
      scores: r.score.scores,
      issues: r.score.issues?.filter(i => i.severity !== 'minor') || [],
    })),
    trend,
    worstPages: red.map(r => ({
      name: r.name,
      overall: r.score.overall,
      summary: r.score.summary,
    })),
    allGreen: red.length === 0 && yellow.length === 0 && escalateIssues.length === 0,
  };
}

/**
 * Format report as human-readable text for Telegram/Discord.
 */
export function formatReport(report) {
  const { summary, fixes, escalations, worstPages, trend } = report;

  const statusEmoji = report.allGreen ? '✅' : summary.red > 0 ? '🔴' : '⚠️';
  const trendArrow = trend.length >= 2
    ? (trend[trend.length - 1].average > trend[0].average ? '📈' : '📉')
    : '➡️';

  let msg = `${statusEmoji} *Compass Nightly QA* — ${new Date(report.timestamp).toLocaleDateString('en-CA')}\n\n`;
  msg += `*Scores:* ${summary.green}✅ ${summary.yellow}⚠️ ${summary.red}🔴 (avg: ${summary.averageScore}/10 ${trendArrow})\n`;

  if (fixes.fixedCount > 0) {
    msg += `*Auto-fixed:* ${fixes.fixedCount} issues\n`;
  }

  if (report.allGreen) {
    msg += `\nAll ${summary.scored} pages scoring 7+. No action needed.`;
    return msg;
  }

  if (worstPages.length > 0) {
    msg += `\n*Needs attention:*\n`;
    worstPages.slice(0, 3).forEach(p => {
      msg += `• ${p.name}: ${p.overall}/10 — ${p.summary}\n`;
    });
  }

  if (escalations.length > 0) {
    msg += `\n*Requires human review:*\n`;
    escalations.slice(0, 3).forEach(e => {
      msg += `• [${e.page}] ${e.issue}\n`;
    });
  }

  return msg;
}

/**
 * Send Telegram message.
 */
async function sendTelegram(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`  Telegram error: ${res.status} — ${err.slice(0, 100)}`);
    }
  } catch (err) {
    console.error(`  Telegram send failed: ${err.message}`);
  }
}

/**
 * Notify via Telegram if issues, silent if all green.
 * @param {Object} report
 * @param {Object} opts
 * @param {boolean} opts.silent - never notify (for testing)
 * @param {boolean} opts.alwaysNotify - notify even if all green
 */
export async function notify(report, opts = {}) {
  if (opts.silent) return;

  const shouldNotify = opts.alwaysNotify || !report.allGreen;
  if (!shouldNotify) {
    console.log(`  📵 All green — silent run (no notification)`);
    return;
  }

  const message = formatReport(report);
  console.log(`  📨 Sending Telegram notification...`);
  await sendTelegram(message);
}

/**
 * Print report to console.
 */
export function printReport(report) {
  const { summary, scores } = report;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  QA Report — ${report.timestamp.slice(0, 10)}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Pages: ${summary.scored}/${summary.total} scored`);
  console.log(`  Average: ${summary.averageScore}/10`);
  console.log(`  ✅ ${summary.green} green  ⚠️  ${summary.yellow} yellow  🔴 ${summary.red} red`);

  if (report.fixes.fixedCount > 0) {
    console.log(`  Auto-fixed: ${report.fixes.fixedCount} issues`);
  }

  if (report.trend.length > 1) {
    const trendStr = report.trend.map(t => `${t.date.slice(5)}: ${t.average}`).join(' → ');
    console.log(`  Trend: ${trendStr}`);
  }

  if (report.worstPages.length > 0) {
    console.log(`\n  🔴 Worst pages:`);
    report.worstPages.forEach(p => console.log(`     ${p.name}: ${p.overall}/10 — ${p.summary}`));
  }

  if (report.escalations.length > 0) {
    console.log(`\n  ⬆️  Escalations (needs human):`);
    report.escalations.forEach(e => console.log(`     [${e.page}] ${e.issue}`));
  }

  console.log(`${'═'.repeat(60)}\n`);
}
