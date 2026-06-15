import type { ConceptoB5DOrm, ParametroB5DOrm, WorkbookCellOrm } from '../../types/b5d-orm';

export type BoqExtractedRow = {
  row: number;
  clave: string;
  descripcion: string;
  cantidad: number | null;
  unidad: string;
};

export type ReportCategoryKey = 'in-range' | 'under-limit' | 'above-limit' | 'without-parameter';

export type ReportResultKind = 'ok' | 'warning' | 'error' | 'none';

export interface ReportSummarySlice {
  key: ReportCategoryKey;
  label: string;
  count: number;
  percent: number;
  color: string;
}

export interface ReportSummaryBlock {
  total: number;
  inRange: number;
  underLimit: number;
  aboveLimit: number;
  withoutParameter: number;
  slices: ReportSummarySlice[];
  background: string;
}

export interface QuantityReportRow extends BoqExtractedRow {
  parametro: string;
  parametroUnidad: string;
  evaluado: string;
  rango: string;
  diferencia: string;
  resultado: string;
  kind: ReportResultKind;
}

export interface CostReportRow extends BoqExtractedRow {
  parametro: string;
  parametroUnidad: string;
  conceptoCosto: string;
  costoUnitario: string;
  evaluado: string;
  rango: string;
  diferencia: string;
  resultado: string;
  kind: ReportResultKind;
}

export interface UnassignedReportRow extends BoqExtractedRow {
  motivo: string;
}

export interface ParametersReportData {
  quantitySummary: ReportSummaryBlock;
  costSummary: ReportSummaryBlock;
  quantityRows: QuantityReportRow[];
  costRows: CostReportRow[];
  unassignedRows: UnassignedReportRow[];
}

const SUMMARY_COLORS: Record<ReportCategoryKey, string> = {
  'in-range': '#2f855a',
  'under-limit': '#d69e2e',
  'above-limit': '#c53030',
  'without-parameter': '#718096',
};

export function extractBoqRows(cells: WorkbookCellOrm[]): BoqExtractedRow[] {
  const rowsByNumber = new Map<number, WorkbookCellOrm[]>();
  for (const cell of cells) {
    const rowCells = rowsByNumber.get(cell.row) ?? [];
    rowCells.push(cell);
    rowsByNumber.set(cell.row, rowCells);
  }

  const sortedRows = [...rowsByNumber.entries()].sort((first, second) => first[0] - second[0]);
  const headerMap = findHeaderMap(sortedRows);

  return sortedRows
    .map(([rowNumber, rowCells]) => extractBoqRowFromCells(rowNumber, rowCells, headerMap))
    .filter((row): row is BoqExtractedRow => !!row);
}

export function buildParametersReportData(
  boqRows: BoqExtractedRow[],
  parameters: ParametroB5DOrm[],
  concepts: ConceptoB5DOrm[],
  selectedCatalogId: number | null,
): ParametersReportData {
  const activeQuantityParameters = parameters.filter((row) => row.activo && row.tipo_parametro === 'cantidad');
  const activeCostParameters = parameters.filter((row) => row.activo && row.tipo_parametro === 'costo');
  const selectedCatalogConcepts = selectedCatalogId == null ? concepts : concepts.filter((row) => row.catalogo_id === selectedCatalogId);

  const quantityRows: QuantityReportRow[] = [];
  const costRows: CostReportRow[] = [];
  const unassignedRows: UnassignedReportRow[] = [];

  const quantityCounts: Record<ReportCategoryKey, number> = {
    'in-range': 0,
    'under-limit': 0,
    'above-limit': 0,
    'without-parameter': 0,
  };
  const costCounts: Record<ReportCategoryKey, number> = {
    'in-range': 0,
    'under-limit': 0,
    'above-limit': 0,
    'without-parameter': 0,
  };

  for (const boqRow of boqRows) {
    const quantityParameter = findMatchingParameter(boqRow, activeQuantityParameters);
    const quantityResult = buildQuantityResult(boqRow, quantityParameter);
    quantityCounts[quantityResult.bucket] += 1;
    if (quantityParameter) {
      quantityRows.push(quantityResult.row);
    }

    const costParameter = findMatchingParameter(boqRow, activeCostParameters);
    const costResult = buildCostResult(boqRow, costParameter, selectedCatalogConcepts);
    costCounts[costResult.bucket] += 1;
    if (costParameter) {
      costRows.push(costResult.row);
    }

    if (!quantityParameter && !costParameter) {
      unassignedRows.push({
        ...boqRow,
        motivo: 'Sin parametro de cantidad ni de costo',
      });
    }
  }

  return {
    quantitySummary: buildSummaryBlock(quantityCounts),
    costSummary: buildSummaryBlock(costCounts),
    quantityRows,
    costRows,
    unassignedRows,
  };
}

