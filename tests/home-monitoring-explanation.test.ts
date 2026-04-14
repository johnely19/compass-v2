import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

function getHomepageMonitoringExplanation(item: {
  dueNow?: boolean;
  significanceLevel?: string;
  monitorExplanation?: string;
}): string | null {
  const explanation = item.monitorExplanation?.trim();
  if (!explanation) return null;
  const sig = item.significanceLevel ?? 'noise';
  if (item.dueNow || sig === 'critical' || sig === 'notable') {
    return explanation;
  }
  return null;
}

describe('getHomepageMonitoringExplanation', () => {
  test('shows explanation for due items', () => {
    assert.equal(
      getHomepageMonitoringExplanation({ dueNow: true, significanceLevel: 'routine', monitorExplanation: 'belongs to an active trip' }),
      'belongs to an active trip',
    );
  });

  test('shows explanation for notable or critical changes', () => {
    assert.equal(
      getHomepageMonitoringExplanation({ significanceLevel: 'notable', monitorExplanation: 'saved already · check weekly' }),
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
