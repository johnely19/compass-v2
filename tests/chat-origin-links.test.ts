import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlaceCardPath, buildPlaceCardTemplate, buildPlaceCardUrl, resolveAppOrigin } from '../app/_lib/app-url';
import { buildSystemPrompt, type ChatContext } from '../app/_lib/chat/system-prompt';

describe('chat placecard links stay origin-aware', () => {
  test('buildPlaceCardUrl prefers the current request origin', () => {
    const url = buildPlaceCardUrl('ChIJ123', {
      appOrigin: 'http://localhost:3002/',
      contextKey: 'trip:boston-aug-2026',
    });

    assert.equal(url, 'http://localhost:3002/placecards/ChIJ123?context=trip%3Aboston-aug-2026');
  });

  test('resolveAppOrigin falls back to configured app url when request origin is absent', () => {
    const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    const prevVercelUrl = process.env.VERCEL_URL;

    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.example.com/';
    delete process.env.VERCEL_URL;

    try {
      assert.equal(resolveAppOrigin(), 'https://staging.example.com');
      assert.equal(buildPlaceCardTemplate(), 'https://staging.example.com/placecards/PLACE_ID');
    } finally {
      if (prevAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;

      if (prevVercelUrl === undefined) delete process.env.VERCEL_URL;
      else process.env.VERCEL_URL = prevVercelUrl;
    }
  });

  test('buildSystemPrompt injects the active app origin into place link instructions', () => {
    const context: ChatContext = {
      userCode: 'john2824',
      userCity: 'Toronto',
      preferences: null,
      manifest: null,
      recentDiscoveries: [],
    };

    const prompt = buildSystemPrompt(context, { appOrigin: 'http://localhost:3002' });

    assert.match(prompt, /http:\/\/localhost:3002\/placecards\/PLACE_ID/);
    assert.doesNotMatch(prompt, /compass-ai-agent\.vercel\.app/);
  });

  test('buildPlaceCardPath keeps placecard links app-local by default', () => {
    assert.equal(buildPlaceCardPath('ChIJabc'), '/placecards/ChIJabc');
  });
});
