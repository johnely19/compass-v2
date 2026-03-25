'use client';

import { useState } from 'react';

interface TripIntelInputProps {
  contextKey: string;
  onSaved?: () => void;
}

interface SaveResult {
  message: string;
  suggestions?: string[] | null;
  prefCount?: number;
  tripFieldCount?: number;
}

export default function TripIntelInput({ contextKey, onSaved }: TripIntelInputProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [error, setError] = useState('');

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
        placeholder="Tell me who you're seeing, what you want to do, paste a confirmation email... e.g. 'Going to Dessa's art show Tuesday evening, staying with Arnold at 126 Leonard St'"
        value={text}
        onChange={e => setText(e.target.value)}
        rows={4}
        autoFocus
      />
      <div className="trip-intel-input-actions">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={loading || !text.trim()}
        >
          {loading ? 'Saving…' : 'Save'}
        </button>
        <button
          className="filter-clear"
          onClick={() => { setOpen(false); setText(''); setResult(null); setError(''); }}
        >
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
