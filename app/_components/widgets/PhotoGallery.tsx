import type { PlaceCardImage } from '../../_lib/types';
import { resolveImageUrlClient } from '../../_lib/image-url';

function resolveUrl(path: string): string {
  return resolveImageUrlClient(path) || path;
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
            <img src={resolveUrl(img.path)} alt={img.category} className="photo-gallery-img" width={240} height={180} loading="lazy" />
            {img.category && (
              <span className="photo-gallery-label">{img.category}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
