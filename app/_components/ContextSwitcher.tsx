'use client';

import { useState, useRef, useEffect } from 'react';
import Twemoji from './Twemoji';

interface ContextOption {
  key: string;
  label: string;
  emoji: string;
  type: string;
  dates?: string;
}

interface ContextSwitcherProps {
  contexts: ContextOption[];
  activeKey: string | null;
  onSelect: (key: string) => void;
}

const TYPE_EMOJI: Record<string, string> = {
  trip: '✈️',
  outing: '🍽️',
  radar: '📡',
};

const TYPE_LABEL: Record<string, string> = {
  trip: 'Trips',
  outing: 'Outings',
  radar: 'Radars',
};

export default function ContextSwitcher({ contexts, activeKey, onSelect }: ContextSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = contexts.find(c => c.key === activeKey);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Group by type
  const grouped: Record<string, ContextOption[]> = {};
  for (const ctx of contexts) {
    if (!grouped[ctx.type]) grouped[ctx.type] = [];
    grouped[ctx.type]!.push(ctx);
  }

  return (
    <div className="ctx-switcher" ref={ref}>
      <button
        className="ctx-switcher-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {active ? (
          <>
            <span className="ctx-switcher-emoji">
              <Twemoji emoji={active.emoji || TYPE_EMOJI[active.type] || '📌'} size="md" />
            </span>
            <span className="ctx-switcher-label">{active.label}</span>
          </>
        ) : (
          <span className="ctx-switcher-label">Select a context…</span>
        )}
        <span className={`ctx-switcher-chevron${open ? ' ctx-switcher-chevron-open' : ''}`}>▸</span>
      </button>

      {open && (
        <div className="ctx-switcher-dropdown" role="listbox">
          {(['trip', 'outing', 'radar'] as const).map(type => {
            const items = grouped[type];
            if (!items || items.length === 0) return null;
            return (
              <div key={type} className="ctx-switcher-group">
                <div className="ctx-switcher-group-label">{TYPE_LABEL[type]}</div>
                {items.map(ctx => (
                  <button
                    key={ctx.key}
                    className={`ctx-switcher-option${ctx.key === activeKey ? ' ctx-switcher-option-active' : ''}`}
                    onClick={() => {
                      onSelect(ctx.key);
                      setOpen(false);
                    }}
                    role="option"
                    aria-selected={ctx.key === activeKey}
                  >
                    <span className="ctx-switcher-option-emoji">
                      <Twemoji emoji={ctx.emoji || TYPE_EMOJI[ctx.type] || '📌'} size="sm" />
                    </span>
                    <span className="ctx-switcher-option-text">
                      <span className="ctx-switcher-option-label">{ctx.label}</span>
                      {ctx.dates && <span className="ctx-switcher-option-dates">{ctx.dates}</span>}
                    </span>
                    {ctx.key === activeKey && <span className="ctx-switcher-option-check">✓</span>}
                  </button>
                ))}
              </div>
            );
          })}
          <button
            className="ctx-switcher-new-trip"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('compass-new-trip'));
              setOpen(false);
            }}
          >
            + New Trip
          </button>
        </div>
      )}
    </div>
  );
}
