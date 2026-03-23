interface MenuItem {
  name: string;
  price?: string;
  highlight?: boolean;
}

interface MenuCategory {
  category: string;
  items: MenuItem[];
}

interface MenuWidgetProps {
  menu?: MenuCategory[];
}

export default function MenuWidget({ menu }: MenuWidgetProps) {
  if (!menu || menu.length === 0) return null;

  return (
    <div className="widget">
      <h3 className="widget-title">Menu</h3>
      <div className="menu-widget">
        {menu.map((category, i) => (
          <div key={i} className="menu-category">
            <h4 className="menu-category-title">{category.category}</h4>
            <ul className="menu-items">
              {category.items.map((item, j) => (
                <li key={j} className={`menu-item ${item.highlight ? 'menu-item-highlight' : ''}`}>
                  <span className="menu-item-name">
                    {item.highlight && <span className="menu-item-star">⭐</span>}
                    {item.name}
                  </span>
                  {item.price && <span className="menu-item-price">{item.price}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
