export interface AppUrlOptions {
  appOrigin?: string;
  contextKey?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getDefaultAppOrigin(): string {
  const envAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envAppUrl) {
    return trimTrailingSlash(envAppUrl);
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    const withProtocol = vercelUrl.startsWith('http://') || vercelUrl.startsWith('https://')
      ? vercelUrl
      : `https://${vercelUrl}`;
    return trimTrailingSlash(withProtocol);
  }

  return 'https://compass-v2-lake.vercel.app';
}

export function resolveAppOrigin(appOrigin?: string): string {
  if (appOrigin?.trim()) {
    return trimTrailingSlash(appOrigin.trim());
  }
  return getDefaultAppOrigin();
}

export function buildPlaceCardPath(placeId: string, contextKey?: string): string {
  const basePath = `/placecards/${encodeURIComponent(placeId)}`;
  if (!contextKey) {
    return basePath;
  }

  const search = new URLSearchParams({ context: contextKey });
  return `${basePath}?${search.toString()}`;
}

export function buildPlaceCardUrl(placeId: string, options: AppUrlOptions = {}): string {
  return `${resolveAppOrigin(options.appOrigin)}${buildPlaceCardPath(placeId, options.contextKey)}`;
}

export function buildPlaceCardTemplate(appOrigin?: string): string {
  return `${resolveAppOrigin(appOrigin)}/placecards/PLACE_ID`;
}
