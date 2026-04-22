/**
 * Homepage HTML Budget Check
 *
 * Validates that signed-in homepage HTML stays under 50KB to maintain fast LCP.
 * Run as: npx tsx scripts/check-homepage-size.ts
 *
 * Expects COMPASS_USER cookie for authenticated state:
 *   curl -s http://localhost:3002/ -b "compass-user=john" | wc -c
 */

const DEFAULT_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3002';

const BUDGET_BYTES = 50 * 1024; // 50KB

async function checkHomepageSize() {
  const url = process.env.HOMEPAGE_URL || DEFAULT_URL;
  const cookie = process.env.COMPASS_COOKIE || 'compass-user=john';

  console.log(`\n🏠 Homepage HTML Budget Check`);
  console.log(`   URL: ${url}`);
  console.log(`   Budget: ${(BUDGET_BYTES / 1024).toFixed(0)}KB`);

  try {
    const res = await fetch(url, {
      headers: {
        // Pass user identity via cookie
        Cookie: cookie,
      },
    });

    if (!res.ok) {
      console.error(`\n❌ Failed to fetch homepage: ${res.status} ${res.statusText}`);
      process.exit(1);
    }

    const html = await res.text();
    const bytes = Buffer.byteLength(html, 'utf8');
    const kb = bytes / 1024;

    console.log(`   Actual: ${kb.toFixed(1)}KB (${bytes.toLocaleString()} bytes)`);

    if (bytes > BUDGET_BYTES) {
      const over = kb - (BUDGET_BYTES / 1024);
      console.error(`\n❌ OVER BUDGET by ${over.toFixed(1)}KB`);
      console.error(`   Reduce discovery payload or lazy-load non-active contexts.`);
      process.exit(1);
    }

    console.log(`\n✅ Under budget`);

  } catch (err) {
    console.error(`\n❌ Error:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

checkHomepageSize();