/**
 * fetch-cottage-photos.mjs
 * Fetches photos from cottage listing URLs (cottagesincanada.com, vrbo.com, kijiji.ca)
 * Uploads to Vercel Blob at place-photos/{listing-id}/photos/
 * Updates discoveries.json in Blob with heroImage
 *
 * Usage: node --env-file=.env.local scripts/fetch-cottage-photos.mjs [--dry-run]
 */

import { chromium } from 'playwright';
import { put, list, del } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL || 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';
const DRY_RUN = process.argv.includes('--dry-run');

// Cottage listings to fetch photos from
const COTTAGES = [
  {
    id: 'highlands-east-kijiji',
    name: 'Highlands East',
    url: 'https://www.kijiji.ca/v-cottage-rental/haliburton/4-bedroom-luxury-cottage-sandy-beach-highlands-east/',
    platform: 'Kijiji'
  },
  {
    id: 'happynest-kawigamog',
    name: 'Happynest on Kawigamog Lake',
    url: 'https://www.cottagesincanada.com/happynest',
    platform: 'CottagesInCanada'
  },
  {
    id: 'moira-lake-cottagesincanada',
    name: 'Moira Lake Cottage',
    url: 'https://www.cottagesincanada.com/29388',
    platform: 'CottagesInCanada'
  },
  {
    id: 'devil-lake-east-kijiji',
    name: 'Devil Lake East',
    url: 'https://www.kijiji.ca/v-cottage-rental/haliburton/devil-lake-cottage/',
    platform: 'Kijiji'
  },
  {
    id: 'garrison-lake-cottagesincanada',
    name: 'Garrison Lake Cottage',
    url: 'https://www.cottagesincanada.com/33733',
    platform: 'CottagesInCanada'
  },
  {
    id: 'haliburton-vrbo',
    name: 'Haliburton VRBO',
    url: 'https://www.vrbo.com/en-ca/p7417233',
    platform: 'VRBO'
  },
  {
    id: 'paradise-cove-cottagesincanada',
    name: 'Paradise Cove',
    url: 'https://www.cottagesincanada.com/36457',
    platform: 'CottagesInCanada'
  }
];

/**
 * Extract photos from a listing URL using Playwright
 */
async function fetchPhotosWithPlaywright(url, platform) {
  console.log(`  Launching browser for: ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      // Continue even if networkidle times out
    });

    let images = [];

    if (platform === 'CottagesInCanada') {
      // Try various selectors for cottagesincanada
      const selectors = [
        '.gallery img',
        '.photos img',
        '.property-images img',
        '#gallery img',
        '.slider img',
        'img[alt*="cottage"]',
        'img[alt*="lake"]',
        'img[alt*="water"]'
      ];

      for (const sel of selectors) {
        const imgs = await page.$$(sel);
        for (const img of imgs) {
          const src = await img.getAttribute('src');
          const alt = await img.getAttribute('alt');
          if (src && src.startsWith('http')) {
            images.push({ src, alt: alt || '' });
          }
        }
        if (images.length >= 3) break;
      }

      // Fallback: og:image meta
      if (images.length < 2) {
        const ogImage = await page.$eval('meta[property="og:image"]', el => el.content).catch(() => null);
        if (ogImage) images.push({ src: ogImage, alt: 'og:image' });
      }
    } else if (platform === 'VRBO') {
      // VRBO: try og:image and main gallery
      const ogImage = await page.$eval('meta[property="og:image"]', el => el.content).catch(() => null);
      if (ogImage) images.push({ src: ogImage, alt: 'og:image' });

      // Try to find gallery images
      const galleryImgs = await page.$$('.gallery img, .hero-image img, img[alt*="view"]');
      for (const img of galleryImgs.slice(0, 3)) {
        const src = await img.getAttribute('src');
        if (src && src.startsWith('http')) {
          images.push({ src, alt: await img.getAttribute('alt') || '' });
        }
      }
    } else if (platform === 'Kijiji') {
      // Kijiji: try og:image and main images
      const ogImage = await page.$eval('meta[property="og:image"]', el => el.content).catch(() => null);
      if (ogImage) images.push({ src: ogImage, alt: 'og:image' });

      const imgTags = await page.$$('.gallery img, .hero-image img, #main-image img');
      for (const img of imgTags.slice(0, 3)) {
        const src = await img.getAttribute('src');
        if (src && src.startsWith('http')) {
          images.push({ src, alt: await img.getAttribute('alt') || '' });
        }
      }
    }

    await browser.close();

    // Deduplicate by URL
    const uniqueImages = [];
    const seen = new Set();
    for (const img of images) {
      if (!seen.has(img.src)) {
        seen.add(img.src);
        uniqueImages.push(img);
      }
    }

    return uniqueImages.slice(0, 3);
  } catch (err) {
    console.log(`    Error fetching ${url}: ${err.message}`);
    await browser.close();
    return [];
  }
}

/**
 * Fallback: fetch HTML directly and parse for og:image
 */
async function fetchPhotosWithFetch(url) {
  console.log(`  Fallback: fetching HTML directly for ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await res.text();

    // Extract og:image
    const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

    if (ogMatch) {
      return [{ src: ogMatch[1], alt: 'og:image fallback' }];
    }
  } catch (err) {
    console.log(`    Fallback failed: ${err.message}`);
  }
  return [];
}

