'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ResetLocalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('Resetting...');

  useEffect(() => {
    // Clear localStorage
    localStorage.clear();

    // Get redirect target
    const redirectTo = searchParams.get('redirect') || '/';

    // Brief delay to show "Resetting..." message
    setStatus('Done. Redirecting...');
    router.push(redirectTo);
  }, [router, searchParams]);

  return (
    <main className="page">
      <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
        <p>{status}</p>
      </div>
    </main>
  );
}
