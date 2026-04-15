import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

function getHomepageMonitoringExplanation(item: {
  dueNow?: boolean;
  significanceLevel?: string;
  monitorExplanation?: string;
  monitorCadence?: string;
}): string | null {
  const explanation = item.monitorExplanation?.trim();
  if (!explanation) return null;
  const sig = item.significanceLevel ?? 'noise';
  if (!item.dueNow && sig !== 'critical' && sig !== 'notable') {
    return null;
  }

  const cadence = item.monitorCadence?.trim();
  if (!cadence) return explanation;
  if (!item.dueNow) return explanation;

  const compactCadence = cadence
    .replace(/^Check\s+/i, '')
    .replace(/\.$/, '')
    .replace(/^while\s+/i, 'while ');

  return `${explanation} · ${compactCadence}`;
}

describe('getHomepageMonitoringExplanation', () => {
  test('shows explanation for due items and appends a compact cadence hint', () => {
    assert.equal(
      getHomepageMonitoringExplanation({
        dueNow: true,
        significanceLevel: 'routine',
        monitorExplanation: 'belongs to an active trip',
        monitorCadence: 'Check weekly while the trip is live.',
      }),
      'belongs to an active trip · weekly while the trip is live',
    );
  });

  test('shows explanation for notable or critical changes without extra cadence noise', () => {
    assert.equal(
      getHomepageMonitoringExplanation({
        significanceLevel: 'notable',
        monitorExplanation: 'saved already · check weekly',
        monitorCadence: 'Check every 2–3 weeks.',
      }),
      'saved already · check weekly',
    );
    assert.equal(
      getHomepageMonitoringExplanation({ significanceLevel: 'critical', monitorExplanation: 'service days shifted' }),
      'service days shifted',
    );
  });

  test('suppresses explanation for quiet routine rows', () => {
    assert.equal(
      getHomepageMonitoringExplanation({ significanceLevel: 'routine', monitorExplanation: 'keeps resurfacing across sources' }),
      null,
    );
    assert.equal(getHomepageMonitoringExplanation({ significanceLevel: 'noise', monitorExplanation: '   ' }), null);
  });
});