/**
 * Download image and return buffer
 */
async function downloadImage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!res.ok) {
      console.log(`    Failed to download ${url}: ${res.status}`);
      return null;
    }
    return await res.arrayBuffer();
  } catch (err) {
    console.log(`    Download error: ${err.message}`);
    return null;
  }
}

/**
 * Upload image to Blob
 */
async function uploadToBlob(id, index, buffer) {
  const pathname = `place-photos/${id}/photos/${index}.jpg`;
  console.log(`    Uploading to Blob: ${pathname}`);

  if (DRY_RUN) {
    console.log(`    [DRY RUN] Would upload ${pathname}`);
    return `https://${BLOB_BASE}/${pathname}`;
  }

  const blob = await put(pathname, buffer, {
    access: 'public',
    contentType: 'image/jpeg'
  });

  return blob.url;
}

/**
 * Update discoveries.json in Blob
 */
async function updateDiscoveries(cottageResults) {
  console.log('\nUpdating discoveries.json in Blob...');

  // Fetch current discoveries
  const { blobs } = await list({ prefix: 'users/john/discoveries' });
  const blobUrl = blobs.find(b => b.pathname === 'users/john/discoveries.json')?.url || blobs[0].url;
  const res = await fetch(blobUrl);
  const raw = await res.json();
  const discoveries = Array.isArray(raw) ? raw : raw.discoveries || [];

  console.log(`  Current discoveries: ${discoveries.length}`);

  // Update or add each cottage
  for (const result of cottageResults) {
    if (!result.heroImage) continue;

    // Check if discovery exists
    const existingIdx = discoveries.findIndex(d => d.place_id === result.id);

    const discoveryEntry = {
      place_id: result.id,
      name: result.name,
      heroImage: result.heroImage,
      contextKey: 'trip:cottage-july-2026',
      source: 'disco:cottage-scan',
      platform: result.platform,
      url: result.url,
      discoveredAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      discoveries[existingIdx] = { ...discoveries[existingIdx], ...discoveryEntry };
      console.log(`  Updated: ${result.name}`);
    } else {
      discoveries.push(discoveryEntry);
      console.log(`  Added: ${result.name}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would save discoveries:');
    console.log(JSON.stringify(discoveries.slice(-7), null, 2));
    return;
  }

  // Delete old and upload new
  console.log(`  Saving ${discoveries.length} discoveries...`);
  for (const b of blobs) {
    await del(b.url);
  }

  await put('users/john/discoveries.json', JSON.stringify(discoveries), {
    access: 'public',
    addRandomSuffix: false
  });

  console.log('  Discoveries saved!');
}

/**
 * Main
 */
async function main() {
  console.log('Fetching cottage listing photos...\n');
  console.log(`DRY RUN: ${DRY_RUN}\n`);

  const results = [];

  for (const cottage of COTTAGES) {
    console.log(`Processing: ${cottage.name} (${cottage.platform})`);
    console.log(`  URL: ${cottage.url}`);

    let images = [];

    // Try Playwright first
    if (cottage.platform !== 'Kijiji') {
      // For Kijiji, skip Playwright and go straight to fallback
      images = await fetchPhotosWithPlaywright(cottage.url, cottage.platform);
    }

    // If no images, try fallback
    if (images.length === 0) {
      images = await fetchPhotosWithFetch(cottage.url);
    }

    // Special handling for Kijiji - skip if blocked
    if (cottage.platform === 'Kijiji' && images.length === 0) {
      console.log(`  ⚠️ Skipped - bot protected (Kijiji)`);
      results.push({ ...cottage, images: [], heroImage: null });
      continue;
    }

    console.log(`  Found ${images.length} images`);

    if (images.length === 0) {
      console.log(`  ⚠️ No images found`);
      results.push({ ...cottage, images: [], heroImage: null });
      continue;
    }

    // Filter for waterfront/lake images
    const waterfrontKeywords = ['lake', 'water', 'beach', 'waterfront', 'dock', 'shore', 'view'];
    const sortedImages = [...images].sort((a, b) => {
      const aWater = waterfrontKeywords.some(k => (a.alt || '').toLowerCase().includes(k));
      const bWater = waterfrontKeywords.some(k => (b.alt || '').toLowerCase().includes(k));
      return bWater - aWater;
    });

    // Upload up to 3 images
    const uploadedUrls = [];
    for (let i = 0; i < Math.min(sortedImages.length, 3); i++) {
      const img = sortedImages[i];
      console.log(`  Downloading: ${img.src.substring(0, 80)}...`);
      const buffer = await downloadImage(img.src);
      if (buffer) {
        const url = await uploadToBlob(cottage.id, i + 1, buffer);
        uploadedUrls.push(url);
      }
    }

    const heroImage = uploadedUrls[0] || null;
    console.log(`  Uploaded ${uploadedUrls.length} photos, hero: ${heroImage ? 'YES' : 'NO'}`);

    results.push({ ...cottage, images: uploadedUrls, heroImage });
  }

  console.log('\n--- Summary ---');
  const withPhotos = results.filter(r => r.heroImage).length;
  const withoutPhotos = results.filter(r => !r.heroImage).length;
  console.log(`Total: ${results.length}, With photos: ${withPhotos}, Without: ${withoutPhotos}`);

  // Update discoveries
  await updateDiscoveries(results);

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});