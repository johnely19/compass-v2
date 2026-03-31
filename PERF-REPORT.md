# Mobile Performance Audit Report - Issue #124

## Overview

This audit addresses the Mobile Performance Contract defined in ARCHITECTURE.md:
- LCP < 1.5s on 4G mobile simulation
- Homepage < 50KB HTML, < 100KB JS gzipped
- No layout shift (CLS < 0.1)
- Images: WebP only, explicit dimensions, lazy-loaded
- System fonts only — no web font CDN calls
- No blocking JS in <head>

---

## Issues Found (Before State)

### 1. Web Font CDN Call ❌
- **File**: `app/globals.css` (line 6)
- **Issue**: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap')` loaded Inter font from Google Fonts
- **Impact**: Blocking CSS request, delays first paint, increases page weight

### 2. Images Missing Dimensions ❌
- **Files**:
  - `app/_components/widgets/PhotoGallery.tsx` - `<img>` without width/height/loading
  - `app/_components/PlaceCardDetail.tsx` - Development carousel images without loading="lazy"
- **Impact**: No explicit aspect ratio causes CLS, no lazy loading delays image loading

### 3. next/image Not Used
- **Issue**: No usage of Next.js `<Image>` component for automatic WebP optimization
- **Note**: Images are served from external sources (Blob, local filesystem) so would require migration to next/image for full WebP benefit

### 4. next.config.ts Missing Image Optimization
- **Issue**: No `images.formats` configuration for WebP/AVIF
- **Impact**: Next.js doesn't explicitly configure modern image formats

### 5. No Blocking JS in <head> ✅
- **Status**: No `<script>` tags found in head - PASS

---

## Fixes Applied

### 1. Removed Web Font CDN Call ✅
- **File**: `app/globals.css`
- **Changes**:
  - Removed Google Fonts `@import` statement
  - Replaced font-family stack from `'Inter', -apple-system, ...` to system font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Expected Impact**: Eliminates ~30-50KB of font CSS, faster first paint, no layout shift from font loading

### 2. Added Image Dimensions and Lazy Loading ✅
- **Files**: `app/_components/widgets/PhotoGallery.tsx`
- **Changes**: Added `width={240} height={180} loading="lazy"` to `<img>` tag
- **Note**: CSS already defined explicit dimensions (240x180), but explicit HTML attributes improve browser pre-calc

- **File**: `app/_components/PlaceCardDetail.tsx`
- **Changes**: Added `loading="lazy"` to development carousel images
- **Expected Impact**: Below-fold images won't block initial load

### 3. Configured WebP/AVIF Image Formats ✅
- **File**: `next.config.ts`
- **Changes**: Added `images.formats: ['image/webp', 'image/avif']`
- **Expected Impact**: Next.js will serve WebP/AVIF when browser supports it (via next/image)

---

## Performance Contract Compliance

| Requirement | Status | Notes |
|------------|--------|-------|
| System fonts only | ✅ PASS | Replaced Google Fonts with system stack |
| Images with explicit dimensions | ✅ PASS | Added width/height to PhotoGallery, CSS dimensions already exist for carousel |
| WebP via next/image | ⚠️ PARTIAL | Config added, but images don't use next/image component |
| No CDN font calls | ✅ PASS | Removed Google Fonts @import |
| No blocking JS in <head> | ✅ PASS | No script tags in head |
| Lazy loading | ✅ PASS | Added loading="lazy" to below-fold images |

---

## Notes

### Bundle Size
- Could not run build (node_modules not present in worktree)
- Dependencies are lean: next@16.2.1, react@19.2.4, @anthropic-ai/sdk, @vercel/blob
- Expected JS bundle should be well under 100KB gzipped

### Future Improvements
1. Migrate `<img>` tags to Next.js `<Image>` component for automatic WebP serving
2. Consider adding `sharp` for better image optimization during build
3. The many `.jpg` files in `public/cottages/` could be converted to WebP (not done automatically as they're managed externally)

---

## Summary

The mobile performance audit identified and fixed:
- **1 font CDN call removed** (Google Fonts → system fonts)
- **2 components updated** with lazy loading
- **1 config updated** for WebP/AVIF formats

Expected improvements:
- Faster LCP (no font blocking)
- Zero CLS from fonts
- Reduced initial page weight (30-50KB savings from font removal)
- Better mobile experience with lazy-loaded below-fold images