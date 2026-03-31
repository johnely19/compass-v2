'use client';

/* ---- Worker Session Parser ---- */
function parseWorkerSession(key: string): { project: string; role: string; level: string; name: string } {
  const subagentPart = key.replace(/^agent:main:subagent:/, '');
  const parts = subagentPart.split('-');
  if (parts.length < 4) return { project: 'unknown', role: 'unknown', level: 'unknown', name: subagentPart.slice(0, 8) };
  const name = parts[parts.length - 1] ?? '';
  const level = parts[parts.length - 2] ?? '';
  const role = parts[parts.length - 3] ?? '';
  const project = parts.slice(0, parts.length - 3).join('-');
  return { project, role, level, name };
}

const ROLE_COLORS: Record<string, string> = {
  developer: '#f59e0b',
  tester:    '#22c55e',
  reviewer:  '#7c3aed',
  architect: '#3b82f6',
};

const ROLE_SHORT: Record<string, string> = {
  developer: 'dev',
  tester:    'tester',
  reviewer:  'reviewer',
  architect: 'architect',
};

const LEVEL_LABEL: Record<string, string> = {
  junior: 'Junior',
  medior: 'Medior',
  senior: 'Senior',
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(n);
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '<1m ago';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function WorkerCard({ worker }: {
  worker: {
    sessionKey: string;
    status: string;
    model: string;
    totalTokens: number;
    startedAt: number;
  }
}) {
  const { project, role, level, name } = parseWorkerSession(worker.sessionKey);
  const roleColor = ROLE_COLORS[role] || '#94a3b8';
  const isRunning = worker.status === 'running';
  const isDone = worker.status === 'done';

  const statusLabel = isRunning ? 'ACTIVE' : isDone ? 'DONE' : 'FAILED';
  const statusBg = isRunning ? 'rgba(34,197,94,0.15)' : isDone ? 'rgba(148,163,184,0.15)' : 'rgba(239,68,68,0.15)';
  const statusFg = isRunning ? '#22c55e' : isDone ? '#94a3b8' : '#ef4444';

  const shortModel = (worker.model || '').replace(/^(anthropic|openai|google)\//, '').replace('claude-', '');

  return (
    <div className="health-card" style={{ borderTop: `3px solid ${roleColor}`, fontSize: '0.82rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', textTransform: 'capitalize' }}>
            {name}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
            {LEVEL_LABEL[level] || level} {ROLE_SHORT[role] || role}
          </div>
        </div>
        <span style={{
          background: statusBg,
          color: statusFg,
          borderRadius: 4,
          padding: '1px 7px',
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.05em',
        }}>{statusLabel}</span>
      </div>

      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 6 }}>
        {shortModel} · {timeAgo(worker.startedAt)}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tokens</span>
        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: roleColor }}>{formatTokens(worker.totalTokens)}</span>
      </div>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 4, height: 4, marginTop: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${Math.min((worker.totalTokens / 200000) * 100, 100)}%`,
          background: roleColor,
          borderRadius: 4,
          transition: 'width 0.3s',
        }} />
      </div>
    </div>
  );
}
