'use client';

/* ---- Worker Session Parser ---- */

function parseWorkerSession(key: string): { project: string; role: string; level: string; name: string } {
  // Format: "agent:main:subagent:compass-v2-developer-medior-brunhilda"
  const subagentPart = key.replace(/^agent:main:subagent:/, '');
  const parts = subagentPart.split('-');

  // Handle UUID-style keys (no structured name)
  if (parts.length < 4 || (parts[0]?.length ?? 0) === 12) {
    return { project: 'unknown', role: 'unknown', level: 'unknown', name: subagentPart.slice(0, 8) };
  }

  const name = parts[parts.length - 1] ?? '';
  const level = parts[parts.length - 2] ?? '';
  const role = parts[parts.length - 3] ?? '';
  const project = parts.slice(0, parts.length - 3).join('-');

  return { project, role, level, name };
}

/* ---- Role Emoji Mapping ---- */

const ROLE_EMOJI: Record<string, string> = {
  developer: '🔨',
  tester: '🧪',
  reviewer: '👁️',
  architect: '🏗️',
};

/* ---- Token Formatter ---- */

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

/* ---- WorkerCard Component ---- */

export default function WorkerCard({ worker }: { worker: {
  sessionKey: string;
  status: string;
  model: string;
  totalTokens: number;
  startedAt: number;
}}) {
  const { project, role, level, name } = parseWorkerSession(worker.sessionKey);
  const emoji = ROLE_EMOJI[role] || '🤖';

  // Status indicator
  const statusIcon = worker.status === 'running'
    ? '●'
    : worker.status === 'done'
      ? '✓'
      : '✗';
  const statusColor = worker.status === 'running'
    ? '#22c55e'
    : worker.status === 'done'
      ? '#94a3b8'
      : '#f44336';

  return (
    <div className="worker-card">
      <div className="worker-card-header">
        <span className="worker-emoji">{emoji}</span>
        <span className="worker-name">{name}</span>
        <span className="worker-status" style={{ color: statusColor }}>{statusIcon}</span>
      </div>
      <div className="worker-meta">
        {level} {role}
      </div>
      <div className="worker-project">{project}</div>
      <div className="worker-tokens">
        {formatTokens(worker.totalTokens)} tokens
      </div>
    </div>
  );
}
