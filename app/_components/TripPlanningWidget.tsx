'use client';

import { useState, useEffect } from 'react';

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
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}-${contextKey}`, JSON.stringify(planning));
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

export default function TripPlanningWidget({ userId, contextKey }: TripPlanningWidgetProps) {
  const [planning, setPlanning] = useState<TripPlanning>(defaultPlanning);
  const [editingTravel, setEditingTravel] = useState(false);
  const [editingAccom, setEditingAccom] = useState(false);
  const [travelDetails, setTravelDetails] = useState('');
  const [accomDetails, setAccomDetails] = useState('');

  useEffect(() => {
    const p = loadPlanning(userId, contextKey);
    setPlanning(p);
    setTravelDetails(p.travel.details ?? '');
    setAccomDetails(p.accommodation.details ?? '');
  }, [userId, contextKey]);

  function update(field: 'travel' | 'accommodation', item: PlanningItem) {
    const next = { ...planning, [field]: item };
    setPlanning(next);
    savePlanning(userId, contextKey, next);
  }

  function bookTravel() {
    update('travel', { status: 'booked', details: travelDetails, bookedAt: new Date().toISOString() });
    setEditingTravel(false);
  }

  function bookAccom() {
    update('accommodation', { status: 'booked', details: accomDetails, bookedAt: new Date().toISOString() });
    setEditingAccom(false);
  }

  const bookedCount = [planning.travel, planning.accommodation].filter(i => i.status !== 'open').length;

  return (
    <div className="trip-planning-widget">
      <div className="trip-planning-header">
        <span className="trip-planning-title">Trip Planning</span>
        <span className="text-muted text-xs">
          {bookedCount === 2 ? '✅ Fully booked' : `${bookedCount}/2 booked`}
        </span>
      </div>

      {/* Travel */}
      <div className="trip-planning-row">
        <div className="trip-planning-row-header">
          <span>✈️ Travel</span>
          <StatusBadge status={planning.travel.status} />
        </div>
        {planning.travel.status === 'open' && !editingTravel && (
          <button className="trip-planning-action" onClick={() => setEditingTravel(true)}>
            Mark as booked
          </button>
        )}
        {editingTravel && (
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
        {planning.travel.details && planning.travel.status !== 'open' && (
          <div className="trip-planning-details">
            {planning.travel.details}
            <button className="trip-planning-action-secondary" onClick={() => { update('travel', { status: 'open' }); setEditingTravel(false); }}>
              Reopen
            </button>
          </div>
        )}
      </div>

      {/* Accommodation */}
      <div className="trip-planning-row">
        <div className="trip-planning-row-header">
          <span>🏨 Accommodation</span>
          <StatusBadge status={planning.accommodation.status} />
        </div>
        {planning.accommodation.status === 'open' && !editingAccom && (
          <button className="trip-planning-action" onClick={() => setEditingAccom(true)}>
            Mark as booked
          </button>
        )}
        {editingAccom && (
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
        {planning.accommodation.details && planning.accommodation.status !== 'open' && (
          <div className="trip-planning-details">
            {planning.accommodation.details}
            <button className="trip-planning-action-secondary" onClick={() => { update('accommodation', { status: 'open' }); setEditingAccom(false); }}>
              Reopen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
