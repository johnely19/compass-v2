#!/usr/bin/env node
/**
 * qa-pattern-store.mjs — Fix pattern knowledge base for Compass QA
 *
 * Tracks known issue→fix mappings with success rates.
 * Used by the auto-fix engine to apply known solutions before trying new ones.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const PATTERNS_FILE = join(REPO, 'qa', 'fix-patterns.json');
const SCORES_FILE = join(REPO, 'qa', 'scores.json');

/**
 * Load the pattern store from disk.
 * @returns {{ patterns: Array, metadata: Object }}
 */
export function loadPatterns() {
  if (!existsSync(PATTERNS_FILE)) return { patterns: [], metadata: { version: 1 } };
  try {
    return JSON.parse(readFileSync(PATTERNS_FILE, 'utf-8'));
  } catch {
    return { patterns: [], metadata: { version: 1 } };
  }
}

/**
 * Save patterns to disk.
 */
export function savePatterns(store) {
  store.metadata = store.metadata || {};
  store.metadata.updatedAt = new Date().toISOString();
  writeFileSync(PATTERNS_FILE, JSON.stringify(store, null, 2) + '\n');
}

/**
 * Find a matching pattern for a given issue description.
 * @param {string} issueText
 * @returns {Object|null} best matching pattern
 */
export function findMatchingPattern(issueText) {
  const store = loadPatterns();
  const issue = issueText.toLowerCase();

  return store.patterns.find(p => {
    const symptom = (p.symptom || '').toLowerCase();
    // Simple keyword matching
    const words = symptom.split(/\s+/).filter(w => w.length > 4);
    const matchCount = words.filter(w => issue.includes(w)).length;
    return matchCount >= Math.ceil(words.length * 0.5);
  }) || null;
}

/**
 * Record the outcome of a fix attempt.
 * @param {string} symptom
 * @param {string} fix
 * @param {boolean} success
 * @param {Object} context additional context
 */
export function recordFixOutcome(symptom, fix, success, context = {}) {
  const store = loadPatterns();
  const existing = store.patterns.find(p =>
    p.symptom.toLowerCase() === symptom.toLowerCase()
  );

  if (existing) {
    existing.times_applied = (existing.times_applied || 0) + 1;
    const prev = existing.success_rate || 0;
    const n = existing.times_applied;
    existing.success_rate = parseFloat(((prev * (n - 1) + (success ? 1 : 0)) / n).toFixed(3));
    existing.last_applied = new Date().toISOString();
  } else {
    store.patterns.push({
      symptom,
      root_cause: context.root_cause || 'unknown',
      fix,
      times_applied: 1,
      success_rate: success ? 1.0 : 0.0,
      first_seen: new Date().toISOString(),
      last_applied: new Date().toISOString(),
    });
  }

  savePatterns(store);
}

/**
 * Load historical scores.
 */
export function loadScores() {
  if (!existsSync(SCORES_FILE)) return { runs: [] };
  try {
    return JSON.parse(readFileSync(SCORES_FILE, 'utf-8'));
  } catch {
    return { runs: [] };
  }
}

/**
 * Append a QA run's scores to the history.
 * @param {Array<{name: string, score: Object}>} results
 */
export function recordRunScores(results) {
  const history = loadScores();
  const run = {
    timestamp: new Date().toISOString(),
    scores: results.reduce((acc, r) => {
      if (r.score) acc[r.name] = r.score.overall;
      return acc;
    }, {}),
    averageOverall: results
      .filter(r => r.score)
      .reduce((sum, r) => sum + r.score.overall, 0) /
      Math.max(1, results.filter(r => r.score).length),
  };

  history.runs.push(run);

  // Keep last 30 runs
  if (history.runs.length > 30) history.runs = history.runs.slice(-30);
  history.lastRun = run.timestamp;
  history.currentAverage = parseFloat(run.averageOverall.toFixed(2));

  writeFileSync(SCORES_FILE, JSON.stringify(history, null, 2) + '\n');
  return run;
}

/**
 * Get score trend (last N runs)
 */
export function getScoreTrend(n = 7) {
  const history = loadScores();
  return history.runs.slice(-n).map(r => ({
    date: r.timestamp.slice(0, 10),
    average: parseFloat(r.averageOverall.toFixed(2)),
  }));
}
