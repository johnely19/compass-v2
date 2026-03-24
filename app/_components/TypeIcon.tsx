import type { DiscoveryType } from '../_lib/types';
import { getTypeMeta, TYPE_META } from '../_lib/discovery-types';

interface TypeIconProps {
  type: DiscoveryType;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = { sm: '0.9rem', md: '1.1rem', lg: '1.4rem' };

const FALLBACK = { label: 'Place', icon: '📍', color: '#64748b' };

export default function TypeIcon({ type, size = 'md' }: TypeIconProps) {
  const meta = (type && type in TYPE_META) ? getTypeMeta(type) : FALLBACK;
  return (
    <span
      className="type-icon"
      role="img"
      aria-label={meta.label}
      style={{ fontSize: sizeMap[size] }}
    >
      {meta.icon}
    </span>
  );
}
