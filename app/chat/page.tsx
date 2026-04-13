import Link from 'next/link';
import { getCurrentUser } from '../_lib/user';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Chat</h1>
          <p>
            <Link href="/u/join" style={{ textDecoration: 'underline', color: 'inherit' }}>
              Sign in
            </Link>{' '}
            to chat with Compass.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>Chat</h1>
        <p>Ask Compass about places, planning, and trip context. Your chat is pinned below.</p>
      </div>
    </main>
  );
}