function buildQuantityResult(
  boqRow: BoqExtractedRow,
  matchedParameter: ParametroB5DOrm | null,
): { bucket: ReportCategoryKey; row: QuantityReportRow } {
  const fallbackRow = buildQuantityRow(
    boqRow,
    matchedParameter,
    '-',
    '-',
    '-',
    '-',
    'Sin parametro',
    'none',
    'without-parameter',
  );

  if (!matchedParameter) {
    return {
      bucket: 'without-parameter',
      row: fallbackRow,
    };
  }

  const rangeMin = matchedParameter.minimo;
  const rangeMax = matchedParameter.maximo;
  const rangeText = `${formatValue(rangeMin)} - ${formatValue(rangeMax)}`;

  if (boqRow.cantidad == null) {
    return {
      bucket: 'without-parameter',
      row: buildQuantityRow(
        boqRow,
        matchedParameter,
        '-',
        matchedParameter.unidad ?? '-',
        rangeText,
        '-',
        'Sin cantidad',
        'warning',
        'without-parameter',
      ),
    };
  }

  const convertedValue = convertQuantityToUnit(boqRow.cantidad, boqRow.unidad, matchedParameter.unidad ?? '');
  if (convertedValue == null) {
    return {
      bucket: 'without-parameter',
      row: buildQuantityRow(
        boqRow,
        matchedParameter,
        '-',
        matchedParameter.unidad ?? '-',
        rangeText,
        '-',
        'Unidad no compatible',
        'warning',
        'without-parameter',
      ),
    };
  }

  const delta = computeRangeDelta(convertedValue, rangeMin, rangeMax);
  const unitLabel = matchedParameter.unidad?.trim() || boqRow.unidad?.trim() || 'u';
  const evaluatedText = `${formatValue(convertedValue)} ${unitLabel}`;
  const deltaText = `${delta >= 0 ? '+' : ''}${formatValue(delta)} ${unitLabel}`;

  if (delta < 0) {
    return {
      bucket: 'under-limit',
      row: buildQuantityRow(
        boqRow,
        matchedParameter,
        evaluatedText,
        unitLabel,
        rangeText,
        deltaText,
        'Por debajo del limite',
        'warning',
        'under-limit',
      ),
    };
  }

  if (delta > 0) {
    return {
      bucket: 'above-limit',
      row: buildQuantityRow(
        boqRow,
        matchedParameter,
        evaluatedText,
        unitLabel,
        rangeText,
        deltaText,
        'Por encima del limite',
        'error',
        'above-limit',
      ),
    };
  }

  return {
    bucket: 'in-range',
    row: buildQuantityRow(
      boqRow,
      matchedParameter,
      evaluatedText,
      unitLabel,
      rangeText,
      '+0',
      'En rango',
      'ok',
      'in-range',
    ),
  };
}

