'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import type { ParsedAccommodation } from '../api/trip/parse-accommodation/route';
import TripIntelInput from './TripIntelInput';

interface FlightLeg {
  date: string;
  flight: string;
  operator?: string;
  aircraft?: string;
  from: string;
  to: string;
  terminal?: string;
  departs: string;
  arrives: string;
  cabin?: string;
  duration?: string;
}

interface TravelData {
  outbound?: FlightLeg;
  return?: FlightLeg;
}

interface AccommodationData {
  name: string;
  address?: string;
}

interface PlanningItem {
  status: 'open' | 'booked';
  details?: string;
}

interface TripPlanning {
  travel: PlanningItem;
  accommodation: PlanningItem;
}

interface TripPlanningWidgetProps {
  userId: string;
  contextKey: string;
  travel?: TravelData;
  accommodation?: AccommodationData;
  bookingStatus?: string;
  savedCount?: number;
  purpose?: string;
  people?: Array<{ name: string; relation?: string }>;
}

const STORAGE_KEY_PREFIX = 'compass-trip-planning-';

function load(userId: string, contextKey: string): TripPlanning {
  if (typeof window === 'undefined') return defaultPlanning();
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}-${contextKey}`);
    return raw ? (JSON.parse(raw) as TripPlanning) : defaultPlanning();
  } catch { return defaultPlanning(); }
}

function save(userId: string, contextKey: string, p: TripPlanning): void {
  try { localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}-${contextKey}`, JSON.stringify(p)); } catch {}
}

function defaultPlanning(): TripPlanning {
  return { travel: { status: 'open' }, accommodation: { status: 'open' } };
}

function FlightCard({ leg, label }: { leg: FlightLeg; label: string }) {
  return (
    <div className="flight-card">
      <div className="flight-card-header">
        <span className="flight-label">{label}</span>
        <span className="flight-number">{leg.flight}</span>
        <span className="flight-date">{leg.date}</span>
      </div>
      <div className="flight-route">
        <div className="flight-endpoint">
          <span className="flight-time">{leg.departs}</span>
          <span className="flight-airport">{leg.from}</span>
        </div>
        <div className="flight-middle">
          <span className="flight-duration">{leg.duration}</span>
          <div className="flight-line">→</div>
        </div>
        <div className="flight-endpoint">
          <span className="flight-time">{leg.arrives}</span>
          <span className="flight-airport">{leg.to}</span>
          {leg.terminal && <span className="flight-terminal">{leg.terminal}</span>}
        </div>
      </div>
      {leg.operator && (
        <div className="flight-meta">{leg.operator}{leg.aircraft ? ` · ${leg.aircraft}` : ''}</div>
      )}
    </div>
  );
}

