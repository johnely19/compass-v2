#!/usr/bin/env node
/**
 * qa-vision-score.mjs — Claude Vision scoring for Compass QA
 *
 * Sends screenshot to Claude claude-opus-4-6, returns structured score.
 *
 * Usage:
 *   node scripts/qa-vision-score.mjs qa/screenshots/latest/home-full.png
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  || readEnvFile(join(REPO, '.env.local'))?.ANTHROPIC_API_KEY;

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  readFileSync(path, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_]+)="?([^"]+)"?/);
    if (m) vars[m[1]] = m[2];
  });
  return vars;
}

const SCORING_PROMPT = `You are a QA engineer for a travel app called Compass — a curated travel intelligence app for iPhone and web. Users review and save restaurant, bar, cafe, gallery, and accommodation recommendations.

Analyze this screenshot and return a JSON score object.

Score each criterion 1–10:
- hero_image: Is there a real photo (8–10) or just a color gradient placeholder (1–3)? A real photo scores 8+. A placeholder gradient scores 1–4.
- map_accuracy: Does the map (if present) show the right location at the right zoom? 1=world view or wrong city entirely, 5=correct city but wrong zoom, 10=neighborhood zoom, pin on correct location. If no map visible, score 5.
- info_density: Is key decision info (name, rating, price, hours, neighbourhood) visible above the fold? 1=mostly empty, 10=all critical info visible without scrolling.
- layout_quality: Visual clarity, typography, spacing, mobile readability. 1=broken layout/overflow, 10=polished and clear.
- data_completeness: Rating, city label, price level, type badge all present and accurate. 1=multiple fields missing or wrong city label, 10=all complete and correct.

Identify specific issues (be concrete and actionable):
- issue: exact description (e.g. "hero shows orange gradient instead of food photo")
- severity: "auto-fix" (can be fixed programmatically) | "escalate" (needs human) | "minor" (cosmetic)
- fix_hint: specific action (e.g. "fetch photo from Google Places API for ChIJ...")

Return ONLY valid JSON, no markdown fences:
{
  "scores": {
    "hero_image": <1-10>,
    "map_accuracy": <1-10>,
    "info_density": <1-10>,
    "layout_quality": <1-10>,
    "data_completeness": <1-10>
  },
  "overall": <average of above, 1 decimal>,
  "issues": [
    { "issue": "...", "severity": "auto-fix|escalate|minor", "fix_hint": "..." }
  ],
  "summary": "one sentence describing the main problems or confirming quality"
}`;

/**
 * Score a screenshot using Claude Vision.
 * @param {string} screenshotPath - path to PNG file
 * @param {string} pageName - page identifier for context
 * @returns {Promise<Object>} score object
 */
export async function scoreScreenshot(screenshotPath, pageName = 'page') {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  if (!existsSync(screenshotPath)) {
    throw new Error(`Screenshot not found: ${screenshotPath}`);
  }

  const imageData = readFileSync(screenshotPath);
  const base64 = imageData.toString('base64');

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: base64,
          },
        },
        {
          type: 'text',
          text: `${SCORING_PROMPT}\n\nPage: ${pageName}`,
        },
      ],
    }],
  });

  const text = response.content[0]?.text || '';

  // Parse JSON — strip any accidental markdown fences
  const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    const score = JSON.parse(clean);
    // Validate shape
    if (!score.scores || typeof score.overall !== 'number') {
      throw new Error('Invalid score shape');
    }
    return score;
  } catch {
    // Return a minimal error score if parse fails
    console.error(`  ⚠️  Failed to parse score for ${pageName}:`, clean.slice(0, 200));
    return {
      scores: { hero_image: 5, map_accuracy: 5, info_density: 5, layout_quality: 5, data_completeness: 5 },
      overall: 5,
      issues: [{ issue: 'Failed to parse Vision response', severity: 'minor', fix_hint: 'Check API response' }],
      summary: 'Score parsing failed — manual review needed',
      _parseError: true,
    };
  }
}

/**
 * Score multiple screenshots in sequence.
 * @param {Array<{name: string, path: string}>} screenshots
 * @param {number} delayMs - delay between API calls (default 500ms)
 * @returns {Promise<Array<{name: string, score: Object}>>}
 */
export async function scoreAll(screenshots, delayMs = 500) {
  const results = [];
  for (const ss of screenshots) {
    if (ss.error) {
      results.push({ name: ss.name, score: null, error: ss.error });
      continue;
    }
    try {
      console.log(`  🔍 Scoring ${ss.name}...`);
      const score = await scoreScreenshot(ss.path, ss.name);
      const emoji = score.overall >= 8 ? '✅' : score.overall >= 6 ? '⚠️' : '🔴';
      console.log(`  ${emoji} ${ss.name}: ${score.overall}/10 — ${score.summary}`);
      results.push({ name: ss.name, score });
    } catch (err) {
      console.log(`  ❌ ${ss.name}: ${err.message}`);
      results.push({ name: ss.name, score: null, error: err.message });
    }
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const screenshotPath = process.argv[2];
  if (!screenshotPath) {
    console.error('Usage: node scripts/qa-vision-score.mjs <screenshot.png>');
    process.exit(1);
  }

  console.log(`\n🔍 Scoring: ${screenshotPath}\n`);
  scoreScreenshot(screenshotPath, screenshotPath.split('/').pop()?.replace('.png', ''))
    .then(score => {
      console.log('\nScore:', JSON.stringify(score, null, 2));
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}
