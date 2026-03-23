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

export default function HotPage() {
  const index = loadIndex();
  const entries = Object.entries(index);

  // For now, show a random selection as "hot" — will be powered by real
  // trending data from Disco's hourly-discoveries.jsonl and place-movers.json
  // once the agent wiring is complete
  const shuffled = [...entries].sort(() => Math.random() - 0.5).slice(0, 24);

  return (
    <main className="page">
      <div className="page-header">
        <h1>🔥 What&apos;s Hot</h1>
        <p className="text-muted">Trending and recently discovered places.</p>
      </div>

      <div className="grid grid-auto">
        {shuffled.map(([placeId, entry]) => (
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

      {entries.length === 0 && (
        <div className="empty-state">
          <p className="text-muted">No discoveries yet.</p>
        </div>
      )}
    </main>
  );
}