function buildCostResult(
  boqRow: BoqExtractedRow,
  matchedParameter: ParametroB5DOrm | null,
  selectedCatalogConcepts: ConceptoB5DOrm[],
): { bucket: ReportCategoryKey; row: CostReportRow } {
  const fallbackRow = buildCostRow(
    boqRow,
    matchedParameter,
    '-',
    '-',
    '-',
    '-',
    'Sin parametro',
    'none',
    '-',
    'without-parameter',
  );

  if (!matchedParameter) {
    return {
      bucket: 'without-parameter',
      row: fallbackRow,
    };
  }

  const matchedConcept = resolveCostConceptForParameter(matchedParameter, boqRow, selectedCatalogConcepts);
  const rangeMin = matchedParameter.minimo;
  const rangeMax = matchedParameter.maximo;
  const rangeText = `${formatValue(rangeMin)} - ${formatValue(rangeMax)}`;

  if (!matchedConcept) {
    return {
      bucket: 'without-parameter',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        '-',
        matchedParameter.unidad ?? '-',
        '-',
        rangeText,
        'Sin costo en el catalogo seleccionado',
        'warning',
        '-',
        'without-parameter',
      ),
    };
  }

  if (boqRow.cantidad == null) {
    return {
      bucket: 'without-parameter',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedConcept.clave ?? '-',
        matchedParameter.unidad ?? '-',
        '-',
        rangeText,
        'Sin cantidad',
        'warning',
        '-',
        'without-parameter',
      ),
    };
  }

  const conceptQuantity = convertQuantityToUnit(boqRow.cantidad, boqRow.unidad, matchedConcept.unidad ?? '');
  if (conceptQuantity == null) {
    return {
      bucket: 'without-parameter',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedConcept.clave ?? '-',
        matchedParameter.unidad ?? '-',
        '-',
        rangeText,
        'Unidad no compatible',
        'warning',
        '-',
        'without-parameter',
      ),
    };
  }

  const unitCost = resolveConceptUnitCost(matchedConcept);
  if (unitCost == null) {
    return {
      bucket: 'without-parameter',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedConcept.clave ?? '-',
        matchedParameter.unidad ?? '-',
        '-',
        rangeText,
        'Sin costo en el catalogo seleccionado',
        'warning',
        '-',
        'without-parameter',
      ),
    };
  }

  const totalCost = conceptQuantity * unitCost;
  const delta = computeRangeDelta(totalCost, rangeMin, rangeMax);
  const unitLabel = matchedParameter.unidad?.trim() || 'u';
  const conceptUnitLabel = matchedConcept.unidad?.trim() || boqRow.unidad?.trim() || 'u';
  const evaluatedText = `${formatValue(conceptQuantity)} ${conceptUnitLabel} x ${formatValue(unitCost)} = ${formatValue(totalCost)} ${unitLabel}`;
  const deltaText = `${delta >= 0 ? '+' : ''}${formatValue(delta)} ${unitLabel}`;

  if (delta < 0) {
    return {
      bucket: 'under-limit',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedConcept.clave ?? '-',
        conceptUnitLabel,
        evaluatedText,
        rangeText,
        deltaText,
        'warning',
        formatValue(unitCost),
        'under-limit',
      ),
    };
  }

  if (delta > 0) {
    return {
      bucket: 'above-limit',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedConcept.clave ?? '-',
        conceptUnitLabel,
        evaluatedText,
        rangeText,
        deltaText,
        'error',
        formatValue(unitCost),
        'above-limit',
      ),
    };
  }

  return {
    bucket: 'in-range',
    row: buildCostRow(
      boqRow,
      matchedParameter,
      matchedConcept.clave ?? '-',
      conceptUnitLabel,
      evaluatedText,
      rangeText,
      '+0',
      'ok',
      formatValue(unitCost),
      'in-range',
    ),
  };
}

function buildQuantityRow(
  boqRow: BoqExtractedRow,
  matchedParameter: ParametroB5DOrm | null,
  evaluatedText: string,
  parametroUnidad: string,
  rangeText: string,
  diferencia: string,
  resultado: string,
  kind: ReportResultKind,
  bucket: ReportCategoryKey,
): QuantityReportRow {
  return {
    ...boqRow,
    parametro: matchedParameter?.clave ?? '-',
    parametroUnidad,
    evaluado: evaluatedText,
    rango: rangeText,
    diferencia,
    resultado,
    kind,
  };
}

