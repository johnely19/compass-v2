'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function JoinPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;

    const res = await fetch(`/u/${encodeURIComponent(trimmed)}`, { redirect: 'manual' });
    if (res.status === 404) {
      setError('Invalid invite code. Check your code and try again.');
    } else {
      // Success — cookie is set, redirect to home
      router.push('/');
      router.refresh();
    }
  };

  return (
    <main className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ maxWidth: '360px', width: '100%', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Welcome to Compass</h1>
        <p style={{ opacity: 0.6, marginBottom: '2rem', fontSize: '0.9rem' }}>
          Enter your invite code to get started.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Invite code"
            autoFocus
            style={{
              padding: '12px 16px',
              fontSize: '1rem',
              borderRadius: '8px',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              background: 'rgba(0,0,0,0.2)',
              color: 'inherit',
              textAlign: 'center',
              letterSpacing: '0.05em',
            }}
          />
          {error && (
            <p style={{ color: '#f44336', fontSize: '0.85rem', margin: 0 }}>{error}</p>
          )}
          <button
            type="submit"
            style={{
              padding: '12px',
              fontSize: '1rem',
              fontWeight: 600,
              borderRadius: '8px',
              border: 'none',
              background: 'var(--accent, #3b82f6)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Sign In
          </button>
        </form>
      </div>
    </main>
  );
}
