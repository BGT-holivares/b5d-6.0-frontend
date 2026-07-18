import { createRandomId } from '../random-id';
import { getSafeLocalStorage, getSafeSessionStorage } from '../browser-storage';

const DEBUG_STORAGE_KEY = 'b5d-debug-trace';
const DEBUG_TRACE_BUFFER_KEY = 'b5d-debug-trace-buffer';
const DEBUG_TAB_ID_KEY = 'b5d-debug-tab-id';
const DEBUG_TRACE_REPLAY_ENABLED_KEY = 'b5d-debug-trace-replay';
const DEBUG_TRACE_LIMIT = 500;
const DEBUG_TRACE_REPLAY_TAIL = 60;
const DEBUG_RUN_ID = createRandomId('run');
const DEBUG_PERSISTED_PREFIXES = [
  'browser:',
  'authGuard:',
  'guestGuard:',
  'login-screen:',
  'inicializarPanelesB5d:',
  'cargarProyectoReciente:',
  'cargarDatosProyectoB5d:',
  'restorePersistedIfcFileForProject:',
  'restoreViewerCanvas:',
  'cargarArchivo:',
  'quitarArchivoIfcCargado:',
  'local-viewer-sync: initialized',
  'local-viewer-sync: message received',
  'handleLocalViewerSyncMessage:',
  'processPendingLocalViewerSyncMessages:',
  'applyRemoteIfcSelection:',
  'applyRemoteIfcFile:',
  'applyRemoteIfcClear:',
  'ngOnInit:',
  'ngAfterViewInit:',
  'ngOnDestroy:',
  'restoreWindowMode:',
];

let cachedTabId: string | null = null;
let replayedCompatibilityTrace = false;
let lifecycleDiagnosticsInstalled = false;