export default function TripPlanningWidget({
  userId, contextKey, travel, accommodation, bookingStatus, savedCount = 0, purpose, people,
}: TripPlanningWidgetProps) {
  const [planning, setPlanning] = useState<TripPlanning>(defaultPlanning);
  const [travelExpanded, setTravelExpanded] = useState(false);
  const [accomInputOpen, setAccomInputOpen] = useState(false);
  const [accomText, setAccomText] = useState('');
  const [accomParsing, setAccomParsing] = useState(false);
  const [parsedAccom, setParsedAccom] = useState<ParsedAccommodation | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const p = load(userId, contextKey);
    // Auto-mark booked if manifest has data
    if ((travel?.outbound || bookingStatus === 'fully-booked') && p.travel.status === 'open') {
      p.travel = { status: 'booked' };
    }
    if (accommodation?.name && p.accommodation.status === 'open') {
      p.accommodation = { status: 'booked' };
    }
    setPlanning(p);
  }, [userId, contextKey, travel, accommodation, bookingStatus]);

  function toggle(field: 'travel' | 'accommodation') {
    if (field === 'accommodation' && planning.accommodation.status === 'open') {
      // Open the input instead of directly toggling
      setAccomInputOpen(true);
      setTimeout(() => textareaRef.current?.focus(), 50);
      return;
    }
    const cur = planning[field].status;
    const next: TripPlanning = {
      ...planning,
      [field]: { status: cur === 'booked' ? 'open' : 'booked' },
    };
    if (field === 'accommodation' && cur === 'booked') {
      setAccomInputOpen(false);
      setParsedAccom(null);
    }
    setPlanning(next);
    save(userId, contextKey, next);
  }

  async function parseAndSaveAccom() {
    if (!accomText.trim()) return;
    setAccomParsing(true);
    try {
      const res = await fetch('/api/trip/parse-accommodation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: accomText, contextKey }),
      });
      if (!res.ok) throw new Error('parse failed');
      const parsed = await res.json() as ParsedAccommodation;
      setParsedAccom(parsed);
      const next: TripPlanning = {
        ...planning,
        accommodation: { status: 'booked', details: parsed.name },
      };
      setPlanning(next);
      save(userId, contextKey, next);
      setAccomInputOpen(false);
    } catch {
      // fallback: save raw text
      const next: TripPlanning = {
        ...planning,
        accommodation: { status: 'booked', details: accomText },
      };
      setPlanning(next);
      save(userId, contextKey, next);
      setAccomInputOpen(false);
    } finally {
      setAccomParsing(false);
    }
  }

  const reviewUrl = `/review/${encodeURIComponent(contextKey)}`;

  // Build compact travel summary line
  const travelSummary = travel?.outbound
    ? `${travel.outbound.flight} · ${travel.outbound.departs}→${travel.outbound.arrives}`
    : null;
  const accomSummary = parsedAccom?.name || accommodation?.name || null;

  // Build travel summary: "YTZ-LGA Apr 27"
  const travelLine = travel?.outbound
    ? `${travel.outbound.from.split('(')[1]?.replace(')','') || travel.outbound.from}-${travel.outbound.to.split('(')[1]?.replace(')','') || travel.outbound.to} ${travel.outbound.date.replace(/^\d{4}-/,'').replace(/-(\d{2})$/,' $1').replace('-',' ').replace(/^(\w{3}) (\d+)$/, (_, m, d) => `${m} ${parseInt(d)}`)}`
    : null;

  // Shorter: just "YTZ→LGA · Apr 27"
  const travelShort = travel?.outbound
    ? (() => {
        const from = travel.outbound.from.match(/\(([A-Z]{3})\)/)?.[1] || travel.outbound.from.split(' ')[0];
        const to = travel.outbound.to.match(/\(([A-Z]{3})\)/)?.[1] || travel.outbound.to.split(' ')[0];
        const d = new Date(travel.outbound.date);
        const mon = d.toLocaleString('en-US', { month: 'short' });
        const day = d.getDate();
        return `${from}-${to} ${mon} ${day}`;
      })()
    : null;

  return (
    <div className="tpw">

      {/* Row 1: Travel  [Booked]  YTZ-LGA Apr 27   (1 saved) */}
      <div className="tpw-row">
        <span className="tpw-label">Travel</span>
        <button
          className={`tpw-status ${planning.travel.status === 'booked' ? 'tpw-status-booked' : 'tpw-status-open'}`}
          onClick={() => {
            if (planning.travel.status === 'booked' && travelShort) {
              setTravelExpanded(e => !e);
            } else {
              toggle('travel');
            }
          }}
        >
          {planning.travel.status === 'booked' ? 'Booked' : 'Unbooked'}
        </button>
        {planning.travel.status === 'booked' && travelShort && !travelExpanded && (
          <span className="tpw-summary" onClick={() => setTravelExpanded(true)}>{travelShort}</span>
        )}
        {savedCount > 0 && (
          <Link href={`${reviewUrl}?tab=saved`} className="tpw-saved">
            {savedCount} saved
          </Link>
        )}
      </div>

      {/* Expanded flight cards */}
      {travelExpanded && travel?.outbound && (
        <div className="tpw-flights">
          <FlightCard leg={travel.outbound} label="Out" />
          {travel.return && <FlightCard leg={travel.return} label="Return" />}
          <button className="tpw-collapse" onClick={() => setTravelExpanded(false)}>↑ collapse</button>
        </div>
      )}

      {/* Row 2: Accom.  [Booked]  126 Leonard Ave  Review → */}
      <div className={`tpw-row ${accomInputOpen ? 'tpw-row-expanding' : ''}`}>
        <span className="tpw-label">Accom.</span>
        <button
          className={`tpw-status ${planning.accommodation.status === 'booked' ? 'tpw-status-booked' : 'tpw-status-open'}`}
          onClick={() => toggle('accommodation')}
        >
          {planning.accommodation.status === 'booked' ? 'Booked' : 'Unbooked'}
        </button>
        {!accomInputOpen && accomSummary && planning.accommodation.status === 'booked' && (
          <span className="tpw-summary">{accomSummary}</span>
        )}
        <Link href={reviewUrl} className="tpw-review">Review →</Link>
      </div>

      {/* Accommodation input expansion */}
      {accomInputOpen && (
        <div className="tpw-accom-input">
          <textarea
            ref={textareaRef}
            className="tpw-accom-textarea"
            value={accomText}
            onChange={e => setAccomText(e.target.value)}
            placeholder="Describe your accommodation..."
            rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) parseAndSaveAccom(); }}
          />
          <div className="tpw-accom-actions">
            <button className="tpw-accom-confirm" onClick={parseAndSaveAccom} disabled={accomParsing || !accomText.trim()}>
              {accomParsing ? 'Parsing...' : 'Save'}
            </button>
            <button className="tpw-accom-cancel" onClick={() => setAccomInputOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Row 3: Trip Notes — always-visible transparent input with thin border */}
      <TripIntelInput contextKey={contextKey} inlineMode purpose={purpose} people={people} />

    </div>
  );
}
