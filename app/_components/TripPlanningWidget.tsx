'use client';

import { useState, useEffect } from 'react';

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
  status?: string;
}

interface PlanningItem {
  status: 'open' | 'booked' | 'locked';
  details?: string;
  bookedAt?: string;
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
}

const STORAGE_KEY_PREFIX = 'compass-trip-planning-';

function loadPlanning(userId: string, contextKey: string): TripPlanning {
  if (typeof window === 'undefined') return defaultPlanning();
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}-${contextKey}`);
    return raw ? (JSON.parse(raw) as TripPlanning) : defaultPlanning();
  } catch { return defaultPlanning(); }
}

function savePlanning(userId: string, contextKey: string, planning: TripPlanning): void {
  if (typeof window === 'undefined') return;
  localStorage.set(`${STORAGE_KEY_PREFIX}${userId}-${contextKey}`, JSON.stringify(planning));
}

function defaultPlanning(): TripPlanning {
  return {
    travel: { status: 'open' },
    accommodation: { status: 'open' },
  };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    open: { label: 'Open', className: 'status-badge status-paused' },
    booked: { label: 'Booked', className: 'status-badge status-active' },
    locked: { label: 'Confirmed', className: 'status-badge status-completed' },
  };
  const s = map[status] ?? map.open;
  return <span className={s?.className}>{s?.label}</span>;
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
          <div className="flight-line">✈️</div>
        </div>
        <div className="flight-endpoint">
          <span className="flight-time">{leg.arrives}</span>
          <span className="flight-airport">{leg.to}</span>
          {leg.terminal && <span className="flight-terminal">{leg.terminal}</span>}
        </div>
      </div>
      {leg.operator && (
        <div className="flight-meta">{leg.operator}{leg.aircraft ? ` · ${leg.aircraft}` : ''}{leg.cabin ? ` · ${leg.cabin}` : ''}</div>
      )}
    </div>
  );
}

export default function TripPlanningWidget({ userId, contextKey, travel, accommodation, bookingStatus }: TripPlanningWidgetProps) {
  const [planning, setPlanning] = useState<TripPlanning>(defaultPlanning);
  const [editingTravel, setEditingTravel] = useState(false);
  const [editingAccom, setEditingAccom] = useState(false);
  const [travelDetails, setTravelDetails] = useState('');
  const [accomDetails, setAccomDetails] = useState('');

  useEffect(() => {
    const p = loadPlanning(userId, contextKey);
    // If manifest has structured travel data, auto-mark as booked
    if (travel?.outbound && p.travel.status === 'open') {
      p.travel = { status: 'booked', bookedAt: p.travel.bookedAt };
    }
    if (accommodation?.name && p.accommodation.status === 'open') {
      p.accommodation = { status: 'booked', details: `${accommodation.name}${accommodation.address ? ` at ${accommodation.address}` : ''}`, bookedAt: p.accommodation.bookedAt };
    }
    setPlanning(p);
    setTravelDetails(p.travel.details ?? '');
    setAccomDetails(p.accommodation.details ?? accommodation?.name ?? '');
  }, [userId, contextKey, travel, accommodation]);

  function update(field: 'travel' | 'accommodation', item: PlanningItem) {
    const next = { ...planning, [field]: item };
    setPlanning(next);
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}-${contextKey}`, JSON.stringify(next));
    } catch {}
  }

  function bookTravel() {
    update('travel', { status: 'booked', details: travelDetails, bookedAt: new Date().toISOString() });
    setEditingTravel(false);
  }

  function bookAccom() {
    update('accommodation', { status: 'booked', details: accomDetails, bookedAt: new Date().toISOString() });
    setEditingAccom(false);
  }

  const isFullyBooked = bookingStatus === 'fully-booked' ||
    [planning.travel, planning.accommodation].every(i => i.status !== 'open');

  return (
    <div className="trip-planning-widget">
      <div className="trip-planning-header">
        <span className="trip-planning-title">Trip Planning</span>
        <span className="text-muted text-xs">
          {isFullyBooked ? 'Fully booked' : `${[planning.travel, planning.accommodation].filter(i => i.status !== 'open').length}/2 booked`}
        </span>
      </div>

      {/* Travel */}
      <div className="trip-planning-row">
        <div className="trip-planning-row-header">
          <span className="trip-planning-label">Travel</span>
          {planning.travel.status === 'booked' && (
            <button className="trip-planning-unbook" onClick={() => { update('travel', { status: 'open' }); }}>
              Unbook
            </button>
          )}
        </div>

        {/* Structured flight data from manifest */}
        {travel?.outbound && (
          <div className="flight-cards">
            <FlightCard leg={travel.outbound} label="Outbound" />
            {travel.return && <FlightCard leg={travel.return} label="Return" />}
          </div>
        )}

        {/* Fallback: manual entry */}
        {!travel?.outbound && planning.travel.status === 'open' && !editingTravel && (
          <button className="trip-planning-action" onClick={() => setEditingTravel(true)}>
            Mark as booked
          </button>
        )}
        {!travel?.outbound && editingTravel && (
          <div className="trip-planning-edit">
            <input
              type="text"
              value={travelDetails}
              onChange={e => setTravelDetails(e.target.value)}
              placeholder="e.g. Air Canada YTZ→LGA, April 27"
              className="trip-planning-input"
              autoFocus
            />
            <div className="trip-planning-edit-actions">
              <button className="trip-planning-action" onClick={bookTravel}>Confirm</button>
              <button className="trip-planning-action-secondary" onClick={() => setEditingTravel(false)}>Cancel</button>
            </div>
          </div>
        )}
        {!travel?.outbound && planning.travel.details && planning.travel.status === 'booked' && (
          <div className="trip-planning-details">{planning.travel.details}</div>
        )}
      </div>

      {/* Accommodation */}
      <div className="trip-planning-row">
        <div className="trip-planning-row-header">
          <span className="trip-planning-label">Accommodation</span>
          {planning.accommodation.status === 'booked' && (
            <button className="trip-planning-unbook" onClick={() => { update('accommodation', { status: 'open' }); }}>
              Unbook
            </button>
          )}
        </div>

        {/* Structured accommodation from manifest */}
        {accommodation?.name && (
          <div className="accom-details">
            <span className="accom-name">{accommodation.name}</span>
            {accommodation.address && <span className="accom-address">{accommodation.address}</span>}
          </div>
        )}

        {!accommodation?.name && planning.accommodation.status === 'open' && !editingAccom && (
          <button className="trip-planning-action" onClick={() => setEditingAccom(true)}>
            Mark as booked
          </button>
        )}
        {!accommodation?.name && editingAccom && (
          <div className="trip-planning-edit">
            <input
              type="text"
              value={accomDetails}
              onChange={e => setAccomDetails(e.target.value)}
              placeholder="e.g. Ace Hotel, 29th St"
              className="trip-planning-input"
              autoFocus
            />
            <div className="trip-planning-edit-actions">
              <button className="trip-planning-action" onClick={bookAccom}>Confirm</button>
              <button className="trip-planning-action-secondary" onClick={() => setEditingAccom(false)}>Cancel</button>
            </div>
          </div>
        )}
        {!accommodation?.name && planning.accommodation.details && planning.accommodation.status === 'booked' && (
          <div className="trip-planning-details">{planning.accommodation.details}</div>
        )}
      </div>
    </div>
  );
}
