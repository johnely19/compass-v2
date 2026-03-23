import { readFileSync, existsSync } from 'fs';
import path from 'path';
import Link from 'next/link';
import type { DiscoveryType } from '../_lib/types';
import TypeBadge from '../_components/TypeBadge';

export const dynamic = 'force-dynamic';

interface IndexEntry {
  name: string;
  type: DiscoveryType;
}

function loadIndex(): Record<string, IndexEntry> {
  const indexPath = path.join(process.cwd(), 'data', 'placecards', 'index.json');
  if (!existsSync(indexPath)) return {};
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, IndexEntry>;
  } catch {
    return {};
  }
}

export default function PlacecardsPage() {
  const index = loadIndex();
  const entries = Object.entries(index).sort(([, a], [, b]) =>
    a.name.localeCompare(b.name),
  );

  return (
    <main className="page">
      <div className="page-header">
        <h1>Places</h1>
        <p className="text-muted">{entries.length} place cards</p>
      </div>

      <div className="grid grid-auto">
        {entries.map(([placeId, entry]) => (
          <Link
            key={placeId}
            href={`/placecards/${placeId}`}
            className="card place-browse-card"
          >
            <div className="card-body">
              <h3 className="place-browse-name">{entry.name}</h3>
              <TypeBadge type={entry.type} />
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
