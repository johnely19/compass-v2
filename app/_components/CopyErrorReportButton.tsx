'use client';

import { useState } from 'react';

interface CopyErrorReportButtonProps {
  report: string;
}

export default function CopyErrorReportButton({ report }: CopyErrorReportButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers / non-https
      const el = document.createElement('textarea');
      el.value = report;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="btn btn-sm"
      style={{
        fontSize: '0.75rem',
        padding: '4px 10px',
        background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(244,67,54,0.1)',
        color: copied ? '#22c55e' : '#f44336',
        border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : 'rgba(244,67,54,0.3)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        whiteSpace: 'nowrap',
      }}
      title="Copy error report to clipboard"
    >
      {copied ? '✓ Copied!' : '📋 Copy error report'}
    </button>
  );
}
