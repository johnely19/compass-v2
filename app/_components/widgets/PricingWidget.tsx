interface PricingWidgetProps {
  pricing?: { label: string; amount: string }[];
}

export default function PricingWidget({ pricing }: PricingWidgetProps) {
  if (!pricing || pricing.length === 0) return null;

  return (
    <div className="widget">
      <h3 className="widget-title">Pricing</h3>
      <ul className="pricing-list">
        {pricing.map((item, i) => (
          <li key={i} className="pricing-item">
            <span className="pricing-label">{item.label}</span>
            <span className="pricing-amount">{item.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
