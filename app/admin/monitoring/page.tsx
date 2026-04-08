import { getCurrentUser } from '../../_lib/user';
import { loadMonitorInventory } from '../../_lib/monitor-inventory';
import type { MonitorEntry } from '../../_lib/monitor-inventory';
import MonitoringAdminClient from './MonitoringAdminClient';

export const dynamic = 'force-dynamic';

export default async function MonitoringAdminPage() {
  const user = await getCurrentUser();
  if (!user?.isOwner) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Monitoring Admin</h1>
          <p>Admin access required.</p>
        </div>
      </main>
    );
  }

  const inventory = await loadMonitorInventory(user.id);

  return (
    <MonitoringAdminClient
      entries={inventory.entries}
      updatedAt={inventory.updatedAt}
      userId={user.id}
    />
  );
}