export function isB5dDebugEnabled(): boolean {
  const storage = getSafeLocalStorage();
  if (!storage) return false;

  try {
    return storage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function getB5dDebugContext(): { tabId: string; runId: string } {
  return {
    tabId: getB5dDebugTabId(),
    runId: DEBUG_RUN_ID,
  };
}

export function logB5dDebug(message: string, data?: unknown): void {
  if (!isB5dDebugEnabled()) return;

  ensureCompatibilityTraceReplay();

  const context = getB5dDebugContext();
  const line = formatTraceLine(context, message, data);
  if (data === undefined) {
    console.log(line);
  } else {
    console.log(line, data);
  }
  appendTraceLine(message, line);
}

export function clearB5dDebugTraceBuffer(): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(DEBUG_TRACE_BUFFER_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function installB5dLifecycleDiagnostics(): void {
  if (!isB5dDebugEnabled() || lifecycleDiagnosticsInstalled) return;
  if (typeof window === 'undefined') return;

  lifecycleDiagnosticsInstalled = true;
  (window as Window & { __b5dDebug?: Record<string, unknown> }).__b5dDebug = {
    clearTraceBuffer: clearB5dDebugTraceBuffer,
    getContext: getB5dDebugContext,
  };
  logB5dDebug('browser: diagnostics installed', getB5dBrowserSnapshot());

  window.addEventListener('pageshow', (event: PageTransitionEvent) => {
    logB5dDebug('browser: pageshow', {
      ...getB5dBrowserSnapshot(),
      persisted: event.persisted,
    });
  });

  window.addEventListener('pagehide', (event: PageTransitionEvent) => {
    logB5dDebug('browser: pagehide', {
      ...getB5dBrowserSnapshot(),
      persisted: event.persisted,
    });
  });

  window.addEventListener('beforeunload', () => {
    logB5dDebug('browser: beforeunload', getB5dBrowserSnapshot());
  });

  window.addEventListener('popstate', (event: PopStateEvent) => {
    logB5dDebug('browser: popstate', {
      ...getB5dBrowserSnapshot(),
      state: event.state ?? null,
    });
  });

  document.addEventListener('visibilitychange', () => {
    logB5dDebug('browser: visibilitychange', {
      ...getB5dBrowserSnapshot(),
      visibilityState: document.visibilityState,
    });
  });
}

function ensureCompatibilityTraceReplay(): void {
  if (replayedCompatibilityTrace) return;
  replayedCompatibilityTrace = true;
  if (!isB5dDebugReplayEnabled()) return;

  const previousLines = readTraceBufferTail(DEBUG_TRACE_REPLAY_TAIL);
  if (!previousLines.length) return;

  const context = getB5dDebugContext();
  console.log(
    `[B5D][${context.tabId}][${context.runId}] trace replay from previous load (${previousLines.length} lines)`,
  );
  for (const line of previousLines) {
    console.log(`[B5D][trace-replay] ${line}`);
  }
}

function isB5dDebugReplayEnabled(): boolean {
  const storage = getSafeLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(DEBUG_TRACE_REPLAY_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function appendTraceLine(message: string, line: string): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  if (!shouldPersistTraceMessage(message)) return;

  try {
    const currentBuffer = readTraceBuffer();
    currentBuffer.push(line);
    while (currentBuffer.length > DEBUG_TRACE_LIMIT) {
      currentBuffer.shift();
    }
    storage.setItem(DEBUG_TRACE_BUFFER_KEY, JSON.stringify(currentBuffer));
  } catch {
    // Ignora errores de almacenamiento; el log de consola sigue funcionando.
  }
}

function shouldPersistTraceMessage(message: string): boolean {
  return DEBUG_PERSISTED_PREFIXES.some((prefix) => message.startsWith(prefix));
}

function readTraceBuffer(): string[] {
  const storage = getSafeLocalStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(DEBUG_TRACE_BUFFER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function readTraceBufferTail(limit: number): string[] {
  const buffer = readTraceBuffer();
  return limit > 0 ? buffer.slice(-limit) : buffer;
}

function getB5dDebugTabId(): string {
  if (cachedTabId) return cachedTabId;
  const storage = getSafeSessionStorage();
  if (!storage) {
    cachedTabId = createRandomId('tab');
    return cachedTabId;
  }

  try {
    const storedTabId = storage.getItem(DEBUG_TAB_ID_KEY);
    if (storedTabId) {
      cachedTabId = storedTabId;
      return storedTabId;
    }

    const newTabId = createRandomId('tab');
    storage.setItem(DEBUG_TAB_ID_KEY, newTabId);
    cachedTabId = newTabId;
    return newTabId;
  } catch {
    cachedTabId = createRandomId('tab');
    return cachedTabId;
  }
}

function formatTraceLine(context: { tabId: string; runId: string }, message: string, data?: unknown): string {
  if (data === undefined) {
    return `[B5D][${context.tabId}][${context.runId}] ${message}`;
  }
  return `[B5D][${context.tabId}][${context.runId}] ${message} ${formatDebugValue(data)}`;
}

function getB5dBrowserSnapshot(): {
  href: string;
  referrer: string;
  navigationType: string;
  documentReadyState: DocumentReadyState | 'unknown';
  visibilityState: DocumentVisibilityState | 'unknown';
  wasDiscarded: boolean;
  historyLength: number;
  historyState: unknown;
} {
  const navigationType = (() => {
    if (typeof performance === 'undefined') return 'unknown';
    try {
      const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return navigationEntry?.type ?? 'unknown';
    } catch {
      return 'unknown';
    }
  })();

  return {
    href: typeof window !== 'undefined' ? window.location.href : '',
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    navigationType,
    documentReadyState: typeof document !== 'undefined' ? document.readyState : 'unknown',
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
    wasDiscarded: typeof document !== 'undefined' && 'wasDiscarded' in document ? !!(document as Document & { wasDiscarded?: boolean }).wasDiscarded : false,
    historyLength: typeof window !== 'undefined' ? window.history.length : 0,
    historyState: typeof window !== 'undefined' ? window.history.state ?? null : null,
  };
}

function formatDebugValue(value: unknown, depth = 2, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';

  const valueType = typeof value;
  if (valueType === 'string') return JSON.stringify(value);
  if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') return String(value);
  if (valueType === 'undefined') return 'undefined';
  if (valueType === 'symbol') return String(value);
  if (valueType === 'function') {
    const functionValue = value as Function;
    return `[Function${functionValue.name ? ` ${functionValue.name}` : ''}]`;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return `{name: ${JSON.stringify(value.name)}, message: ${JSON.stringify(value.message)}}`;
  }

  if (typeof File !== 'undefined' && value instanceof File) {
    return `File{name: ${JSON.stringify(value.name)}, type: ${JSON.stringify(value.type)}, size: ${value.size}}`;
  }

  if (Array.isArray(value)) {
    if (depth <= 0) return `Array(${value.length})`;
    const items = value.slice(0, 5).map((item) => formatDebugValue(item, depth - 1, seen));
    const suffix = value.length > 5 ? `, …(+${value.length - 5})` : '';
    return `[${items.join(', ')}${suffix}]`;
  }

  if (valueType === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);

    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue);
    const entries = keys.slice(0, 8).map((key) => `${key}: ${formatDebugValue(objectValue[key], depth - 1, seen)}`);
    const suffix = keys.length > 8 ? ', …' : '';
    return `{${entries.join(', ')}${suffix}}`;
  }

  return String(value);
}
