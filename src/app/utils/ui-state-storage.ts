import { getSafeLocalStorage } from './browser-storage';

export function buildScopedStorageKey(baseKey: string, storageScopeKey: string | number | null | undefined): string {
  const normalizedScopeKey =
    storageScopeKey == null ? 'anonymous' : String(storageScopeKey).trim() || 'anonymous';
  return `${baseKey}:${normalizedScopeKey}`;
}

export function readStoredJson<T>(storageKey: string): T | null {
  if (!storageKey) return null;

  try {
    const storage = getSafeLocalStorage();
    if (!storage) return null;
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStoredJson(storageKey: string, value: unknown): void {
  if (!storageKey) return;

  try {
    const storage = getSafeLocalStorage();
    if (!storage) return;
    storage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage errors.
  }
}
