import type { PlaceCardImage } from '../../_lib/types';

const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function resolveUrl(path: string): string {
  if (path.startsWith('http')) return path;
  if (path.startsWith('/') && BLOB_BASE) return `${BLOB_BASE}${path}`;
  return path;
}

interface PhotoGalleryProps {
  images: PlaceCardImage[];
}

export default function PhotoGallery({ images }: PhotoGalleryProps) {
  if (!images || images.length === 0) return null;

  return (
    <div className="widget">
      <h3 className="widget-title">Photos</h3>
      <div className="photo-gallery">
        {images.map((img, i) => (
          <div key={i} className="photo-gallery-item">
            <img src={resolveUrl(img.path)} alt={img.category} className="photo-gallery-img" />
            {img.category && (
              <span className="photo-gallery-label">{img.category}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
