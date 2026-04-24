import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('homepage place-card links', () => {
  test('keeps the homepage card click-through app-local and Maps as a button action', () => {
    const source = readFileSync(path.join(process.cwd(), 'app/_components/PlaceCard.tsx'), 'utf8');

    assert.match(source, /className=\{`place-card-shell/, 'expected the broad click handler to live on the card shell wrapper');
    assert.match(source, /onClick=\{handleCardSurfaceClick\}/, 'expected the card shell wrapper to wire up the broad click handler');
    assert.match(source, /<Link href=\{detailHref\} className="place-card"/, 'expected the main card body to remain an app-local link');
    assert.match(source, /<Link href=\{detailHref\} className="place-card-detail-link"/, 'expected the footer detail CTA to remain an app-local link');
    assert.match(source, /router\.push\(detailHref\)/, 'expected broad card-surface clicks to route to the detail page');
    assert.match(source, /target\.closest\('a, button'\)/, 'expected embedded links and buttons to opt out of the broad click handler');
    assert.match(source, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);[\s\S]*window\.open\(mapsUrl, '_blank', 'noopener,noreferrer'\)/, 'expected the Maps button to opt out of shell navigation before opening Google Maps');
    assert.match(source, /<button[\s\S]*className="place-card-maps"/, 'expected the Maps action to render as a button');
    assert.doesNotMatch(source, /href=\{mapsUrl\}/, 'expected no external Maps anchor in the homepage card');
  });
});
