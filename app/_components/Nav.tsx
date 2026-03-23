'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavProps {
  userName?: string;
  isOwner?: boolean;
}

export default function Nav({ userName, isOwner }: NavProps) {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Home' },
    { href: '/placecards', label: 'Places' },
    { href: '/review', label: 'Review' },
    { href: '/hot', label: 'Hot' },
  ];

  return (
    <nav className="nav">
      <Link href="/" className="nav-brand">
        🧭 Compass
      </Link>

      <ul className="nav-links">
        {links.map(link => (
          <li key={link.href}>
            <Link
              href={link.href}
              className={pathname === link.href ? 'active' : ''}
            >
              {link.label}
            </Link>
          </li>
        ))}
        {isOwner && (
          <li>
            <Link
              href="/admin"
              className={pathname === '/admin' ? 'active' : ''}
            >
              Admin
            </Link>
          </li>
        )}
      </ul>

      {userName && (
        <div className="nav-user">
          <span className="nav-avatar">{userName[0]?.toUpperCase()}</span>
        </div>
      )}
    </nav>
  );
}
