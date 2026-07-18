export type TableColumnKind = 'text' | 'number' | 'boolean' | 'select' | 'date';

export type TableFilterMode =
  | 'contains'
  | 'equals'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'isTrue'
  | 'isFalse'
  | 'isEmpty'
  | 'isNotEmpty';

export interface TableColumnDefinition<RowType> {
  key: string;
  label: string;
  labelKey?: string;
  kind: TableColumnKind;
  widthPx?: number;
  hiddenByDefault?: boolean;
  editable?: boolean;
  options?: Array<{ value: string; label: string }>;
  getValue: (row: RowType) => unknown;
  setValue?: (row: RowType, value: string) => void;
  formatValue?: (row: RowType) => string;
}

export interface TableColumnFilterState {
  mode: TableFilterMode;
  value: string;
}

export interface TableViewPreferences {
  order: string[];
  hidden: string[];
  filtersVisible: boolean;
  chooserOpen: boolean;
  filters: Record<string, TableColumnFilterState>;
}

export interface TableColumnOption {
  value: string;
  label: string;
}

const TEXT_FILTER_MODES: TableColumnOption[] = [
  { value: 'contains', label: 'Contiene' },
  { value: 'equals', label: 'Igual' },
  { value: 'startsWith', label: 'Empieza con' },
  { value: 'endsWith', label: 'Termina con' },
  { value: 'isEmpty', label: 'Vacio' },
  { value: 'isNotEmpty', label: 'Con valor' },
];

const NUMBER_FILTER_MODES: TableColumnOption[] = [
  { value: 'equals', label: 'Igual' },
  { value: 'greaterThan', label: 'Mayor que' },
  { value: 'greaterThanOrEqual', label: 'Mayor o igual' },
  { value: 'lessThan', label: 'Menor que' },
  { value: 'lessThanOrEqual', label: 'Menor o igual' },
  { value: 'isEmpty', label: 'Vacio' },
  { value: 'isNotEmpty', label: 'Con valor' },
];

const BOOLEAN_FILTER_MODES: TableColumnOption[] = [
  { value: 'equals', label: 'Igual' },
  { value: 'isTrue', label: 'Si' },
  { value: 'isFalse', label: 'No' },
];

const DEFAULT_TEXT_FILTER: TableFilterMode = 'contains';

export function createDefaultTableViewPreferences(columns: Array<{ key: string; hiddenByDefault?: boolean }>): TableViewPreferences {
  const order = columns.map((column) => column.key);
  const hidden = columns.filter((column) => !!column.hiddenByDefault).map((column) => column.key);
  const filters: Record<string, TableColumnFilterState> = {};
  for (const column of columns) {
    filters[column.key] = { mode: DEFAULT_TEXT_FILTER, value: '' };
  }
  return {
    order,
    hidden,
    filtersVisible: false,
    chooserOpen: false,
    filters,
  };
}

export function loadTableViewPreferences(
  storageKey: string,
  defaults: TableViewPreferences,
): TableViewPreferences {
  if (!storageKey) return cloneTableViewPreferences(defaults);
  try {
    const storage = getSafeLocalStorage();
    if (!storage) return cloneTableViewPreferences(defaults);
    const raw = storage.getItem(buildTableViewStorageKey(storageKey));
    if (!raw) return cloneTableViewPreferences(defaults);
    const parsed = JSON.parse(raw) as Partial<TableViewPreferences> | null;
    if (!parsed || typeof parsed !== 'object') return cloneTableViewPreferences(defaults);
    return mergeTableViewPreferences(defaults, parsed);
  } catch {
    return cloneTableViewPreferences(defaults);
  }
}

export function saveTableViewPreferences(storageKey: string, preferences: TableViewPreferences): void {
  if (!storageKey) return;
  try {
    const storage = getSafeLocalStorage();
    if (!storage) return;
    storage.setItem(buildTableViewStorageKey(storageKey), JSON.stringify(preferences));
  } catch {
    // Ignore persistence errors.
  }
}

export function cloneTableViewPreferences(preferences: TableViewPreferences): TableViewPreferences {
  return {
    order: [...preferences.order],
    hidden: [...preferences.hidden],
    filtersVisible: preferences.filtersVisible,
    chooserOpen: preferences.chooserOpen,
    filters: Object.fromEntries(
      Object.entries(preferences.filters).map(([key, filter]) => [key, { ...filter }]),
    ),
  };
}

