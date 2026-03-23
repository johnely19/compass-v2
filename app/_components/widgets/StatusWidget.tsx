interface StatusWidgetProps {
  status?: string;
}

export default function StatusWidget({ status }: StatusWidgetProps) {
  if (!status) return null;

  const statusLower = status.toLowerCase();
  let badgeClass = 'badge-muted';

  if (statusLower === 'open' || statusLower === 'opened') {
    badgeClass = 'badge-success';
  } else if (statusLower === 'limited' || statusLower === 'limited hours') {
    badgeClass = 'badge-warning';
  } else if (statusLower === 'closed' || statusLower === 'closing soon') {
    badgeClass = 'badge-danger';
  }

  return (
    <div className="widget">
      <h3 className="widget-title">Status</h3>
      <span className={`badge ${badgeClass}`}>{status}</span>
    </div>
  );
}
