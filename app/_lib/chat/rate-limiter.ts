/**
 * In-memory rate limiter for chat API.
 *
 * Limits each user to a configurable number of messages per time window.
 * Uses a sliding-window counter stored in a Map (works for single-instance
 * Vercel deployments; for multi-region, swap to Vercel KV or Upstash Redis).
 *
 * Rate limit headers are added to responses so clients can show remaining quota.
 */

interface RateBucket {
  /** Timestamps of requests within the current window */
  timestamps: number[];
}

const buckets = new Map<string, RateBucket>();

// ─── Configuration ────────────────────────────────────────────────
const WINDOW_MS = 60 * 60 * 1000;  // 1 hour
const MAX_REQUESTS = 30;            // messages per window per user

// Cleanup stale buckets every 10 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - WINDOW_MS;
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter(t => t > cutoff);
    if (bucket.timestamps.length === 0) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;       // Unix ms when the oldest request in window expires
  retryAfterMs: number;  // 0 if allowed, otherwise ms until a slot frees up
}

/**
 * Check and consume a rate limit slot for the given user.
 *
 * @param userId - Unique user identifier
 * @returns RateLimitResult indicating whether the request is allowed
 */
export function checkRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  cleanup(now);

  const cutoff = now - WINDOW_MS;
  let bucket = buckets.get(userId);

  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(userId, bucket);
  }

  // Remove expired timestamps
  bucket.timestamps = bucket.timestamps.filter(t => t > cutoff);

  const count = bucket.timestamps.length;

  if (count >= MAX_REQUESTS) {
    // Find when the oldest request will expire
    const oldest = bucket.timestamps[0] ?? now;
    const resetAt = oldest + WINDOW_MS;
    const retryAfterMs = resetAt - now;

    return {
      allowed: false,
      remaining: 0,
      limit: MAX_REQUESTS,
      resetAt,
      retryAfterMs,
    };
  }

  // Consume a slot
  bucket.timestamps.push(now);

  const resetAt = (bucket.timestamps[0] ?? now) + WINDOW_MS;

  return {
    allowed: true,
    remaining: MAX_REQUESTS - (count + 1),
    limit: MAX_REQUESTS,
    resetAt,
    retryAfterMs: 0,
  };
}

/**
 * Get rate limit headers for the response.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };

  if (!result.allowed) {
    headers['Retry-After'] = String(Math.ceil(result.retryAfterMs / 1000));
  }

  return headers;
}