function buildCostRow(
  boqRow: BoqExtractedRow,
  matchedParameter: ParametroB5DOrm | null,
  conceptoCosto: string,
  parametroUnidad: string,
  evaluado: string,
  rango: string,
  diferencia: string,
  resultadoKind: ReportResultKind,
  costoUnitario: string,
  bucket: ReportCategoryKey,
): CostReportRow {
  const resultado = resultadoKind === 'ok' ? 'En rango' : resultadoKind === 'error' ? 'Fuera de rango' : resultadoKind === 'warning' ? 'Sin costo en el catalogo seleccionado' : 'Sin parametro';
  return {
    ...boqRow,
    parametro: matchedParameter?.clave ?? '-',
    parametroUnidad,
    conceptoCosto,
    costoUnitario,
    evaluado,
    rango,
    diferencia,
    resultado,
    kind: resultadoKind,
  };
}

function buildSummaryBlock(counts: Record<ReportCategoryKey, number>): ReportSummaryBlock {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const slices: ReportSummarySlice[] = [
    {
      key: 'in-range',
      label: 'En rango',
      count: counts['in-range'],
      percent: getPercent(counts['in-range'], total),
      color: SUMMARY_COLORS['in-range'],
    },
    {
      key: 'under-limit',
      label: 'Bajo el limite',
      count: counts['under-limit'],
      percent: getPercent(counts['under-limit'], total),
      color: SUMMARY_COLORS['under-limit'],
    },
    {
      key: 'above-limit',
      label: 'Sobre el limite',
      count: counts['above-limit'],
      percent: getPercent(counts['above-limit'], total),
      color: SUMMARY_COLORS['above-limit'],
    },
    {
      key: 'without-parameter',
      label: 'Sin parametro',
      count: counts['without-parameter'],
      percent: getPercent(counts['without-parameter'], total),
      color: SUMMARY_COLORS['without-parameter'],
    },
  ];

  return {
    total,
    inRange: counts['in-range'],
    underLimit: counts['under-limit'],
    aboveLimit: counts['above-limit'],
    withoutParameter: counts['without-parameter'],
    slices,
    background: buildConicGradient(slices),
  };
}

function buildConicGradient(slices: ReportSummarySlice[]): string {
  if (!slices.length) {
    return `radial-gradient(circle at center, #fff 0 58%, transparent 58% 100%)`;
  }

  let currentPercent = 0;
  const segments: string[] = [];
  for (const slice of slices) {
    const start = currentPercent;
    const end = currentPercent + slice.percent;
    segments.push(`${slice.color} ${start}% ${end}%`);
    currentPercent = end;
  }

  return `conic-gradient(${segments.join(', ')})`;
}

function findMatchingParameter(boqRow: BoqExtractedRow, parameters: ParametroB5DOrm[]): ParametroB5DOrm | null {
  const boqCode = normalizeText(boqRow.clave);
  const boqDescription = normalizeText(boqRow.descripcion);

  const exactMatches: ParametroB5DOrm[] = [];
  const partialCodeMatches: ParametroB5DOrm[] = [];
  const partialDescriptionMatches: ParametroB5DOrm[] = [];

  for (const parameterRow of parameters) {
    const code = normalizeText(parameterRow.clave ?? '');
    const description = normalizeText(parameterRow.descripcion ?? '');
    if (parameterRow.tipo_comparacion === 'clave_exacta' && code && boqCode === code) {
      exactMatches.push(parameterRow);
      continue;
    }
    if (parameterRow.tipo_comparacion === 'clave_parcial' && code && boqCode.includes(code)) {
      partialCodeMatches.push(parameterRow);
      continue;
    }
    if (parameterRow.tipo_comparacion === 'descripcion_parcial' && description && boqDescription.includes(description)) {
      partialDescriptionMatches.push(parameterRow);
    }
  }

  if (exactMatches.length) return exactMatches[0];
  if (partialCodeMatches.length) return partialCodeMatches[0];
  if (partialDescriptionMatches.length) return partialDescriptionMatches[0];
  return null;
}

