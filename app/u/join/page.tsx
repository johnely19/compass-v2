'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function JoinForm() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const prefill = searchParams.get('code');
    if (prefill) setCode(prefill);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) { setLoading(false); return; }

    try {
      const res = await fetch(`/u/${encodeURIComponent(trimmed)}`, { redirect: 'manual' });
      if (res.status === 404) {
        setError('Invalid invite code. Check your code and try again.');
        setLoading(false);
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      router.push('/');
      router.refresh();
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Your invite code"
        autoFocus
        style={{
          padding: '14px 18px',
          fontSize: '1.1rem',
          borderRadius: '12px',
          border: '1.5px solid rgba(148, 163, 184, 0.3)',
          background: 'rgba(255,255,255,0.05)',
          color: 'inherit',
          textAlign: 'center',
          letterSpacing: '0.08em',
        }}
      />
      {error && (
        <p style={{ color: '#f87171', fontSize: '0.85rem', margin: 0, textAlign: 'center' }}>{error}</p>
      )}
      <button
        type="submit"
        disabled={loading || !code.trim()}
        style={{
          padding: '14px',
          fontSize: '1rem',
          fontWeight: 700,
          borderRadius: '12px',
          border: 'none',
          background: loading ? 'rgba(59,130,246,0.5)' : 'linear-gradient(135deg, #3b82f6, #6366f1)',
          color: '#fff',
          cursor: loading ? 'default' : 'pointer',
        }}
      >
        {loading ? 'Opening Compass...' : 'Enter Compass ->'}
      </button>
    </form>
  );
}

export default function JoinPage() {
  return (
    <main style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
    }}>
      <div style={{ maxWidth: '380px', width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧭</div>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 0.4rem', letterSpacing: '-0.02em' }}>
          Compass
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1rem', marginBottom: '2.5rem', lineHeight: 1.5 }}>
          Your personal guide to the city.
        </p>
        <Suspense fallback={<div style={{ color: '#64748b' }}>Loading...</div>}>
          <JoinForm />
        </Suspense>
        <p style={{ marginTop: '1.5rem', color: '#475569', fontSize: '0.78rem', lineHeight: 1.6 }}>
          You need an invite code to join.
        </p>
      </div>
    </main>
  );
}