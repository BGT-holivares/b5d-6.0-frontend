export function buildScopedStorageKey(baseKey: string, storageScopeKey: string | number | null | undefined): string {
  const normalizedScopeKey =
    storageScopeKey == null ? 'anonymous' : String(storageScopeKey).trim() || 'anonymous';
  return `${baseKey}:${normalizedScopeKey}`;
}

export function readStoredJson<T>(storageKey: string): T | null {
  if (typeof window === 'undefined' || !storageKey) return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStoredJson(storageKey: string, value: unknown): void {
  if (typeof window === 'undefined' || !storageKey) return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage errors.
  }
}

