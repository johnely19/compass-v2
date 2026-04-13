import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('homepage place-card image styles', () => {
  test('keeps homepage card sizing isolated from the places browse card image class', () => {
    const cssPath = path.join(process.cwd(), 'app', 'globals.css');
    const browseClientPath = path.join(process.cwd(), 'app', 'placecards', 'PlacecardsBrowseClient.tsx');
    const css = readFileSync(cssPath, 'utf8');
    const browseClient = readFileSync(browseClientPath, 'utf8');

    const firstRuleIndex = css.indexOf('.place-card-image {');
    assert.notEqual(firstRuleIndex, -1, 'expected homepage .place-card-image rule to exist');

    const secondRuleIndex = css.indexOf('.place-card-image {', firstRuleIndex + 1);
    assert.equal(secondRuleIndex, -1, 'expected no duplicate .place-card-image rule that can override homepage sizing');

    const ruleEndIndex = css.indexOf('}', firstRuleIndex);
    const rule = css.slice(firstRuleIndex, ruleEndIndex + 1);

    assert.match(rule, /aspect-ratio:\s*16\s*\/\s*10/, 'homepage card images should keep a fixed aspect ratio');
    assert.match(rule, /background-size:\s*cover/, 'homepage card images should cover the frame');
    assert.match(rule, /background-position:\s*center/, 'homepage card images should stay centered');
    assert.match(rule, /position:\s*relative/, 'homepage card images should preserve positioned fallback content');
    assert.match(css, /\.place-browse-card-image\s*\{/, 'places browse should use its own image class in CSS');
    assert.match(browseClient, /className="place-browse-card-image"/, 'places browse should render its dedicated image class');
    assert.doesNotMatch(browseClient, /className="place-card-image"/, 'places browse should not reuse the homepage image class');
  });
});
