import type { DiscoveryType } from '../_lib/types';
import { getTypeMeta, TYPE_META } from '../_lib/discovery-types';

interface TypeBadgeProps {
  type: DiscoveryType;
  size?: 'sm' | 'md';
}

const FALLBACK = { label: 'Place', icon: '📍', color: '#64748b' };

export default function TypeBadge({ type, size = 'sm' }: TypeBadgeProps) {
  const meta = (type && type in TYPE_META) ? getTypeMeta(type) : FALLBACK;
  return (
    <span
      className={`type-badge type-badge-${size}`}
      style={{
        '--type-color': meta.color,
      } as React.CSSProperties}
    >
      <span className="type-badge-icon">{meta.icon}</span>
      <span className="type-badge-label">{meta.label}</span>
    </span>
  );
}
