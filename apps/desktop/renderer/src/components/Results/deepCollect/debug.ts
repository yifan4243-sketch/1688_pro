const ENABLE_DEEP_COLLECT_DEBUG = true;

export function deepCollectLog(label: string, payload?: unknown): void {
  if (!ENABLE_DEEP_COLLECT_DEBUG) return;

  if (payload === undefined) {
    console.info(`[deep-collect] ${label}`);
    return;
  }

  console.info(`[deep-collect] ${label}`, payload);
}
