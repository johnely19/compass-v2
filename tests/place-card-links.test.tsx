import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('homepage place-card links', () => {
  test('keeps the homepage card click-through app-local and Maps as a button action', () => {
    const source = readFileSync(path.join(process.cwd(), 'app/_components/PlaceCard.tsx'), 'utf8');

    assert.match(source, /role="link"/, 'expected the whole card wrapper to expose link semantics');
    assert.match(source, /tabIndex=\{0\}/, 'expected the whole card wrapper to remain keyboard-focusable');
    assert.match(source, /router\.push\(detailHref\)/, 'expected broad card activation to route to the detail page');
    assert.match(source, /target\.closest\('a, button, input, textarea, select, summary, \[role="button"\]'\)/, 'expected embedded controls to opt out of the broad click handler');
    assert.match(source, /<button[\s\S]*className="place-card-maps"/, 'expected the Maps action to render as a button');
    assert.doesNotMatch(source, /href=\{mapsUrl\}/, 'expected no external Maps anchor in the homepage card');
  });
});