function resolveCostConceptForParameter(
  matchedParameter: ParametroB5DOrm,
  boqRow: BoqExtractedRow,
  concepts: ConceptoB5DOrm[],
): ConceptoB5DOrm | null {
  const matchedConcept = findMatchingConcept(boqRow, concepts);
  if (matchedConcept) return matchedConcept;

  const candidates = getCostCandidateConcepts(matchedParameter, concepts);
  const conceptWithCost = candidates.find((conceptRow) => resolveConceptUnitCost(conceptRow) != null);
  if (conceptWithCost) return conceptWithCost;

  return candidates[0] ?? null;
}

function getCostCandidateConcepts(parameterRow: ParametroB5DOrm, concepts: ConceptoB5DOrm[]): ConceptoB5DOrm[] {
  const boqCode = normalizeText(parameterRow.clave ?? '');
  const boqDescription = normalizeText(parameterRow.descripcion ?? '');
  const exactMatches: ConceptoB5DOrm[] = [];
  const partialCodeMatches: ConceptoB5DOrm[] = [];
  const partialDescriptionMatches: ConceptoB5DOrm[] = [];

  for (const conceptRow of concepts) {
    const code = normalizeText(conceptRow.clave ?? '');
    const description = normalizeText(conceptRow.descripcion ?? '');
    if (code && boqCode === code) {
      exactMatches.push(conceptRow);
      continue;
    }
    if (code && boqCode.includes(code)) {
      partialCodeMatches.push(conceptRow);
      continue;
    }
    if (description && boqDescription.includes(description)) {
      partialDescriptionMatches.push(conceptRow);
    }
  }

  return [...exactMatches, ...partialCodeMatches, ...partialDescriptionMatches].filter(
    (conceptRow, index, rows) => rows.findIndex((candidate) => candidate.id === conceptRow.id) === index,
  );
}

function findMatchingConcept(boqRow: BoqExtractedRow, concepts: ConceptoB5DOrm[]): ConceptoB5DOrm | null {
  const boqCode = normalizeText(boqRow.clave);
  const boqDescription = normalizeText(boqRow.descripcion);

  const exactMatches: ConceptoB5DOrm[] = [];
  const partialCodeMatches: ConceptoB5DOrm[] = [];
  const partialDescriptionMatches: ConceptoB5DOrm[] = [];

  for (const conceptRow of concepts) {
    const code = normalizeText(conceptRow.clave ?? '');
    const description = normalizeText(conceptRow.descripcion ?? '');
    if (code && boqCode === code) {
      exactMatches.push(conceptRow);
      continue;
    }
    if (code && boqCode.includes(code)) {
      partialCodeMatches.push(conceptRow);
      continue;
    }
    if (description && boqDescription.includes(description)) {
      partialDescriptionMatches.push(conceptRow);
    }
  }

  if (exactMatches.length) return exactMatches[0];
  if (partialCodeMatches.length) return partialCodeMatches[0];
  if (partialDescriptionMatches.length) return partialDescriptionMatches[0];
  return null;
}

function resolveConceptUnitCost(concept: ConceptoB5DOrm): number | null {
  const candidates = [concept.costo, concept.costo_mn, concept.costo_me];
  for (const candidate of candidates) {
    const numericCandidate = parseNumericLikeValue(candidate);
    if (numericCandidate == null) continue;
    return numericCandidate;
  }
  return null;
}

