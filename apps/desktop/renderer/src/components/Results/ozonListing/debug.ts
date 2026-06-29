const ENABLE_OZON_LISTING_DEBUG = true;

export function ozonListingLog(label: string, payload?: unknown): void {
  if (!ENABLE_OZON_LISTING_DEBUG) return;

  if (payload === undefined) {
    console.info(`[ozon-listing] ${label}`);
    return;
  }

  console.info(`[ozon-listing] ${label}`, payload);
}
