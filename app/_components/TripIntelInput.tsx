'use client';

import { useState } from 'react';

interface TripIntelInputProps {
  contextKey: string;
  onSaved?: () => void;
  inlineMode?: boolean; // always-visible transparent input row
  purpose?: string;
  people?: Array<{ name: string; relation?: string }>;
  base?: { address?: string; host?: string; zone?: string };
  monitoringHighlights?: string[];
  monitoringPrompts?: Array<{ label: string; detail: string }>;
}

interface SaveResult {
  message: string;
  suggestions?: string[] | null;
  prefCount?: number;
  tripFieldCount?: number;
}

export default function TripIntelInput({ contextKey, onSaved, inlineMode, purpose, people, base, monitoringHighlights = [], monitoringPrompts = [] }: TripIntelInputProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [error, setError] = useState('');
  const [expandOpen, setExpandOpen] = useState(false);

  async function handleSave() {
    if (!text.trim()) return;
    setLoading(true);
    setResult(null);
    setError('');
    try {
      const res = await fetch('/api/trip/parse-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), contextKey }),
      });
      const data = await res.json() as SaveResult & { error?: string };
      if (res.ok) {
        setResult(data);
        setText('');
        // Close after 4s (long enough to read suggestions)
        setTimeout(() => { setOpen(false); setResult(null); onSaved?.(); }, 4000);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Error saving — check connection');
    } finally {
      setLoading(false);
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this trip? You can restore it later.')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/contexts/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextKey, action: 'archive' }),
      });
      if (res.ok) {
        window.location.href = '/';
      } else {
        setError('Failed to archive trip');
      }
    } catch {
      setError('Error archiving trip');
    } finally {
      setLoading(false);
    }
  }

  // Inline mode: always-visible single-line input (the "Trip Notes" row in the widget)
  if (inlineMode) {
    const leadMonitoringHighlight = monitoringHighlights[0];
    const remainingMonitoringHighlights = monitoringHighlights.slice(1);
    return (
      <div className="tpw-notes-row">
        <span className="tpw-label">Trip Notes</span>
        <button className="tpw-notes-edit-link" onClick={() => setExpandOpen(e => !e)}>
          {expandOpen ? '↑ cancel' : 'edit ↓'}
        </button>
        <div className={`tpw-notes-expand ${expandOpen ? 'open' : ''}`}>
          <div className="tpw-notes-expand-body">
            {/* Lead monitoring signal — most important, show first */}
            {leadMonitoringHighlight && (
              <div className="tpw-notes-monitoring-lead">
                <span className="tpw-notes-monitoring-lead-icon">👁</span>
                <span className="tpw-notes-monitoring-lead-text">Watch now: {leadMonitoringHighlight}</span>
              </div>
            )}
            {purpose && <div className="tpw-notes-expand-purpose">Purpose: {purpose}</div>}
            {people && people.length > 0 && (
              <div>
                {people.map((p, i) => (
                  <span key={i} className="tpw-notes-expand-person">
                    {p.name}
                    {p.relation && <span className="tpw-notes-expand-person-rel">({p.relation})</span>}
                  </span>
                ))}
              </div>
            )}
            {base && (base.address || base.host || base.zone) && (
              <div className="tpw-notes-expand-base">
                <span className="tpw-notes-expand-base-icon">🏠</span>
                <span className="tpw-notes-expand-base-text">
                  {base.address}
                  {base.host && <span className="tpw-notes-expand-base-host"> ({base.host})</span>}
                  {base.zone && <span className="tpw-notes-expand-base-zone"> · {base.zone}</span>}
                </span>
              </div>
            )}
            {remainingMonitoringHighlights.length > 0 && (
              <div className="tpw-notes-monitoring">
                <div className="tpw-notes-monitoring-label">Watch changes</div>
                <div className="tpw-notes-monitoring-list">
                  {remainingMonitoringHighlights.map((item, i) => (
                    <div key={`${i}:${item}`} className="tpw-notes-monitoring-item">{item}</div>
                  ))}
                </div>
              </div>
            )}
            {monitoringPrompts.length > 0 && (
              <div className="tpw-notes-monitoring">
                <div className="tpw-notes-monitoring-label">Suggested next move</div>
                <div className="tpw-notes-monitoring-list">
                  {monitoringPrompts.map((item, i) => (
                    <div key={`${i}:${item.label}`} className="tpw-notes-monitoring-item">
                      <strong>{item.label}:</strong> {item.detail}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button className="tpw-archive-btn" onClick={handleArchive} disabled={loading}>
              Archive trip
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button className="trip-intel-add-btn" onClick={() => setOpen(true)}>
        + Add trip details
      </button>
    );
  }

  return (
    <div className="trip-intel-input-panel">
      <textarea
        className="trip-intel-textarea"
        placeholder="Tell me who you're seeing, what you want to do, paste a confirmation email..."
        value={text}
        onChange={e => setText(e.target.value)}
        rows={4}
        autoFocus
      />
      <div className="trip-intel-input-actions">
        <button className="btn btn-primary" onClick={handleSave} disabled={loading || !text.trim()}>
          {loading ? 'Saving…' : 'Save'}
        </button>
        <button className="filter-clear" onClick={() => { setOpen(false); setText(''); setResult(null); setError(''); }}>
          Cancel
        </button>
        {error && <span className="trip-intel-input-msg" style={{ color: 'var(--danger)' }}>❌ {error}</span>}
      </div>

      {/* Confirmation + suggestions */}
      {result && (
        <div className="trip-intel-result">
          <div className="trip-intel-result-summary">✅ {result.message}</div>
          {result.suggestions && result.suggestions.length > 0 && (
            <div className="trip-intel-suggestions">
              <div className="trip-intel-suggestions-label">💡 Preference patterns noticed:</div>
              {result.suggestions.map((s, i) => (
                <div key={i} className="trip-intel-suggestion">{s}</div>
              ))}
              <div className="trip-intel-suggestions-note">
                These won&apos;t be added automatically — mention it to your concierge to save permanently.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
