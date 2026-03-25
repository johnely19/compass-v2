'use client';

import { useState } from 'react';

interface TripIntelInputProps {
  contextKey: string;
  onSaved?: () => void;
}

export default function TripIntelInput({ contextKey, onSaved }: TripIntelInputProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSave() {
    if (!text.trim()) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/trip/parse-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), contextKey }),
      });
      const data = await res.json();
      if (res.ok) {
        const count = Object.keys(data.changes || {}).length;
        setMessage(count > 0 ? `✅ Saved ${count} field(s)` : '— No new info found');
        setText('');
        setTimeout(() => { setOpen(false); setMessage(''); onSaved?.(); }, 1500);
      } else {
        setMessage(`❌ ${data.error || 'Failed'}`);
      }
    } catch {
      setMessage('❌ Error saving');
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
          onClick={() => { setOpen(false); setText(''); setMessage(''); }}
        >
          Cancel
        </button>
        {message && <span className="trip-intel-input-msg">{message}</span>}
      </div>
    </div>
  );
}
