'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavProps {
  userName?: string;
  isOwner?: boolean;
}

export default function Nav({ userName, isOwner }: NavProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

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
      </ul>

      {userName && (
        <div className="nav-user" ref={menuRef}>
          <button
            className="nav-avatar"
            onClick={() => setMenuOpen(prev => !prev)}
            aria-label="User menu"
            aria-expanded={menuOpen}
          >
            {userName[0]?.toUpperCase()}
          </button>

          {menuOpen && (
            <div className="nav-menu">
              <div className="nav-menu-header">
                <span className="nav-menu-name">{userName}</span>
              </div>
              <div className="nav-menu-divider" />
              <Link href="/" className="nav-menu-item" onClick={() => setMenuOpen(false)}>Home</Link>
              <Link href="/placecards" className="nav-menu-item" onClick={() => setMenuOpen(false)}>Places</Link>
              <Link href="/review" className="nav-menu-item" onClick={() => setMenuOpen(false)}>Review</Link>
              <Link href="/hot" className="nav-menu-item" onClick={() => setMenuOpen(false)}>What&apos;s Hot</Link>
              {isOwner && (
                <>
                  <div className="nav-menu-divider" />
                  <Link href="/admin" className="nav-menu-item" onClick={() => setMenuOpen(false)}>Admin</Link>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
