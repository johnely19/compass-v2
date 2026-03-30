/**
 * Enhanced cottage photo fetcher
 * Gets 2-3 real photos per CottagesInCanada listing using Playwright
 * Uploads to Blob and updates discoveries.json
 */

import { chromium } from 'playwright';
import { put, list, del } from '@vercel/blob';

const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL || 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';

const CIC_COTTAGES = [
  { id: 'moira-lake-cottagesincanada', name: 'Moira Lake Cottage', url: 'https://www.cottagesincanada.com/29388' },
  { id: 'garrison-lake-cottagesincanada', name: 'Garrison Lake Cottage', url: 'https://www.cottagesincanada.com/33733' },
  { id: 'paradise-cove-cottagesincanada', name: 'Paradise Cove', url: 'https://www.cottagesincanada.com/36457' },
];

async function getGrandImages(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  });
  
  try {
    await page.goto(url, { timeout: 20000 });
    await page.waitForTimeout(3000);
    
    const imgs = await page.$$eval('img', els => 
      [...new Set(els.map(e => e.src).filter(s => s.includes('/_photos/grand/')))]
    );
    await browser.close();
    return imgs.slice(0, 3);
  } catch(e) {
    await browser.close();
    console.log(`Error fetching ${url}: ${e.message}`);
    return [];
  }
}

async function downloadImage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }});
  if (!r.ok) return null;
  return r.arrayBuffer();
}

async function uploadToBlob(id, idx, buffer) {
  const pathname = `place-photos/${id}/photos/${idx}.jpg`;
  const blob = await put(pathname, buffer, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true });
  return blob.url;
}

async function main() {
  const results = [];
  
  // Fetch photos for CottagesInCanada listings
  for (const c of CIC_COTTAGES) {
    console.log(`\nProcessing: ${c.name}`);
    const imgs = await getGrandImages(c.url);
    console.log(`  Found ${imgs.length} grand images`);
    
    const uploaded = [];
    for (let i = 0; i < imgs.length; i++) {
      console.log(`  Downloading ${i+1}/${imgs.length}: ${imgs[i].substring(0,80)}`);
      const buf = await downloadImage(imgs[i]);
      if (buf) {
        const blobUrl = await uploadToBlob(c.id, i + 1, buf);
        uploaded.push(blobUrl);
        console.log(`  Uploaded to: ${blobUrl}`);
      }
    }
    
    if (uploaded.length > 0) {
      results.push({ ...c, heroImage: uploaded[0], photos: uploaded });
      console.log(`  ✅ Hero: ${uploaded[0]}`);
    } else {
      console.log(`  ❌ No photos uploaded`);
    }
  }
  
  // Update discoveries.json
  console.log('\nUpdating discoveries.json...');
  const { blobs } = await list({ prefix: 'users/john/discoveries' });
  const blobEntry = blobs.find(b => b.pathname === 'users/john/discoveries.json') || blobs[0];
  const res = await fetch(blobEntry.url + '?t=' + Date.now());
  const raw = await res.json();
  const discoveries = Array.isArray(raw) ? raw : raw.discoveries || [];
  
  let updated = 0;
  for (const r of results) {
    if (!r.heroImage) continue;
    
    // Find by place_id or id matching this cottage
    const idx = discoveries.findIndex(d => 
      d.place_id === r.id || d.id === `cottage_${r.id}` || (d.place_id === r.id)
    );
    
    if (idx >= 0) {
      discoveries[idx].heroImage = r.heroImage;
      discoveries[idx].photos = r.photos;
      console.log(`  Updated existing: ${r.name}`);
      updated++;
    } else {
      // Add new entry
      discoveries.push({
        id: `cottage_${r.id}`,
        place_id: r.id,
        name: r.name,
        heroImage: r.heroImage,
        photos: r.photos,
        contextKey: 'trip:cottage-july-2026',
        source: 'disco:cottage-scan',
        url: r.url,
        type: 'accommodation',
        city: 'Haliburton, Ontario',
        discoveredAt: new Date().toISOString(),
      });
      console.log(`  Added new: ${r.name}`);
      updated++;
    }
  }
  
  // Save back
  for (const b of blobs) {
    await del(b.url);
  }
  await put('users/john/discoveries.json', JSON.stringify(discoveries), {
    access: 'public',
    addRandomSuffix: false
  });
  
  console.log(`\n✅ Done! Updated ${updated} discoveries. Total: ${discoveries.length}`);
  console.log('\nSummary:');
  results.forEach(r => console.log(`  ${r.name}: ${r.heroImage || 'NO HERO'}`));
}

main().catch(e => { console.error(e); process.exit(1); });
