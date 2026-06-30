export function createRandomId(prefix = 'b5d'): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === 'function') {
    return randomUuid.call(globalThis.crypto);
  }

  const randomPart = Math.random().toString(36).slice(2, 10);
  const timePart = Date.now().toString(36);
  return `${prefix}-${timePart}-${randomPart}`;
}
