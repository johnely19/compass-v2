/**
 * Overnight Genius page.
 * Shows the latest overnight report for the current user.
 */

import { getCurrentUser } from '../_lib/user';
import { getLatestOvernightReport } from '../_lib/overnight/generator';
import type { OvernightReport } from '../_lib/types';

export const dynamic = 'force-dynamic';

function ReportSection({ section }: { section: { title: string; content: string } }) {
  return (
    <div className="overnight-section">
      <h2 className="section-title">{section.title}</h2>
      <p className="section-content">{section.content}</p>
    </div>
  );
}

function ReportView({ report }: { report: OvernightReport }) {
  return (
    <div className="overnight-container">
      <h1 className="overnight-greeting">{report.greeting}</h1>

      <div className="overnight-sections">
        {report.sections.map((section, index) => (
          <ReportSection key={index} section={section} />
        ))}
      </div>
    </div>
  );
}

export default async function OvernightPage() {
  const user = await getCurrentUser();

  // If not logged in, show empty state
  if (!user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>🌙 Overnight Genius</h1>
        </div>
        <div className="empty-state">
          <p>Please sign in to view your overnight report.</p>
        </div>
      </main>
    );
  }

  // Fetch the latest report directly
  const report = await getLatestOvernightReport(user.id);

  if (!report) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>🌙 Overnight Genius</h1>
        </div>
        <div className="empty-state">
          <p>No overnight report yet.</p>
          <p className="text-muted">Come back tomorrow morning!</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <ReportView report={report} />
    </main>
  );
}