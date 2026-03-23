import type { DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';

interface TypeBadgeProps {
  type: DiscoveryType;
  size?: 'sm' | 'md';
}

export default function TypeBadge({ type, size = 'sm' }: TypeBadgeProps) {
  const meta = getTypeMeta(type);
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
