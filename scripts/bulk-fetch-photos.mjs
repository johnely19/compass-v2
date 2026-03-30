/**
 * Bulk fetch photos from Google Places API for discoveries without heroImages
 * Uploads to Vercel Blob and updates discoveries.json
 */
import { list, put, del } from '@vercel/blob';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const BLOB_BASE = 'https://m0xwjuazo5epn9u7.public.blob.vercel-storage.com';

async function fetchPlacePhoto(placeId) {
  try {
    // Get photo reference
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?fields=photos,displayName&key=${GOOGLE_KEY}`
    );
    const data = await res.json();
    const photos = data.photos || [];
    if (!photos.length) return null;
    
    const photoName = photos[0].name;
    
    // Fetch the actual photo (max 800px)
    const photoRes = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${GOOGLE_KEY}`
    );
    if (!photoRes.ok) return null;
    
    const photoBuffer = await photoRes.arrayBuffer();
    
    // Upload to Blob
    const blobPath = `place-photos/${placeId}/photos/1.jpg`;
    const uploaded = await put(blobPath, photoBuffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
    });
    
    // Save manifest
    const manifestDir = path.join(process.cwd(), 'data/placecards', placeId);
    mkdirSync(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, 'manifest.json');
    let manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath)) : { place_id: placeId };
    manifest.images = [{ id: 'photo-1', path: uploaded.url, category: 'general', order: 1 }];
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    
    return uploaded.url;
  } catch (e) {
    return null;
  }
}

async function main() {
  // Load discoveries
  const { blobs } = await list({ prefix: 'users/john/discoveries' });
  const res = await fetch(blobs[0].url);
  const disc = await res.json();
  const discoveries = Array.isArray(disc) ? disc : disc.discoveries || [];

  // Find ones needing photos
  const needsPhotos = discoveries.filter(d => {
    if (d.heroImage) return false;
    if (!d.place_id?.startsWith('ChIJ')) return false;
    const mf = path.join(process.cwd(), 'data/placecards', d.place_id, 'manifest.json');
    if (!existsSync(mf)) return true;
    const m = JSON.parse(readFileSync(mf));
    return !(m.images || []).some(i => i?.path?.includes('blob.vercel'));
  });

  console.log(`Fetching photos for ${needsPhotos.length} places...`);
  
  let fetched = 0, failed = 0;
  
  for (let i = 0; i < needsPhotos.length; i++) {
    const d = needsPhotos[i];
    process.stdout.write(`[${i+1}/${needsPhotos.length}] ${d.name}... `);
    
    const url = await fetchPlacePhoto(d.place_id);
    if (url) {
      d.heroImage = url;
      fetched++;
      console.log('✓');
    } else {
      failed++;
      console.log('✗ (no photo)');
    }
    
    // Rate limit: 5 per second
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nDone: ${fetched} fetched, ${failed} failed`);
  
  // Save updated discoveries
  for (const b of blobs) await del(b.url);
  await put('users/john/discoveries.json', JSON.stringify(discoveries), {
    access: 'public', addRandomSuffix: false
  });
  console.log('Blob updated');
}

main().catch(console.error);
