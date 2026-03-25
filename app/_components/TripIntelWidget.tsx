'use client';

import { useState } from 'react';

interface TripPerson {
  name: string;
  relation?: string;
  base?: string;
  note?: string;
}

interface ScheduleDay {
  date: string;
  notes: string;
  highlight?: boolean;
}

interface AnchorExperience {
  name: string;
  type?: string;
  note?: string;
  placeId?: string;
}

interface TravelLeg {
  date?: string;
  flight?: string;
  operator?: string;
  from?: string;
  to?: string;
  departs?: string;
  arrives?: string;
  cabin?: string;
}

export interface TripIntelData {
  purpose?: string;
  people?: TripPerson[];
  schedule?: ScheduleDay[];
  priorities?: string[];
  anchor_experiences?: AnchorExperience[];
  not_this_trip?: string[];
  base?: { address?: string; host?: string; zone?: string };
  travel?: { outbound?: TravelLeg; return?: TravelLeg };
}

interface TripIntelWidgetProps {
  intel: TripIntelData;
  tripKey: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isHighlight(notes: string): boolean {
  return /\bart show\b|gallery|opening|concert|show\b|museum/i.test(notes);
}

export default function TripIntelWidget({ intel }: TripIntelWidgetProps) {
  const [expanded, setExpanded] = useState(false);

  const hasMeaningfulData = intel.purpose || intel.people?.length || intel.schedule?.length ||
    intel.anchor_experiences?.length || intel.priorities?.length;

  if (!hasMeaningfulData) return null;

  // Show a 2-line preview when collapsed
  const previewParts: string[] = [];
  if (intel.purpose) previewParts.push(intel.purpose);
  if (intel.people?.length) previewParts.push(intel.people.map(p => p.name).join(', '));

  return (
    <div className="trip-intel-widget">
      <button
        className="trip-intel-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="trip-intel-preview">
          <span className="trip-intel-icon">📋</span>
          <span className="trip-intel-preview-text">
            {expanded ? 'Trip Intelligence' : (previewParts[0] || 'Trip details')}
          </span>
        </div>
        <span className="trip-intel-toggle">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="trip-intel-body">
          {/* Purpose */}
          {intel.purpose && (
            <div className="trip-intel-section">
              <div className="trip-intel-row">
                <span className="trip-intel-row-icon">🎯</span>
                <span className="trip-intel-purpose">{intel.purpose}</span>
              </div>
            </div>
          )}

          {/* Base / accommodation */}
          {intel.base?.address && (
            <div className="trip-intel-section">
              <div className="trip-intel-row">
                <span className="trip-intel-row-icon">🏠</span>
                <span>
                  {intel.base.address}
                  {intel.base.host ? ` (${intel.base.host})` : ''}
                </span>
              </div>
              {intel.base.zone && (
                <div className="trip-intel-row trip-intel-sub">
                  <span className="trip-intel-row-icon">🗺️</span>
                  <span>{intel.base.zone}</span>
                </div>
              )}
            </div>
          )}

          {/* People */}
          {intel.people && intel.people.length > 0 && (
            <div className="trip-intel-section">
              <div className="trip-intel-label">👥 People</div>
              <div className="trip-intel-people">
                {intel.people.map((p, i) => (
                  <div key={i} className="trip-intel-person">
                    <span className="trip-intel-person-name">{p.name}</span>
                    {p.relation && <span className="trip-intel-person-rel">{p.relation}</span>}
                    {p.base && <span className="trip-intel-person-base">· {p.base}</span>}
                    {p.note && <div className="trip-intel-person-note">{p.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule */}
          {intel.schedule && intel.schedule.length > 0 && (
            <div className="trip-intel-section">
              <div className="trip-intel-label">📅 Schedule</div>
              <div className="trip-intel-schedule">
                {intel.schedule.map((day, i) => {
                  const highlight = day.highlight || isHighlight(day.notes);
                  return (
                    <div key={i} className={`trip-intel-day ${highlight ? 'trip-intel-day-highlight' : ''}`}>
                      <span className="trip-intel-day-date">{formatDate(day.date)}</span>
                      <span className="trip-intel-day-notes">{day.notes}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Anchor experiences */}
          {intel.anchor_experiences && intel.anchor_experiences.length > 0 && (
            <div className="trip-intel-section">
              <div className="trip-intel-label">⭐ Anchor Experiences</div>
              <div className="trip-intel-anchors">
                {intel.anchor_experiences.map((exp, i) => (
                  <div key={i} className="trip-intel-anchor-chip">
                    <span className="trip-intel-anchor-name">{exp.name}</span>
                    {exp.note && <span className="trip-intel-anchor-note">{exp.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Travel */}
          {(intel.travel?.outbound || intel.travel?.return) && (
            <div className="trip-intel-section">
              <div className="trip-intel-label">✈️ Flights</div>
              {intel.travel.outbound && (
                <div className="trip-intel-flight">
                  <span className="trip-intel-flight-dir">→</span>
                  <span>{intel.travel.outbound.from} → {intel.travel.outbound.to}</span>
                  <span className="trip-intel-flight-time">{intel.travel.outbound.departs} → {intel.travel.outbound.arrives}</span>
                  {intel.travel.outbound.flight && (
                    <span className="trip-intel-flight-num">{intel.travel.outbound.flight}</span>
                  )}
                </div>
              )}
              {intel.travel.return && (
                <div className="trip-intel-flight">
                  <span className="trip-intel-flight-dir">←</span>
                  <span>{intel.travel.return.from} → {intel.travel.return.to}</span>
                  <span className="trip-intel-flight-time">{intel.travel.return.departs} → {intel.travel.return.arrives}</span>
                  {intel.travel.return.flight && (
                    <span className="trip-intel-flight-num">{intel.travel.return.flight}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Priorities */}
          {intel.priorities && intel.priorities.length > 0 && (
            <div className="trip-intel-section">
              <div className="trip-intel-label">🎯 Priorities</div>
              <div className="trip-intel-priorities">
                {intel.priorities.map((p, i) => (
                  <span key={i} className="trip-intel-priority-chip">{p}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
