/**
 * Overnight Genius Generator.
 * Loads user data, calls Anthropic, and stores the report to Blob.
 */

import { put, list } from '@vercel/blob';
import { getUserProfile, getUserPreferences, getUserManifest, getUserDiscoveries, getUserChat } from '../user-data';
import { buildOvernightSystemPrompt, type OvernightUserContext } from './system-prompt';
import type { OvernightReport } from '../types';

const MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Generate an overnight report for a user.
 * @param userId - The user's ID
 * @param date - Optional date string (YYYY-MM-DD), defaults to today
 * @returns The generated OvernightReport
 */
export async function generateOvernightReport(userId: string, date?: string): Promise<OvernightReport> {
  // Default to today's date
  let targetDate: string;
  if (date) {
    targetDate = date;
  } else {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    targetDate = `${year}-${month}-${day}`;
  }

  // Load all user data in parallel
  const [profile, preferences, manifest, discoveries, chat] = await Promise.all([
    getUserProfile(userId),
    getUserPreferences(userId),
    getUserManifest(userId),
    getUserDiscoveries(userId),
    getUserChat(userId),
  ]);

  // Get prior report dates to avoid repetition
  const priorReportDates = await getPriorReportDates(userId);

  // Build the context
  const context: OvernightUserContext = {
    profile,
    preferences,
    manifest,
    discoveries,
    chat,
    priorReportDates,
  };

  // Build the system prompt
  const systemPrompt = buildOvernightSystemPrompt(context);

  // Call Anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const messages = [
    { role: 'user' as const, content: 'Generate my overnight report please.' }
  ];

  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  };

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${err}`);
  }

  const data = await response.json();

  // Extract the JSON from the response
  const textBlocks = (data?.content || []).filter((b: { type: string; text?: string }) => b.type === 'text');
  const content = textBlocks.map((b: { text?: string }) => b.text || '').join('\n');

  // Parse the JSON response
  let parsed: {
    greeting?: string;
    sections?: Array<{ title: string; content: string }>;
  };

  try {
    // Try to extract JSON from the content (in case there's any wrapper text)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      parsed = JSON.parse(content);
    }
  } catch (parseErr) {
    console.error('[overnight] Failed to parse JSON from Anthropic response:', content);
    throw new Error('Failed to parse AI response as JSON');
  }

  // Validate the response structure
  if (!parsed.greeting || !parsed.sections || !Array.isArray(parsed.sections) || parsed.sections.length !== 6) {
    console.error('[overnight] Invalid response structure:', parsed);
    throw new Error('AI response missing required fields or not 6 sections');
  }

  // Build the report
  const now = new Date().toISOString();
  const report: OvernightReport = {
    userId,
    date: targetDate,
    greeting: parsed.greeting || 'GOOD MORNING. HERE IS WHAT I CAME UP WITH LAST NIGHT.',
    sections: parsed.sections.map(s => ({
      title: s.title,
      content: s.content,
    })),
    generatedAt: now,
  };

  // Store to Blob
  await storeOvernightReport(userId, report);

  return report;
}

/**
 * Get list of prior report dates for a user.
 */
async function getPriorReportDates(userId: string): Promise<string[]> {
  try {
    const { blobs } = await list({
      prefix: `users/${userId}/overnight-reports/`,
      limit: 30,
    });

    // Extract dates from blob names (format: users/{userId}/overnight-reports/{YYYY-MM-DD}.json)
    const dates = blobs
      .map(b => {
        const match = b.pathname.match(/overnight-reports\/(\d{4}-\d{2}-\d{2})\.json/);
        return match ? match[1] : null;
      })
      .filter((d): d is string => d !== null)
      .sort();

    return dates;
  } catch {
    return [];
  }
}

/**
 * Store the overnight report to Blob.
 */
async function storeOvernightReport(userId: string, report: OvernightReport): Promise<void> {
  const blobPath = `users/${userId}/overnight-reports/${report.date}.json`;

  await put(blobPath, JSON.stringify(report, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

/**
 * Get the latest overnight report for a user.
 */
export async function getLatestOvernightReport(userId: string): Promise<OvernightReport | null> {
  try {
    const { blobs } = await list({
      prefix: `users/${userId}/overnight-reports/`,
      limit: 1,
    });

    if (!blobs.length) {
      return null;
    }

    // Get the most recent (list returns sorted by creation time)
    // We need to sort by date ourselves since we can't rely on creation order
    const sortedBlobs = blobs
      .map(b => ({
        ...b,
        date: b.pathname.match(/overnight-reports\/(\d{4}-\d{2}-\d{2})\.json/)?.[1] || '',
      }))
      .filter(b => b.date)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (!sortedBlobs.length) {
      return null;
    }

    const blob = sortedBlobs[0];
    if (!blob) {
      return null;
    }
    const res = await fetch(blob.url);

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as OvernightReport;
  } catch {
    return null;
  }
}