function extractBoqRowFromCells(
  rowNumber: number,
  rowCells: WorkbookCellOrm[],
  headerMap: { claveCol: number; descripcionCol: number; cantidadCol: number; unidadCol: number } | null,
): BoqExtractedRow | null {
  if (headerMap) {
    const clave = valueAtColumn(rowCells, headerMap.claveCol);
    const descripcion = valueAtColumn(rowCells, headerMap.descripcionCol);
    const cantidad = parseNumericCell(valueAtColumn(rowCells, headerMap.cantidadCol));
    const unidad = valueAtColumn(rowCells, headerMap.unidadCol);
    if (!clave && !descripcion && cantidad == null && !unidad) return null;
    return { row: rowNumber, clave, descripcion, cantidad, unidad };
  }

  const textCells = rowCells
    .map((cellData) => ({ col: cellData.col, value: stringValue(cellData.value) }))
    .filter((cellData) => !!cellData.value);
  if (textCells.length < 3) return null;

  const numberCell = rowCells
    .map((cellData) => ({ col: cellData.col, value: parseNumericCell(stringValue(cellData.value)) }))
    .find((cellData) => cellData.value != null);
  const clave = textCells[0]?.value ?? '';
  const descripcion = textCells[1]?.value ?? '';
  const unidad = textCells[textCells.length - 1]?.value ?? '';
  if (!clave && !descripcion) return null;

  return {
    row: rowNumber,
    clave,
    descripcion,
    cantidad: numberCell?.value ?? null,
    unidad,
  };
}

function findHeaderMap(
  rows: Array<[number, WorkbookCellOrm[]]>,
): { headerRow: number; claveCol: number; descripcionCol: number; cantidadCol: number; unidadCol: number } | null {
  for (const [rowNumber, rowCells] of rows) {
    const byText = new Map<string, number>();
    for (const cellData of rowCells) {
      const text = normalizeCellText(cellData);
      if (!text) continue;
      byText.set(text, cellData.col);
    }
    const claveCol = byText.get('clave');
    const descripcionCol = byText.get('descripcion');
    const cantidadCol = byText.get('cantidad');
    const unidadCol = byText.get('unidad');
    if (claveCol != null && descripcionCol != null && cantidadCol != null && unidadCol != null) {
      return { headerRow: rowNumber, claveCol, descripcionCol, cantidadCol, unidadCol };
    }
  }
  return null;
}

function normalizeCellText(cellData: WorkbookCellOrm): string {
  return normalizeText(stringValue(cellData.value));
}

function valueAtColumn(rowCells: WorkbookCellOrm[], col: number): string {
  const cellData = rowCells.find((cellItem) => cellItem.col === col);
  return stringValue(cellData?.value ?? null);
}

function parseNumericCell(value: string): number | null {
  if (!value) return null;
  const sanitized = value.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const numericValue = Number(sanitized);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function parseNumericLikeValue(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).trim();
  if (!normalized) return null;

  let sanitized = normalized.replace(/[^\d.,-]/g, '');
  if (sanitized.includes(',') && sanitized.includes('.')) {
    if (sanitized.lastIndexOf(',') > sanitized.lastIndexOf('.')) {
      sanitized = sanitized.replace(/\./g, '').replace(',', '.');
    } else {
      sanitized = sanitized.replace(/,/g, '');
    }
  } else if (sanitized.includes(',')) {
    sanitized = sanitized.replace(',', '.');
  }

  const numericValue = Number(sanitized);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function computeRangeDelta(value: number, minimum: number | null, maximum: number | null): number {
  if (minimum != null && value < minimum) return value - minimum;
  if (maximum != null && value > maximum) return value - maximum;
  return 0;
}

function convertQuantityToUnit(value: number, fromUnit: string, toUnit: string): number | null {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!to || !from || from === to) return value;
  const conversionMap: Record<string, Record<string, number>> = {
    kg: { ton: 0.001 },
    ton: { kg: 1000 },
    g: { kg: 0.001, ton: 0.000001 },
    kgf: { n: 9.80665 },
    n: { kgf: 0.101971621 },
  };
  const factor = conversionMap[from]?.[to];
  if (factor == null) return null;
  return value * factor;
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function stringValue(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function formatValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const roundedValue = Math.abs(value) < 0.0005 ? 0 : value;
  return roundedValue.toFixed(3).replace(/\.?0+$/, '');
}

function getPercent(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}
