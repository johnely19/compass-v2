'use client';

import { useRef, useEffect } from 'react';
import twemoji from '@twemoji/api';

interface TwemojiProps {
  emoji: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  sm: '1em',
  md: '1.2em',
  lg: '1.4em',
  xl: '1.6em',
};

export default function Twemoji({ emoji, size = 'md', className = '' }: TwemojiProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current) {
      twemoji.parse(ref.current, {
        folder: 'svg',
        ext: '.svg',
        className: 'twemoji-img',
      });
    }
  }, [emoji]);

  return (
    <span
      ref={ref}
      className={`twemoji ${className}`}
      style={{ '--twemoji-size': sizeMap[size] } as React.CSSProperties}
      aria-hidden="true"
    >
      {emoji}
    </span>
  );
}
