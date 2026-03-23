interface HoursWidgetProps {
  hours?: Record<string, string>;
}

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function HoursWidget({ hours }: HoursWidgetProps) {
  if (!hours || Object.keys(hours).length === 0) return null;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const todayKey = DAY_ORDER.find(d => d === today) || today;

  return (
    <div className="widget">
      <h3 className="widget-title">Hours</h3>
      <table className="hours-table">
        <tbody>
          {DAY_ORDER.map(day => {
            const hoursText = hours[day];
            if (!hoursText) return null;
            const isToday = day === todayKey;

            return (
              <tr key={day} className={isToday ? 'hours-today' : ''}>
                <td className="hours-day">{day.charAt(0).toUpperCase() + day.slice(1)}</td>
                <td className="hours-time">{hoursText}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
