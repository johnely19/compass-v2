'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import type { ParsedAccommodation } from '../api/trip/parse-accommodation/route';
import type { MonitoringTask } from '../_lib/types';
import { buildMonitoringTaskFromSummary, getRecentCompletedMonitoringTasks, resolveOpenMonitoringTask, shouldAutoCloseMonitoringTask } from '../_lib/trip-emergence';
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

interface MonitoringActionPrompt {
  label: string;
  detail: string;
  tone: 'critical' | 'notable';
  action?: 'review' | 'saved';
}

interface MonitoringActionSummary {
  label: string;
  action: 'review' | 'saved';
  tone: 'critical' | 'notable';
  count: number;
  detail: string;
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
  monitoringActionPrompts?: MonitoringActionPrompt[];
  monitoringActionSummary?: MonitoringActionSummary | null;
  monitoringTasks?: MonitoringTask[];
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
  userId,
  contextKey,
  travel,
  accommodation,
  bookingStatus,
  savedCount = 0,
  purpose,
  people,
  monitoringActionPrompts = [],
  monitoringActionSummary = null,
  monitoringTasks = [],
}: TripPlanningWidgetProps) {
  const [planning, setPlanning] = useState<TripPlanning>(defaultPlanning);
  const [mounted, setMounted] = useState(false);
  const [travelExpanded, setTravelExpanded] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  const [accomInputOpen, setAccomInputOpen] = useState(false);
  const [accomText, setAccomText] = useState('');
  const [accomParsing, setAccomParsing] = useState(false);
  const [parsedAccom, setParsedAccom] = useState<ParsedAccommodation | null>(null);
  const [taskSyncing, setTaskSyncing] = useState(false);
  const [persistedMonitoringTask, setPersistedMonitoringTask] = useState<MonitoringTask | null>(null);
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

  useEffect(() => {
    const openTask = monitoringTasks.find((task) => task.status === 'open') ?? null;
    setPersistedMonitoringTask(openTask);
  }, [monitoringTasks, contextKey]);

  useEffect(() => {
    const summary = monitoringActionSummary;
    const currentOpenTask = monitoringTasks.find((task) => task.status === 'open') ?? persistedMonitoringTask;

    if (currentOpenTask && shouldAutoCloseMonitoringTask(currentOpenTask, summary)) {
      const closedTask: MonitoringTask = {
        id: currentOpenTask.id,
        label: currentOpenTask.label,
        detail: currentOpenTask.detail,
        action: currentOpenTask.action,
        tone: currentOpenTask.tone,
        source: 'monitoring',
        status: 'done',
        createdAt: currentOpenTask.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      let cancelled = false;
      setTaskSyncing(true);
      void (async () => {
        try {
          await fetch('/api/user/monitoring-tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contextKey, task: closedTask }),
          });
        } catch {
          // keep optimistic close even if persistence fails
        } finally {
          if (!cancelled) {
            setPersistedMonitoringTask(null);
            setTaskSyncing(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    if (!summary) return;
    const nextTask = buildMonitoringTaskFromSummary(summary);
    const existing = monitoringTasks.find((task) => task.id === nextTask.id);
    if (existing) {
      setPersistedMonitoringTask(existing.status === 'open' ? existing : null);
      return;
    }

    let cancelled = false;
    setTaskSyncing(true);
    void (async () => {
      try {
        const res = await fetch('/api/user/monitoring-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contextKey, task: nextTask }),
        });
        if (!res.ok) throw new Error('task sync failed');
        const body = await res.json() as { task?: MonitoringTask };
        if (!cancelled && body.task) setPersistedMonitoringTask(body.task);
      } catch {
        if (!cancelled) {
          setPersistedMonitoringTask({
            ...nextTask,
            source: 'monitoring',
            createdAt: nextTask.createdAt ?? new Date().toISOString(),
            updatedAt: nextTask.updatedAt ?? new Date().toISOString(),
          });
        }
      } finally {
        if (!cancelled) setTaskSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contextKey, monitoringActionSummary, monitoringTasks, persistedMonitoringTask]);

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
  const visibleMonitoringTask = resolveOpenMonitoringTask(
    persistedMonitoringTask ? [persistedMonitoringTask] : monitoringTasks,
    monitoringActionSummary,
  );
  const completedMonitoringTasks = getRecentCompletedMonitoringTasks(monitoringTasks);
  const monitoringPromptHref = (action?: MonitoringActionPrompt['action']) => {
    if (action === 'saved') return `${reviewUrl}?tab=saved`;
    return reviewUrl;
  };
  const monitoringPromptCta = (action?: MonitoringActionPrompt['action']) => {
    if (action === 'saved') return 'Review saved';
    return 'Open review';
  };
  const completeMonitoringTask = async () => {
    if (!visibleMonitoringTask) return;
    const completedTask: MonitoringTask = {
      ...visibleMonitoringTask,
      source: 'monitoring',
      status: 'done',
      updatedAt: new Date().toISOString(),
      createdAt: visibleMonitoringTask.createdAt ?? new Date().toISOString(),
    };
    setPersistedMonitoringTask(null);
    try {
      await fetch('/api/user/monitoring-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextKey, task: completedTask }),
      });
    } catch {
      // keep optimistic completion even if persistence fails; next server refresh can recreate if still relevant
    }
  };

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
        {mounted && savedCount > 0 && (
          <a href={`${reviewUrl}?tab=saved`} className="tpw-saved">
            {savedCount} saved
          </a>
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

      {visibleMonitoringTask && (
        <div className={`tpw-monitoring-checklist tpw-monitoring-checklist-${visibleMonitoringTask.tone}`}>
          <div className="tpw-monitoring-checklist-header">
            <div className="tpw-monitoring-checklist-title">Action needed</div>
            <button type="button" className="tpw-monitoring-checklist-dismiss" onClick={completeMonitoringTask}>
              Done
            </button>
          </div>
          <div className="tpw-monitoring-checklist-row">
            <span className="tpw-monitoring-checklist-copy">
              <strong>{visibleMonitoringTask.label}</strong>
              <span>{visibleMonitoringTask.detail}</span>
            </span>
            <Link href={monitoringPromptHref(visibleMonitoringTask.action)} className="tpw-monitoring-checklist-link">
              {taskSyncing ? 'Saving…' : `${monitoringPromptCta(visibleMonitoringTask.action)} →`}
            </Link>
          </div>
        </div>
      )}

      {monitoringActionPrompts.length > 0 && (
        <div className="tpw-monitoring-prompts">
          <div className="tpw-monitoring-prompts-title">Suggested next move</div>
          <ul className="tpw-monitoring-prompts-list">
            {monitoringActionPrompts.map(prompt => (
              <li key={`${prompt.label}:${prompt.detail}`} className={`tpw-monitoring-prompt tpw-monitoring-prompt-${prompt.tone}`}>
                <span className="tpw-monitoring-prompt-copy">
                  <span className="tpw-monitoring-prompt-label">{prompt.label}</span>
                  <span className="tpw-monitoring-prompt-detail">{prompt.detail}</span>
                </span>
                <Link href={monitoringPromptHref(prompt.action)} className="tpw-monitoring-prompt-link">
                  {monitoringPromptCta(prompt.action)} →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {completedMonitoringTasks.length > 0 && (
        <div className="tpw-monitoring-history">
          <div className="tpw-monitoring-history-title">Recently handled</div>
          <ul className="tpw-monitoring-history-list">
            {completedMonitoringTasks.map(task => (
              <li key={task.id} className="tpw-monitoring-history-item">
                <span className="tpw-monitoring-history-copy">
                  <strong>{task.label}</strong>
                  <span>{task.detail}</span>
                </span>
                <Link href={monitoringPromptHref(task.action)} className="tpw-monitoring-history-link">
                  {monitoringPromptCta(task.action)} →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Row 3: Trip Notes — always-visible transparent input with thin border */}
      <TripIntelInput contextKey={contextKey} inlineMode purpose={purpose} people={people} />

    </div>
  );
}
