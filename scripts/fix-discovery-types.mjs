#!/usr/bin/env node
/* ============================================================
   Fix mis-typed discoveries in Blob data.
   Re-infers type from name for discoveries that are 'restaurant'
   but should be something else (museum, gallery, park, etc.)
   APPEND-ONLY safe: rewrites with corrected types.
   ============================================================ */

const BASE = process.argv[2] || 'http://localhost:3002';
const COOKIE = 'compass-user=john';
const DRY_RUN = process.argv.includes('--dry-run');

const GOOGLE_TYPE_MAP = {
  art_gallery: 'gallery', gallery: 'gallery', museum: 'museum',
  bar: 'bar', night_club: 'bar', pub: 'bar', brewery: 'bar',
  wine_bar: 'bar', cocktail_bar: 'bar', comedy_club: 'bar',
  restaurant: 'restaurant', cafe: 'cafe', coffee_shop: 'cafe', bakery: 'cafe',
  performing_arts_theater: 'theatre', theater: 'theatre',
  cinema: 'experience', movie_theater: 'experience', movie_theatre: 'experience',
  music_venue: 'music-venue', concert_hall: 'music-venue', jazz_club: 'music-venue',
  live_music_venue: 'music-venue',
  park: 'park', national_park: 'park', beach: 'park', nature_reserve: 'park',
  tourist_attraction: 'experience', amusement_park: 'experience',
  aquarium: 'experience', zoo: 'experience',
  lodging: 'hotel', hotel: 'hotel',
};

function inferType(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/gallery|fine art|art space/.test(lower)) return 'gallery';
  if (/museum|biennial/.test(lower)) return 'museum';
  if (/cinema|nitehawk|film house|movie theater|imax|theater(?!.*food)|theatre/.test(lower)) return 'experience';
  if (/roller.*arts|roller.*rink|skating|makerspace|roller arts/.test(lower)) return 'experience';
  if (/house of yes|concert hall|music.*hall|jazz.*club|nublu|the rex\b/.test(lower)) return 'music-venue';
  if (/brewery|brew.*collective|brew.*co\b|brewing company/.test(lower)) return 'bar';
  if (/wine bar|cocktail bar|distill/.test(lower)) return 'bar';
  if (/park|preserve|nature|botanical|garden|greenway/.test(lower)) return 'park';
  if (/collective(?!.*brew)/i.test(lower) && /bushwick|street art|mural/.test(lower)) return 'experience';
  if (/bookshop|book store|books\b/.test(lower)) return 'shop';
  return null; // don't infer if uncertain
}

async function main() {
  console.log(`\n🔧 Discovery Type Fix`);
  if (DRY_RUN) console.log('   DRY RUN\n');

  // Fetch raw discoveries
  const res = await fetch(`${BASE}/api/user/discoveries`, {
    headers: { Cookie: COOKIE },
  });
  if (!res.ok) { console.error('Failed to fetch:', res.status); process.exit(1); }
  const data = await res.json();
  const discoveries = data.discoveries || [];

  console.log(`  ${discoveries.length} discoveries loaded\n`);

  let fixed = 0;
  const updated = discoveries.map(d => {
    if (d.type !== 'restaurant') return d; // only fix mis-typed 'restaurant' entries
    const inferred = inferType(d.name);
    if (!inferred || inferred === 'restaurant') return d;
    console.log(`  → ${d.name}: restaurant → ${inferred}`);
    fixed++;
    return { ...d, type: inferred };
  });

  console.log(`\n  ${fixed} discoveries re-typed`);
  if (fixed === 0) { console.log('  Nothing to fix.\n'); return; }
  if (DRY_RUN) { console.log('  DRY RUN — no write\n'); return; }

  // Write back via the discoveries endpoint
  // We need to replace the blob directly — use the admin-style raw write
  // Since the API is append-only, we need to update in-place via a direct PUT
  // Use the same pattern as setUserData in user-data.ts
  const { put, list, del } = await import('@vercel/blob');

  const blobPath = 'users/john/discoveries.json';
  const { blobs } = await list({ prefix: blobPath, limit: 1 });
  const existing = blobs[0];
  if (existing) await del(existing.url);

  await put(blobPath, JSON.stringify({ discoveries: updated, updatedAt: new Date().toISOString() }, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  console.log(`  ✅ Updated ${fixed} discoveries in Blob\n`);
}

main().catch(console.error);