export function mergeTableViewPreferences(
  defaults: TableViewPreferences,
  incoming: Partial<TableViewPreferences>,
): TableViewPreferences {
  const defaultKeys = defaults.order;
  const order = normalizeOrder(incoming.order, defaultKeys);
  const hidden = normalizeHidden(incoming.hidden, defaultKeys);
  const filters = { ...cloneTableViewPreferences(defaults).filters };

  for (const key of defaultKeys) {
    const incomingFilter = incoming.filters?.[key];
    if (incomingFilter) {
      filters[key] = normalizeFilter(incomingFilter, defaults.filters[key]);
    }
  }

  return {
    order,
    hidden,
    filtersVisible: typeof incoming.filtersVisible === 'boolean' ? incoming.filtersVisible : defaults.filtersVisible,
    chooserOpen: typeof incoming.chooserOpen === 'boolean' ? incoming.chooserOpen : defaults.chooserOpen,
    filters,
  };
}

export function getVisibleColumns<RowType>(
  columns: Array<TableColumnDefinition<RowType>>,
  preferences: TableViewPreferences,
): Array<TableColumnDefinition<RowType>> {
  const columnsByKey = new Map(columns.map((column) => [column.key, column] as const));
  const orderedKeys = preferences.order.filter((key) => columnsByKey.has(key));
  for (const column of columns) {
    if (!orderedKeys.includes(column.key)) {
      orderedKeys.push(column.key);
    }
  }

  return orderedKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is TableColumnDefinition<RowType> => !!column)
    .filter((column) => !preferences.hidden.includes(column.key));
}

export function applyTableFilters<RowType>(
  rows: RowType[],
  columns: Array<TableColumnDefinition<RowType>>,
  preferences: TableViewPreferences,
): RowType[] {
  const filtersByKey = preferences.filters;
  return rows.filter((row) => {
    for (const column of columns) {
      const filterState = filtersByKey[column.key];
      if (!filterState) continue;
      if (!matchesTableFilter(column.getValue(row), filterState, column.kind)) {
        return false;
      }
    }
    return true;
  });
}

export function getFilterModesForKind(kind: TableColumnKind): TableColumnOption[] {
  if (kind === 'number' || kind === 'date') return NUMBER_FILTER_MODES;
  if (kind === 'boolean') return BOOLEAN_FILTER_MODES;
  return TEXT_FILTER_MODES;
}

export function reorderTableColumn(preferences: TableViewPreferences, columnKey: string, direction: 'left' | 'right'): void {
  const currentIndex = preferences.order.indexOf(columnKey);
  if (currentIndex < 0) return;
  const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= preferences.order.length) return;
  const nextOrder = [...preferences.order];
  [nextOrder[currentIndex], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[currentIndex]];
  preferences.order = nextOrder;
}

export function moveTableColumn(preferences: TableViewPreferences, columnKey: string, targetIndex: number): void {
  const currentIndex = preferences.order.indexOf(columnKey);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex > preferences.order.length) return;
  const nextOrder = [...preferences.order];
  const [removed] = nextOrder.splice(currentIndex, 1);
  nextOrder.splice(Math.min(targetIndex, nextOrder.length), 0, removed);
  preferences.order = nextOrder;
}

export function toggleTableColumnVisibility(preferences: TableViewPreferences, columnKey: string): void {
  const hidden = new Set(preferences.hidden);
  if (hidden.has(columnKey)) {
    hidden.delete(columnKey);
  } else {
    hidden.add(columnKey);
  }
  preferences.hidden = [...hidden];
}

export function resetTableViewPreferences(
  preferences: TableViewPreferences,
  defaults: TableViewPreferences,
): void {
  preferences.order = [...defaults.order];
  preferences.hidden = [...defaults.hidden];
  preferences.filtersVisible = defaults.filtersVisible;
  preferences.chooserOpen = defaults.chooserOpen;
  preferences.filters = Object.fromEntries(
    Object.entries(defaults.filters).map(([key, filter]) => [key, { ...filter }]),
  );
}

export function setTableFilterMode(preferences: TableViewPreferences, columnKey: string, mode: TableFilterMode): void {
  const filter = preferences.filters[columnKey];
  if (!filter) return;
  filter.mode = mode;
}

