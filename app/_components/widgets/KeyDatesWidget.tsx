interface KeyDatesWidgetProps {
  dates?: { label: string; date: string }[];
}

export default function KeyDatesWidget({ dates }: KeyDatesWidgetProps) {
  if (!dates || dates.length === 0) return null;

  return (
    <div className="widget">
      <h3 className="widget-title">Key Dates</h3>
      <ul className="key-dates-list">
        {dates.map((item, i) => (
          <li key={i} className="key-date-item">
            <span className="key-date-label">{item.label}</span>
            <span className="key-date-value">{item.date}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
