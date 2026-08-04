export interface ParameterImportPreviewSourceRow {
  firma: string;
  clave: string;
  descripcion: string;
  tipo_parametro: string;
  unidad: string | null;
  size: number | string | null;
  minimo: number | string | null;
  maximo: number | string | null;
  promedio: number | string | null;
  sigma: number | string | null;
  cantidad_conceptos: number;
  cantidad_origenes: number;
  origenes: string[];
}

export interface ParameterImportPreviewChoice {
  value: string;
  count: number;
}

export interface ParameterImportPreviewRow {
  groupKey: string;
  firma: string;
  firmas: string[];
  clave: string;
  descripcion: string;
  descriptionOptions: ParameterImportPreviewChoice[];
  unidad: string;
  unitOptions: ParameterImportPreviewChoice[];
  tipo_parametro: string;
  minimo: number | null;
  maximo: number | null;
  promedio: number | null;
  sigma: number | null;
  size: number | null;
  cantidad_conceptos: number;
  cantidad_origenes: number;
  origenes: string[];
}

type PreviewAccumulator = {
  groupKey: string;
  order: number;
  rows: ParameterImportPreviewSourceRow[];
  firmas: string[];
  firmaSet: Set<string>;
  descriptionCounts: Map<string, number>;
  descriptionOrder: Map<string, number>;
  unitCounts: Map<string, number>;
  unitOrder: Map<string, number>;
  originOrder: Map<string, number>;
};

function normalizePreviewText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/_x000d_/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizePreviewNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const numericValue = Number(value.trim());
  return Number.isFinite(numericValue) ? numericValue : null;
}

function pickFirstNumericValue<T>(rows: ReadonlyArray<T>, selector: (row: T) => number | string | null | undefined): number | null {
  for (const row of rows) {
    const value = normalizePreviewNumber(selector(row));
    if (value != null) {
      return value;
    }
  }
  return null;
}

function getGroupKey(row: ParameterImportPreviewSourceRow, index: number): string {
  const clave = normalizePreviewText(row.clave);
  return clave || `__parameter-preview-row-${index}`;
}

function addChoice(
  counts: Map<string, number>,
  order: Map<string, number>,
  value: string,
  index: number,
): void {
  counts.set(value, (counts.get(value) ?? 0) + 1);
  if (!order.has(value)) {
    order.set(value, index);
  }
}

function buildChoices(
  counts: Map<string, number>,
  order: Map<string, number>,
): ParameterImportPreviewChoice[] {
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      count,
      order: order.get(value) ?? 0,
      blank: value.length === 0,
    }))
    .sort((left, right) => {
      if (left.blank !== right.blank) {
        return left.blank ? 1 : -1;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.order - right.order;
    })
    .map(({ value, count }) => ({ value, count }));
}

function pickChoiceValue(choices: ParameterImportPreviewChoice[]): string {
  return choices[0]?.value ?? '';
}

function calculatePopulationStandardDeviation(values: number[]): number | null {
  if (!values.length) {
    return null;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => {
    const delta = value - mean;
    return sum + delta * delta;
  }, 0) / values.length;

  return Math.sqrt(variance);
}

export function buildParameterImportPreviewRows(
  rows: ReadonlyArray<ParameterImportPreviewSourceRow>,
): ParameterImportPreviewRow[] {
  const groups = new Map<string, PreviewAccumulator>();

  rows.forEach((row, index) => {
    const groupKey = getGroupKey(row, index);
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        order: index,
        rows: [],
        firmas: [],
        firmaSet: new Set<string>(),
        descriptionCounts: new Map<string, number>(),
        descriptionOrder: new Map<string, number>(),
        unitCounts: new Map<string, number>(),
        unitOrder: new Map<string, number>(),
        originOrder: new Map<string, number>(),
      };
      groups.set(groupKey, group);
    }

    group.rows.push(row);

    const firma = normalizePreviewText(row.firma);
    if (firma && !group.firmaSet.has(firma)) {
      group.firmaSet.add(firma);
      group.firmas.push(firma);
    }

    addChoice(group.descriptionCounts, group.descriptionOrder, normalizePreviewText(row.descripcion), index);
    addChoice(group.unitCounts, group.unitOrder, normalizePreviewText(row.unidad), index);

    for (const origen of row.origenes ?? []) {
      const normalizedOrigen = normalizePreviewText(origen);
      if (!normalizedOrigen || group.originOrder.has(normalizedOrigen)) {
        continue;
      }
      group.originOrder.set(normalizedOrigen, index);
    }
  });

  return [...groups.values()]
    .sort((left, right) => left.order - right.order)
    .map((group) => {
      const descriptionOptions = buildChoices(group.descriptionCounts, group.descriptionOrder);
      const unitOptions = buildChoices(group.unitCounts, group.unitOrder);
      const origenes = [...group.originOrder.entries()]
        .sort((left, right) => left[1] - right[1])
        .map(([value]) => value);
      let promedioPonderado = 0;
      let promedioPeso = 0;
      for (const row of group.rows) {
        const weight = Number.isFinite(row.cantidad_conceptos) && row.cantidad_conceptos > 0 ? row.cantidad_conceptos : 1;
        const value = normalizePreviewNumber(row.promedio);
        if (value == null) {
          continue;
        }
        promedioPonderado += value * weight;
        promedioPeso += weight;
      }
      const minimos = group.rows
        .map((row) => normalizePreviewNumber(row.minimo))
        .filter((value): value is number => value != null);
      const maximos = group.rows
        .map((row) => normalizePreviewNumber(row.maximo))
        .filter((value): value is number => value != null);
      const sigmas = group.rows
        .map((row) => normalizePreviewNumber(row.sigma))
        .filter((value): value is number => value != null);
      const promediosParaSigma = group.rows
        .map((row) => normalizePreviewNumber(row.promedio))
        .filter((value): value is number => value != null);
      const tipoParametro = normalizePreviewText(group.rows[0]?.tipo_parametro);

      return {
        groupKey: group.groupKey,
        firma: group.firmas[0] ?? normalizePreviewText(group.rows[0]?.firma),
        firmas: group.firmas,
        clave: normalizePreviewText(group.rows[0]?.clave),
        descripcion: pickChoiceValue(descriptionOptions),
        descriptionOptions,
        unidad: pickChoiceValue(unitOptions),
        unitOptions,
        tipo_parametro: tipoParametro,
        size: pickFirstNumericValue(group.rows, (row) => row.size),
        minimo: minimos.length ? Math.min(...minimos) : null,
        maximo: maximos.length ? Math.max(...maximos) : null,
        promedio: promedioPeso > 0 ? promedioPonderado / promedioPeso : null,
        sigma: sigmas.length ? calculatePopulationStandardDeviation(sigmas) : calculatePopulationStandardDeviation(promediosParaSigma),
        cantidad_conceptos: group.rows.length,
        cantidad_origenes: origenes.length,
        origenes,
      };
    });
}
