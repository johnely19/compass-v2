import type { DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';

interface TypeIconProps {
  type: DiscoveryType;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = { sm: '0.9rem', md: '1.1rem', lg: '1.4rem' };

export default function TypeIcon({ type, size = 'md' }: TypeIconProps) {
  const meta = getTypeMeta(type);
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
