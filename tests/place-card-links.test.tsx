import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';

describe('homepage place-card composition', () => {
  test('keeps the detail route app-local while preserving secondary controls', () => {
    const source = readFileSync(path.join(process.cwd(), 'app/_components/PlaceCard.tsx'), 'utf8');

    assert.match(
      source,
      /<Link href=\{`\/placecards\/\$\{place_id \|\| id\}\?context=\$\{encodeURIComponent\(contextKey\)\}`\} className="place-card">/,
      'expected the main card body to stay an app-local Next link',
    );
    assert.match(
      source,
      /className="place-card-maps"/,
      'expected the Google Maps action to remain present on homepage cards',
    );
    assert.match(
      source,
      /target="_blank" rel="noopener noreferrer" className="place-card-maps"/,
      'expected the Maps action to stay external and isolated from Compass navigation',
    );
    assert.match(
      source,
      /className="place-card-triage-overlay"/,
      'expected the triage overlay wrapper to stay rendered outside the main card link',
    );
    assert.match(
      source,
      /<TriageButtons userId=\{userId\} contextKey=\{contextKey\} placeId=\{place_id\} size="sm" \/>/,
      'expected homepage cards to keep inline triage controls',
    );
    assert.match(
      source,
      /className=\{`place-card-chat-btn\$\{isChatTarget \? ' place-card-chat-btn-active' : ''\}`\}/,
      'expected the chat-about affordance to remain wired on homepage cards',
    );
    assert.match(
      source,
      /onClick=\{handleChatAbout\}/,
      'expected the chat-about button to preserve its dedicated click handler',
    );
  });
});