export function setTableFilterValue(preferences: TableViewPreferences, columnKey: string, value: string): void {
  const filter = preferences.filters[columnKey];
  if (!filter) return;
  filter.value = value;
}

export function ensureTablePreferencesColumns(
  preferences: TableViewPreferences,
  columns: Array<{ key: string; hiddenByDefault?: boolean }>,
): void {
  const keys = columns.map((column) => column.key);
  preferences.order = keys.filter((key) => !preferences.order.includes(key)).concat(preferences.order.filter((key) => keys.includes(key)));
  preferences.hidden = preferences.hidden.filter((key) => keys.includes(key));
  for (const column of columns) {
    if (!preferences.filters[column.key]) {
      preferences.filters[column.key] = { mode: DEFAULT_TEXT_FILTER, value: '' };
    }
  }
}

function normalizeOrder(order: unknown, defaultKeys: string[]): string[] {
  if (!Array.isArray(order)) return [...defaultKeys];
  const normalized = order.filter((key): key is string => typeof key === 'string' && defaultKeys.includes(key));
  for (const key of defaultKeys) {
    if (!normalized.includes(key)) normalized.push(key);
  }
  return normalized;
}

function normalizeHidden(hidden: unknown, defaultKeys: string[]): string[] {
  if (!Array.isArray(hidden)) return [];
  return hidden.filter((key): key is string => typeof key === 'string' && defaultKeys.includes(key));
}

function normalizeFilter(
  incoming: Partial<TableColumnFilterState>,
  fallback: TableColumnFilterState,
): TableColumnFilterState {
  const mode = typeof incoming.mode === 'string' ? (incoming.mode as TableFilterMode) : fallback.mode;
  const value = typeof incoming.value === 'string' ? incoming.value : fallback.value;
  return {
    mode,
    value,
  };
}

function matchesTableFilter(value: unknown, filter: TableColumnFilterState, kind: TableColumnKind): boolean {
  const normalizedValue = value == null ? '' : String(value).trim();
  const normalizedFilterValue = filter.value.trim();

  if (!normalizedFilterValue) {
    if (filter.mode === 'isEmpty') return normalizedValue.length === 0;
    if (filter.mode === 'isNotEmpty') return normalizedValue.length > 0;
    return true;
  }

  if (kind === 'boolean') {
    const normalizedBoolean = ['1', 'true', 'si', 'yes', 'y'].includes(normalizedFilterValue.toLowerCase());
    if (filter.mode === 'isTrue') return normalizedBoolean ? normalizedValue.length > 0 : normalizedValue.length === 0;
    if (filter.mode === 'isFalse') return normalizedBoolean ? normalizedValue.length === 0 : normalizedValue.length > 0;
  }

  if (kind === 'number' || kind === 'date') {
    const numericValue = Number(normalizedValue.replace(',', '.'));
    const numericFilter = Number(normalizedFilterValue.replace(',', '.'));
    if (!Number.isFinite(numericValue) || !Number.isFinite(numericFilter)) {
      return normalizedValue.toLowerCase().includes(normalizedFilterValue.toLowerCase());
    }

    if (filter.mode === 'equals') return numericValue === numericFilter;
    if (filter.mode === 'greaterThan') return numericValue > numericFilter;
    if (filter.mode === 'greaterThanOrEqual') return numericValue >= numericFilter;
    if (filter.mode === 'lessThan') return numericValue < numericFilter;
    if (filter.mode === 'lessThanOrEqual') return numericValue <= numericFilter;
  }

  const normalizedLowerValue = normalizedValue.toLowerCase();
  const normalizedLowerFilter = normalizedFilterValue.toLowerCase();

  if (filter.mode === 'equals') return normalizedLowerValue === normalizedLowerFilter;
  if (filter.mode === 'startsWith') return normalizedLowerValue.startsWith(normalizedLowerFilter);
  if (filter.mode === 'endsWith') return normalizedLowerValue.endsWith(normalizedLowerFilter);
  if (filter.mode === 'isEmpty') return normalizedValue.length === 0;
  if (filter.mode === 'isNotEmpty') return normalizedValue.length > 0;
  return normalizedLowerValue.includes(normalizedLowerFilter);
}

function buildTableViewStorageKey(storageKey: string): string {
  return `b5d-table-view:${storageKey}`;
}
import { getSafeLocalStorage } from '../browser-storage';
