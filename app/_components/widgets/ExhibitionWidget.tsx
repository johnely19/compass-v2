interface ExhibitionWidgetProps {
  exhibitions?: { title: string; dates?: string; current?: boolean }[];
}

export default function ExhibitionWidget({ exhibitions }: ExhibitionWidgetProps) {
  if (!exhibitions || exhibitions.length === 0) return null;

  return (
    <div className="widget">
      <h3 className="widget-title">Exhibitions</h3>
      <ul className="exhibition-list">
        {exhibitions.map((exhibition, i) => (
          <li key={i} className="exhibition-item">
            <div className="exhibition-header">
              <span className="exhibition-title">{exhibition.title}</span>
              {exhibition.current && (
                <span className="badge badge-success">Current</span>
              )}
            </div>
            {exhibition.dates && (
              <span className="exhibition-dates">{exhibition.dates}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
