'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Selection = 'trip' | 'date-night' | 'grocery' | 'experiences' | 'cottage';

const OPTIONS: Array<{ id: Selection; emoji: string; label: string; desc: string }> = [
  { id: 'trip', emoji: '✈️', label: 'An upcoming trip', desc: 'Weekend getaway, city break, international' },
  { id: 'date-night', emoji: '🍷', label: 'Date nights & dinners', desc: 'Restaurants for special occasions' },
  { id: 'grocery', emoji: '🥬', label: 'Great grocery & specialty shops', desc: 'Exceptional produce, butchers, markets' },
  { id: 'experiences', emoji: '🏙️', label: 'Local experiences & what\'s new', desc: 'Galleries, events, hidden gems in your city' },
  { id: 'cottage', emoji: '🏡', label: 'A cottage or vacation rental', desc: 'Finding the perfect summer retreat' },
];

interface OnboardingClientProps {
  userName: string;
  city: string;
}

export default function OnboardingClient({ userName, city: defaultCity }: OnboardingClientProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [cityInput, setCityInput] = useState(defaultCity || '');
  const [selected, setSelected] = useState<Set<Selection>>(new Set());
  const [tripDest, setTripDest] = useState('');
  const [tripDates, setTripDates] = useState('');
  const [dateNightWith, setDateNightWith] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const firstName = userName.split(' ')[0] || userName;
  const hasTripSelected = selected.has('trip');
  const hasDateNightSelected = selected.has('date-night');
  const needsExtraStep = hasTripSelected || hasDateNightSelected;
  const totalSteps = needsExtraStep ? 4 : 3;

  function toggleSelection(id: Selection) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFinish() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/user/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: cityInput,
          selections: selected.size > 0 ? [...selected] : ['experiences'],
          tripDestination: tripDest || undefined,
          tripDates: tripDates || undefined,
          dateNightWith: dateNightWith || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      router.push('/');
      router.refresh();
    } catch {
      setError('Something went wrong. Try again.');
      setSaving(false);
    }
  }

  function nextStep() {
    if (step === 2 && !needsExtraStep) {
      handleFinish();
    } else {
      setStep(s => s + 1);
    }
  }

  const canProceed = step === 0 ? true
    : step === 1 ? cityInput.trim().length > 0
    : step === 2 ? true
    : true;

  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        {/* Progress */}
        <div className="onboarding-progress">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className={`onboarding-dot ${i <= step ? 'onboarding-dot-active' : ''}`} />
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="onboarding-step">
            <div className="onboarding-emoji">🧭</div>
            <h1 className="onboarding-title">Welcome, {firstName}.</h1>
            <p className="onboarding-subtitle">
              Compass is your personal travel intelligence. Let&apos;s set up your radar so we know what to look for.
            </p>
            <p className="onboarding-hint">Takes about 60 seconds.</p>
          </div>
        )}

        {/* Step 1: City */}
        {step === 1 && (
          <div className="onboarding-step">
            <h2 className="onboarding-step-title">Where are you based?</h2>
            <p className="onboarding-step-desc">Your home city — where Compass starts scanning.</p>
            <input
              className="onboarding-input"
              type="text"
              placeholder="e.g. Toronto, New York, London..."
              value={cityInput}
              onChange={e => setCityInput(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {/* Step 2: What are you planning? */}
        {step === 2 && (
          <div className="onboarding-step">
            <h2 className="onboarding-step-title">What are you planning?</h2>
            <p className="onboarding-step-desc">Select everything that applies — you can always add more later.</p>
            <div className="onboarding-options">
              {OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  className={`onboarding-option ${selected.has(opt.id) ? 'onboarding-option-selected' : ''}`}
                  onClick={() => toggleSelection(opt.id)}
                >
                  <span className="onboarding-option-emoji">{opt.emoji}</span>
                  <div className="onboarding-option-text">
                    <span className="onboarding-option-label">{opt.label}</span>
                    <span className="onboarding-option-desc">{opt.desc}</span>
                  </div>
                  <span className="onboarding-option-check">{selected.has(opt.id) ? '✓' : ''}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Trip / Date Night details */}
        {step === 3 && (
          <div className="onboarding-step">
            <h2 className="onboarding-step-title">A little more detail</h2>
            {hasTripSelected && (
              <div className="onboarding-detail-group">
                <label className="onboarding-label">Where are you travelling?</label>
                <input
                  className="onboarding-input"
                  placeholder="e.g. New York, Paris, Tokyo..."
                  value={tripDest}
                  onChange={e => setTripDest(e.target.value)}
                />
                <label className="onboarding-label">When? (optional)</label>
                <input
                  className="onboarding-input"
                  placeholder="e.g. April 2026, this summer..."
                  value={tripDates}
                  onChange={e => setTripDates(e.target.value)}
                />
              </div>
            )}
            {hasDateNightSelected && (
              <div className="onboarding-detail-group">
                <label className="onboarding-label">Date nights with who? (optional)</label>
                <input
                  className="onboarding-input"
                  placeholder="e.g. Sarah, partner, friends..."
                  value={dateNightWith}
                  onChange={e => setDateNightWith(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="onboarding-actions">
          {step > 0 && (
            <button className="onboarding-back" onClick={() => setStep(s => s - 1)}>
              ← Back
            </button>
          )}

          {step < totalSteps - 1 ? (
            <button
              className={`onboarding-next ${canProceed ? '' : 'onboarding-next-disabled'}`}
              onClick={nextStep}
              disabled={!canProceed}
            >
              {step === 0 ? "Let's go →" : 'Next →'}
            </button>
          ) : (
            <button
              className="onboarding-finish"
              onClick={handleFinish}
              disabled={saving}
            >
              {saving ? 'Setting up…' : 'Open Compass →'}
            </button>
          )}
        </div>

        {step === 2 && (
          <button className="onboarding-skip" onClick={handleFinish}>
            Skip for now — I&apos;ll set it up later
          </button>
        )}

        {error && <p className="onboarding-error">{error}</p>}
      </div>
    </div>
  );
}
