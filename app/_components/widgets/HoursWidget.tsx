'use client';

import { useState, useEffect } from 'react';

interface HoursWidgetProps {
  hours: string[] | Record<string, string>;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Parse a time string like "9:00 AM" or "11:00\u202fAM" into minutes since midnight */
function parseTimeMins(str: string): number | null {
  // Normalize non-breaking spaces/narrow no-break spaces
  const clean = str.replace(/[\u00a0\u202f\u2009]/g, ' ').trim();
  const m = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const ampm = m[3].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

/** Parse "11:00 AM – 10:00 PM" into {open, close} minutes */
function parseHoursRange(str: string): { open: number; close: number } | null {
  const clean = str.replace(/[\u00a0\u202f\u2009\u2013\u2014-]/g, (c) => {
    if (c === '\u2013' || c === '\u2014' || c === '-') return '|';
    return ' ';
  });
  const parts = clean.split('|');
  if (parts.length < 2) return null;
  const p0 = parts[0];
  const p1 = parts[1];
  if (!p0 || !p1) return null;
  const open = parseTimeMins(p0.trim());
  const close = parseTimeMins(p1.trim());
  if (open === null || close === null) return null;
  return { open, close };
}

/** Format hours string, normalizing special unicode spaces */
function formatHours(str: string): string {
  return str.replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/\s*\u2013\s*/g, ' – ');
}

/** Normalize hours array/object to { dayName: hoursString } */
function normalizeHours(hours: string[] | Record<string, string>): Record<string, string> {
  if (Array.isArray(hours)) {
    const out: Record<string, string> = {};
    for (const entry of hours) {
      // Format: "Monday: 9:00 AM – 6:00 PM"
      const idx = entry.indexOf(':');
      if (idx < 0) continue;
      const day = entry.slice(0, idx).trim();
      const time = entry.slice(idx + 1).trim();
      if (day) out[day] = time;
    }
    return out;
  }
  return hours;
}

type Status = 'open' | 'closed' | 'closes-soon' | 'opens-soon' | 'closed-today';

function getStatus(todayHours: string | undefined, nowMins: number): Status {
  if (!todayHours || todayHours.toLowerCase().includes('closed')) return 'closed-today';
  const range = parseHoursRange(todayHours);
  if (!range) return 'closed-today';
  const { open, close } = range;
  if (nowMins < open) {
    return nowMins >= open - 60 ? 'opens-soon' : 'closed';
  }
  if (nowMins > close) return 'closed';
  if (nowMins >= close - 45) return 'closes-soon';
  return 'open';
}

const STATUS_LABELS: Record<Status, { label: string; icon: string; cls: string }> = {
  'open':        { label: 'Open',        icon: '✅', cls: 'hours-status-open' },
  'closed':      { label: 'Closed',      icon: '❌', cls: 'hours-status-closed' },
  'closes-soon': { label: 'Closes soon', icon: '⚠️', cls: 'hours-status-warn' },
  'opens-soon':  { label: 'Opens soon',  icon: '🕐', cls: 'hours-status-soon' },
  'closed-today':{ label: 'Closed today',icon: '❌', cls: 'hours-status-closed' },
};

export default function HoursWidget({ hours }: HoursWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const normalized = normalizeHours(hours);
  if (Object.keys(normalized).length === 0) return null;

  const todayName = now ? DAYS[now.getDay()] : null;
  const nowMins = now ? now.getHours() * 60 + now.getMinutes() : null;
  const todayHours = todayName ? normalized[todayName] : undefined;
  const status = todayName && nowMins !== null
    ? getStatus(todayHours, nowMins)
    : 'open';
  const statusInfo = STATUS_LABELS[status];

  return (
    <div className="hours-widget">
      <button
        className="hours-widget-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="hours-widget-today">
          <span className="hours-widget-day">{todayName ?? 'Today'}</span>
          <span className="hours-widget-time">{todayHours ? formatHours(todayHours) : 'Hours vary'}</span>
        </div>
        <div className="hours-widget-status-row">
          <span className={`hours-status-badge ${statusInfo.cls}`}>
            {statusInfo.icon} {statusInfo.label}
          </span>
          <span className="hours-widget-toggle">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="hours-widget-full">
          {DAYS.map(day => {
            const h = normalized[day];
            const isToday = day === todayName;
            return (
              <div key={day} className={`hours-row ${isToday ? 'hours-row-today' : ''}`}>
                <span className="hours-row-day">{day.slice(0, 3)}</span>
                <span className="hours-row-time">
                  {h ? formatHours(h) : 'Closed'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
