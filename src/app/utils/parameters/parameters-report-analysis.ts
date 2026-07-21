import type { ConceptoB5DOrm, ParametroB5DOrm, WorkbookCellOrm } from '../../types/b5d-orm';

export type ReportComparisonGranularity = 'individual' | 'wbs';
export type ReportParameterScope = 'all' | 'quantity' | 'cost' | 'cost-percent';

interface ReportComparisonOptions {
  comparisonGranularity?: ReportComparisonGranularity;
  wbsLevel?: number;
  parameterScope?: ReportParameterScope;
  decimalPlaces?: number;
  manualWbsConceptSelectionByParameterId?: Map<number, number>;
  manualParameterSelectionByConceptKey?: Map<string, number>;
}

interface CatalogWbsIndex {
  conceptById: Map<number, ConceptoB5DOrm>;
  depthById: Map<number, number>;
  pathSegmentsById: Map<number, string[]>;
  conceptsByDepth: Map<number, ConceptoB5DOrm[]>;
  maxDepth: number;
}

export type BoqExtractedRow = {
  row: number;
  clave: string;
  descripcion: string;
  cantidad: number | null;
  unidad: string;
  conceptId?: number | null;
  conceptKey?: string;
};

export type ReportCategoryKey = 'in-range' | 'under-limit' | 'above-limit' | 'without-parameter';

export type ReportResultKind = 'ok' | 'warning' | 'error' | 'none';

export interface BoqConceptAggregate {
  key: string;
  clave: string;
  descripcion: string;
  unidad: string;
  cantidad: number | null;
  rowCount: number;
  rowNumbers: number[];
}

export interface BoqComparisonRow {
  key: string;
  clave: string;
  unidad: string;
  descripcionBase: string;
  descripcionComparator: string;
  baseCantidad: string;
  comparatorCantidad: string;
  diferencia: string;
  resultado: string;
  kind: ReportResultKind;
  baseRowCount: number;
  comparatorRowCount: number;
}

export interface BoqComparisonSummary {
  total: number;
  equal: number;
  different: number;
  primaryOnly: number;
  comparatorOnly: number;
}

export interface BoqComparisonGroup {
  quantificationId: number;
  quantificationLabel: string;
  sheetName: string;
  summary: BoqComparisonSummary;
  rows: BoqComparisonRow[];
}

export interface BoqComparisonReportData {
  primaryQuantificationId: number | null;
  primaryLabel: string;
  primarySheetName: string;
  groups: BoqComparisonGroup[];
}

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
  parameterId: number | null;
  parametro: string;
  parametroUnidad: string;
  evaluado: string;
  rango: string;
  diferencia: string;
  resultado: string;
  kind: ReportResultKind;
}

export interface CostReportRow extends BoqExtractedRow {
  parameterId: number | null;
  parametro: string;
  parametroUnidad: string;
  conceptoCostoId: number | null;
  conceptoCosto: string;
  costoUnitario: string;
  evaluado: string;
  rango: string;
  diferencia: string;
  resultado: string;
  kind: ReportResultKind;
}

export interface UnassignedReportRow extends BoqExtractedRow {
  conceptKey: string;
  motivo: string;
}

export interface ParametersReportData {
  quantitySummary: ReportSummaryBlock;
  costSummary: ReportSummaryBlock;
  percentCostSummary: ReportSummaryBlock;
  quantityRows: QuantityReportRow[];
  costRows: CostReportRow[];
  percentCostRows: CostReportRow[];
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

export function buildBoqComparisonReportData(
  primaryRows: BoqExtractedRow[],
  primaryQuantificationId: number | null,
  primaryLabel: string,
  primarySheetName: string,
  comparatorInputs: Array<{
    quantificationId: number;
    quantificationLabel: string;
    sheetName: string;
    rows: BoqExtractedRow[];
  }>,
  options: ReportComparisonOptions = {},
): BoqComparisonReportData {
  const comparisonGranularity = options.comparisonGranularity ?? 'individual';
  const wbsLevel = normalizeWbsLevel(options.wbsLevel);
  const decimalPlaces = normalizeDecimalPlaces(options.decimalPlaces);
  const primaryAggregates = aggregateBoqRows(primaryRows, comparisonGranularity, wbsLevel);
  const groups = comparatorInputs.map((input) =>
    buildBoqComparisonGroup(
      primaryAggregates,
      input.quantificationId,
      input.quantificationLabel,
      input.sheetName,
      input.rows,
      comparisonGranularity,
      wbsLevel,
      decimalPlaces,
    ),
  );

  return {
    primaryQuantificationId,
    primaryLabel,
    primarySheetName,
    groups,
  };
}

export function buildParametersReportData(
  boqRows: BoqExtractedRow[],
  parameters: ParametroB5DOrm[],
  concepts: ConceptoB5DOrm[],
  selectedCatalogId: number | null,
  options: ReportComparisonOptions = {},
): ParametersReportData {
  const comparisonGranularity = options.comparisonGranularity ?? 'individual';
  const wbsLevel = normalizeWbsLevel(options.wbsLevel);
  const parameterScope = options.parameterScope ?? 'all';
  const decimalPlaces = normalizeDecimalPlaces(options.decimalPlaces);
  const manualWbsConceptSelectionByParameterId = options.manualWbsConceptSelectionByParameterId ?? new Map<number, number>();
  const manualParameterSelectionByConceptKey = options.manualParameterSelectionByConceptKey ?? new Map<string, number>();
  const includeQuantity = parameterScope === 'all' || parameterScope === 'quantity';
  const includeCost = parameterScope === 'all' || parameterScope === 'cost';
  const includePercentCost = parameterScope === 'all' || parameterScope === 'cost-percent';
  const activeQuantityParameters = includeQuantity ? parameters.filter((row) => row.activo && row.tipo_parametro === 'cantidad') : [];
  const activeCostParameters = includeCost ? parameters.filter((row) => row.activo && row.tipo_parametro === 'costo') : [];
  const activePercentCostParameters = includePercentCost ? parameters.filter((row) => row.activo && row.tipo_parametro === 'costo_porcentaje') : [];
  const selectedCatalogConcepts = selectedCatalogId == null ? concepts : concepts.filter((row) => row.catalogo_id === selectedCatalogId);
  const catalogWbsIndex = comparisonGranularity === 'wbs' ? buildCatalogWbsIndex(selectedCatalogConcepts) : null;
  const quantityRowsSource = includeQuantity ? prepareBoqRowsForComparison(boqRows, comparisonGranularity, wbsLevel) : [];
  const costRowsSource = includeCost ? prepareCatalogRowsForComparison(selectedCatalogConcepts, comparisonGranularity, wbsLevel, catalogWbsIndex) : [];
  const percentCostRowsSource = includePercentCost
    ? prepareCatalogRowsForComparison(selectedCatalogConcepts, comparisonGranularity, wbsLevel, catalogWbsIndex)
    : [];

  const quantityRows: QuantityReportRow[] = [];
  const costRows: CostReportRow[] = [];
  const percentCostRows: CostReportRow[] = [];
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
  const percentCostCounts: Record<ReportCategoryKey, number> = {
    'in-range': 0,
    'under-limit': 0,
    'above-limit': 0,
    'without-parameter': 0,
  };

  for (const quantityRow of quantityRowsSource) {
    const quantityParameter = findMatchingParameter(quantityRow, activeQuantityParameters);
    const quantityResult = buildQuantityResult(quantityRow, quantityParameter, decimalPlaces);
    quantityCounts[quantityResult.bucket] += 1;
    if (quantityParameter) {
      quantityRows.push(quantityResult.row);
    }
  }

  for (const costRow of costRowsSource) {
    const conceptKey = getReportConceptKey(costRow);
    const manualParameterId = manualParameterSelectionByConceptKey.get(conceptKey) ?? null;
    const manualParameter = manualParameterId != null ? activeCostParameters.find((row) => row.id === manualParameterId) ?? null : null;
    const autoParameter = findMatchingParameter(costRow, activeCostParameters);
    const costParameter = manualParameter ?? autoParameter;

    if (!costParameter) {
      unassignedRows.push({
        ...costRow,
        conceptKey,
        motivo: 'Sin parametro de costo',
      });
      continue;
    }
    const costResult = buildCostResult(
      costRow,
      costParameter,
      selectedCatalogConcepts,
      comparisonGranularity,
      wbsLevel,
      catalogWbsIndex,
      decimalPlaces,
      manualWbsConceptSelectionByParameterId.get(costParameter?.id ?? -1) ?? null,
    );
    costCounts[costResult.bucket] += 1;
    costRows.push(costResult.row);
  }

  for (const costRow of percentCostRowsSource) {
    const conceptKey = getReportConceptKey(costRow);
    const manualParameterId = manualParameterSelectionByConceptKey.get(conceptKey) ?? null;
    const manualParameter = manualParameterId != null ? activePercentCostParameters.find((row) => row.id === manualParameterId) ?? null : null;
    const autoParameter = findMatchingParameter(costRow, activePercentCostParameters);
    const costParameter = manualParameter ?? autoParameter;

    if (!costParameter) {
      unassignedRows.push({
        ...costRow,
        conceptKey,
        motivo: 'Sin parametro de costo porcentual',
      });
      continue;
    }

    const costResult = buildCostResult(
      costRow,
      costParameter,
      selectedCatalogConcepts,
      comparisonGranularity,
      wbsLevel,
      catalogWbsIndex,
      decimalPlaces,
      manualWbsConceptSelectionByParameterId.get(costParameter?.id ?? -1) ?? null,
    );
    percentCostCounts[costResult.bucket] += 1;
    percentCostRows.push(costResult.row);
  }

  return {
    quantitySummary: buildSummaryBlock(quantityCounts),
    costSummary: buildSummaryBlock(costCounts),
    percentCostSummary: buildSummaryBlock(percentCostCounts),
    quantityRows,
    costRows,
    percentCostRows,
    unassignedRows,
  };
}

function isValidConceptRow(row: BoqExtractedRow): boolean {
  const description = normalizeText(row.descripcion);
  const unit = normalizeText(row.unidad);
  const quantity = row.cantidad;

  if (!description || !unit || quantity == null || !Number.isFinite(quantity)) {
    return false;
  }

  if (isHeaderLikeText(description) || isHeaderLikeText(unit)) {
    return false;
  }

  if (!hasRealConceptText(description)) {
    return false;
  }

  return true;
}

function isWbsComparableRow(row: BoqExtractedRow): boolean {
  const description = normalizeText(row.descripcion);
  const clave = normalizeText(row.clave);

  if (!description || !clave) {
    return false;
  }

  if (isHeaderLikeText(description) || isHeaderLikeText(clave)) {
    return false;
  }

  return hasRealConceptText(description);
}

function aggregateBoqRows(
  rows: BoqExtractedRow[],
  comparisonGranularity: ReportComparisonGranularity,
  wbsLevel: number,
): Map<string, BoqConceptAggregate> {
  const aggregates = new Map<string, BoqConceptAggregate>();

  for (const row of rows) {
    const isComparable = comparisonGranularity === 'wbs' ? isWbsComparableRow(row) : isValidConceptRow(row);
    if (!isComparable) continue;
    if (comparisonGranularity === 'individual' && row.cantidad == null) continue;

    const key = buildComparisonKey(row.clave, row.unidad, comparisonGranularity, wbsLevel);
    if (!key) continue;

    const aggregate = aggregates.get(key);
    if (!aggregate) {
      aggregates.set(key, {
        key,
        clave: comparisonGranularity === 'wbs' ? buildWbsDisplayClave(row.clave, wbsLevel) : row.clave.trim(),
        descripcion: row.descripcion.trim(),
        unidad: row.unidad.trim() || '-',
        cantidad: row.cantidad,
        rowCount: 1,
        rowNumbers: [row.row],
      });
      continue;
    }

    aggregate.cantidad = row.cantidad == null ? aggregate.cantidad : (aggregate.cantidad ?? 0) + row.cantidad;
    aggregate.rowCount += 1;
    aggregate.rowNumbers.push(row.row);
    if (!aggregate.clave && row.clave.trim()) aggregate.clave = row.clave.trim();
    if (!aggregate.descripcion && row.descripcion.trim()) aggregate.descripcion = row.descripcion.trim();
    if ((!aggregate.unidad || aggregate.unidad === '-') && row.unidad.trim()) aggregate.unidad = row.unidad.trim();
  }

  return aggregates;
}

function buildBoqComparisonGroup(
  primaryAggregates: Map<string, BoqConceptAggregate>,
  quantificationId: number,
  quantificationLabel: string,
  sheetName: string,
  comparatorRows: BoqExtractedRow[],
  comparisonGranularity: ReportComparisonGranularity,
  wbsLevel: number,
  decimalPlaces: number,
): BoqComparisonGroup {
  const comparatorAggregates = aggregateBoqRows(comparatorRows, comparisonGranularity, wbsLevel);
  const keys = new Set<string>([...primaryAggregates.keys(), ...comparatorAggregates.keys()]);
  const rows: BoqComparisonRow[] = [];
  const summary: BoqComparisonSummary = {
    total: 0,
    equal: 0,
    different: 0,
    primaryOnly: 0,
    comparatorOnly: 0,
  };

  for (const key of [...keys].sort((first, second) => first.localeCompare(second, undefined, { sensitivity: 'base' }))) {
    const primaryAggregate = primaryAggregates.get(key) ?? null;
    const comparatorAggregate = comparatorAggregates.get(key) ?? null;
    const row = buildBoqComparisonRow(primaryAggregate, comparatorAggregate, decimalPlaces);
    rows.push(row);
    summary.total += 1;
    if (row.kind === 'ok') {
      summary.equal += 1;
    } else if (row.kind === 'warning') {
      summary.different += 1;
    } else if (row.resultado === 'Solo en BoQ base') {
      summary.primaryOnly += 1;
    } else if (row.resultado === 'Solo en comparador') {
      summary.comparatorOnly += 1;
    }
  }

  return {
    quantificationId,
    quantificationLabel,
    sheetName,
    summary,
    rows,
  };
}

function buildBoqComparisonRow(
  primaryAggregate: BoqConceptAggregate | null,
  comparatorAggregate: BoqConceptAggregate | null,
  decimalPlaces: number,
): BoqComparisonRow {
  const baseQuantity = primaryAggregate?.cantidad ?? null;
  const comparatorQuantity = comparatorAggregate?.cantidad ?? null;
  const unit = primaryAggregate?.unidad ?? comparatorAggregate?.unidad ?? '-';
  const clave = primaryAggregate?.clave ?? comparatorAggregate?.clave ?? '-';
  const descripcionBase = primaryAggregate?.descripcion ?? '-';
  const descripcionComparator = comparatorAggregate?.descripcion ?? '-';

  if (!primaryAggregate && comparatorAggregate) {
    return {
      key: comparatorAggregate.key,
      clave,
      unidad: unit,
      descripcionBase,
      descripcionComparator,
      baseCantidad: '-',
      comparatorCantidad: formatValue(comparatorQuantity, decimalPlaces),
      diferencia: '-',
      resultado: 'Solo en comparador',
      kind: 'error',
      baseRowCount: 0,
      comparatorRowCount: comparatorAggregate.rowCount,
    };
  }

  if (primaryAggregate && !comparatorAggregate) {
    return {
      key: primaryAggregate.key,
      clave,
      unidad: unit,
      descripcionBase,
      descripcionComparator,
      baseCantidad: formatValue(baseQuantity, decimalPlaces),
      comparatorCantidad: '-',
      diferencia: '-',
      resultado: 'Solo en BoQ base',
      kind: 'error',
      baseRowCount: primaryAggregate.rowCount,
      comparatorRowCount: 0,
    };
  }

  const difference = (comparatorQuantity ?? 0) - (baseQuantity ?? 0);
  const differenceText = `${difference >= 0 ? '+' : ''}${formatValue(difference, decimalPlaces)}`;

  if (Math.abs(difference) < 0.0005) {
    return {
      key: primaryAggregate?.key ?? comparatorAggregate?.key ?? `${clave}:${unit}`,
      clave,
      unidad: unit,
      descripcionBase,
      descripcionComparator,
      baseCantidad: formatValue(baseQuantity, decimalPlaces),
      comparatorCantidad: formatValue(comparatorQuantity, decimalPlaces),
      diferencia: `+${formatValue(0, decimalPlaces)}`,
      resultado: 'Sin cambios',
      kind: 'ok',
      baseRowCount: primaryAggregate?.rowCount ?? 0,
      comparatorRowCount: comparatorAggregate?.rowCount ?? 0,
    };
  }

  return {
    key: primaryAggregate?.key ?? comparatorAggregate?.key ?? `${clave}:${unit}`,
    clave,
    unidad: unit,
    descripcionBase,
    descripcionComparator,
    baseCantidad: formatValue(baseQuantity, decimalPlaces),
    comparatorCantidad: formatValue(comparatorQuantity, decimalPlaces),
    diferencia: differenceText,
    resultado: difference > 0 ? 'Aumenta en comparador' : 'Disminuye en comparador',
    kind: 'warning',
    baseRowCount: primaryAggregate?.rowCount ?? 0,
    comparatorRowCount: comparatorAggregate?.rowCount ?? 0,
  };
}

function buildComparisonKey(
  clave: string,
  unidad: string,
  comparisonGranularity: ReportComparisonGranularity = 'individual',
  wbsLevel = 1,
): string {
  const normalizedClave = comparisonGranularity === 'wbs' ? buildWbsComparisonClave(clave, wbsLevel) : normalizeText(clave);
  if (!normalizedClave) return '';
  if (comparisonGranularity === 'wbs') return normalizedClave;

  const normalizedUnidad = normalizeUnit(unidad);
  if (!normalizedUnidad) return '';
  return `${normalizedClave}::${normalizedUnidad}`;
}

function buildWbsDisplayClave(clave: string, wbsLevel = 1): string {
  const normalizedClave = buildWbsComparisonClave(clave, wbsLevel);
  return normalizedClave || normalizeText(clave);
}

function buildWbsComparisonClave(clave: string, wbsLevel = 1): string {
  return buildWbsWindowSignatures(clave, wbsLevel)[0] ?? '';
}

function splitWbsSegments(clave: string): string[] {
  const normalizedClave = normalizeText(clave);
  if (!normalizedClave) return [];

  return normalizedClave
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((segment) => segment.trim())
    .filter((segment) => !!segment);
}

export function buildWbsWindowSignatures(source: string | string[], wbsLevel = 1): string[] {
  const segments = Array.isArray(source) ? source : splitWbsSegments(source);
  if (!segments.length) return [];

  const selectedLevel = normalizeWbsLevel(wbsLevel);
  const effectiveLevel = Math.min(selectedLevel, segments.length);
  if (effectiveLevel < 1) return [];
  if (effectiveLevel === segments.length) {
    return [segments.join('.')];
  }

  const signatures: string[] = [];
  for (let start = 0; start <= segments.length - effectiveLevel; start += 1) {
    signatures.push(segments.slice(start, start + effectiveLevel).join('.'));
  }
  return signatures;
}

function prepareBoqRowsForComparison(
  rows: BoqExtractedRow[],
  comparisonGranularity: ReportComparisonGranularity,
  wbsLevel: number,
): BoqExtractedRow[] {
  const validRows = rows.filter((row) => (comparisonGranularity === 'wbs' ? isWbsComparableRow(row) : isValidConceptRow(row)));
  if (comparisonGranularity === 'individual') {
    return validRows;
  }

  const aggregates = new Map<string, BoqExtractedRow & { rowNumbers: number[] }>();
  for (const row of validRows) {
    const key = buildComparisonKey(row.clave, row.unidad, comparisonGranularity, wbsLevel);
    if (!key) continue;

    const aggregate = aggregates.get(key);
    if (!aggregate) {
      aggregates.set(key, {
        row: row.row,
        clave: buildWbsDisplayClave(row.clave, wbsLevel),
        descripcion: row.descripcion.trim(),
        cantidad: row.cantidad,
        unidad: row.unidad.trim() || '-',
        rowNumbers: [row.row],
      });
      continue;
    }

    aggregate.row = Math.min(aggregate.row, row.row);
    aggregate.cantidad = row.cantidad == null ? aggregate.cantidad : (aggregate.cantidad ?? 0) + row.cantidad;
    aggregate.rowNumbers.push(row.row);
    if (!aggregate.clave && row.clave.trim()) aggregate.clave = buildWbsDisplayClave(row.clave, wbsLevel);
    if (!aggregate.descripcion && row.descripcion.trim()) aggregate.descripcion = row.descripcion.trim();
    if ((!aggregate.unidad || aggregate.unidad === '-') && row.unidad.trim()) aggregate.unidad = row.unidad.trim();
  }

  return [...aggregates.values()].sort((first, second) => {
    if (first.row !== second.row) {
      return first.row - second.row;
    }
    return first.clave.localeCompare(second.clave, undefined, { sensitivity: 'base' });
  });
}

function prepareCatalogRowsForComparison(
  concepts: ConceptoB5DOrm[],
  comparisonGranularity: ReportComparisonGranularity,
  wbsLevel: number,
  catalogWbsIndex: CatalogWbsIndex | null,
): BoqExtractedRow[] {
  const validConcepts = concepts.filter((concept) => {
    const candidateRow = buildCatalogComparisonRow(concept, comparisonGranularity, wbsLevel, catalogWbsIndex);
    return isWbsComparableRow(candidateRow);
  });

  if (comparisonGranularity === 'individual') {
    return validConcepts
      .map((concept) => buildCatalogComparisonRow(concept, comparisonGranularity, wbsLevel, catalogWbsIndex))
      .sort((first, second) => {
        if (first.row !== second.row) {
          return first.row - second.row;
        }
        return first.clave.localeCompare(second.clave, undefined, { sensitivity: 'base' });
      });
  }

  const aggregates = new Map<string, BoqExtractedRow & { rowNumbers: number[] }>();
  for (const concept of validConcepts) {
    const row = buildCatalogComparisonRow(concept, comparisonGranularity, wbsLevel, catalogWbsIndex);
    const key = buildCatalogComparisonKey(row.clave, row.unidad, comparisonGranularity);
    if (!key) continue;

    const aggregate = aggregates.get(key);
    if (!aggregate) {
      aggregates.set(key, {
        ...row,
        conceptId: comparisonGranularity === 'wbs' ? null : row.conceptId ?? null,
        conceptKey:
          comparisonGranularity === 'wbs'
            ? getReportConceptKey({ ...row, conceptId: null })
            : row.conceptKey ?? getReportConceptKey(row),
        rowNumbers: [row.row],
      });
      continue;
    }

    aggregate.row = Math.min(aggregate.row, row.row);
    aggregate.cantidad = row.cantidad == null ? aggregate.cantidad : (aggregate.cantidad ?? 0) + row.cantidad;
    aggregate.rowNumbers.push(row.row);
    if (!aggregate.clave && row.clave.trim()) aggregate.clave = row.clave.trim();
    if (!aggregate.descripcion && row.descripcion.trim()) aggregate.descripcion = row.descripcion.trim();
    if ((!aggregate.unidad || aggregate.unidad === '-') && row.unidad.trim()) aggregate.unidad = row.unidad.trim();
  }

  return [...aggregates.values()].sort((first, second) => {
    if (first.row !== second.row) {
      return first.row - second.row;
    }
    return first.clave.localeCompare(second.clave, undefined, { sensitivity: 'base' });
  });
}

function buildCatalogComparisonRow(
  concept: ConceptoB5DOrm,
  comparisonGranularity: ReportComparisonGranularity,
  wbsLevel: number,
  catalogWbsIndex: CatalogWbsIndex | null,
): BoqExtractedRow {
  const pathSegments = catalogWbsIndex?.pathSegmentsById.get(concept.id) ?? [];
  const clave = comparisonGranularity === 'wbs'
    ? buildCatalogWbsDisplayClave(pathSegments, wbsLevel, concept)
    : (concept.clave?.trim() ?? '');
  const conceptKey = getReportConceptKey({
    row: concept.orden ?? concept.id,
    clave,
    descripcion: concept.descripcion?.trim() ?? '',
    cantidad: concept.cantidad ?? null,
    unidad: concept.unidad?.trim() || '-',
    conceptId: concept.id,
  });

  return {
    row: concept.orden ?? concept.id,
    clave,
    descripcion: concept.descripcion?.trim() ?? '',
    cantidad: concept.cantidad ?? null,
    unidad: concept.unidad?.trim() || '-',
    conceptId: concept.id,
    conceptKey,
  };
}

export function getReportConceptKey(row: BoqExtractedRow): string {
  if (row.conceptId != null) {
    return `concept:${row.conceptId}`;
  }

  const normalizedClave = normalizeText(row.clave);
  const normalizedDescripcion = normalizeText(row.descripcion);
  const normalizedUnidad = normalizeText(row.unidad);
  return `row:${normalizedClave}::${normalizedDescripcion}::${normalizedUnidad}`;
}

function buildCatalogComparisonKey(
  clave: string,
  unidad: string,
  comparisonGranularity: ReportComparisonGranularity,
): string {
  const normalizedClave = normalizeText(clave);
  if (!normalizedClave) return '';
  if (comparisonGranularity === 'wbs') return normalizedClave;

  const normalizedUnidad = normalizeUnit(unidad);
  if (!normalizedUnidad) return '';
  return `${normalizedClave}::${normalizedUnidad}`;
}

function buildCatalogWbsDisplayClave(pathSegments: string[], wbsLevel: number, concept: ConceptoB5DOrm): string {
  if (!pathSegments.length) {
    return (concept.clave ?? concept.clave_secundaria ?? '').trim();
  }

  const selectedLevel = normalizeWbsLevel(wbsLevel);
  const selectedIndex = Math.min(Math.max(selectedLevel - 1, 0), pathSegments.length - 1);
  return pathSegments[selectedIndex]?.trim() || (concept.clave ?? concept.clave_secundaria ?? '').trim();
}

function isHeaderLikeText(value: string): boolean {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return true;

  const headerKeywords = new Set([
    'agrupador padre',
    'agrupador',
    'concepto',
    'descripcion',
    'descripcion del concepto',
    'descripción',
    'descripcion concepto',
    'clave',
    'cantidad',
    'unidad',
    'proyecto',
    'elaboro',
    'reviso',
    'autorizo',
    'fecha',
    'cliente',
    'recibira',
    'motivo',
    'parameter',
    'parametro',
    'parámetro',
  ]);

  return headerKeywords.has(normalizedValue);
}

function hasRealConceptText(description: string): boolean {
  const normalizedDescription = normalizeText(description);
  if (!normalizedDescription) return false;
  if (normalizedDescription.length < 2) return false;

  const filteredWords = normalizedDescription
    .split(' ')
    .filter((word) => !['agrupador', 'padre', 'header', 'concept', 'concepto'].includes(word));

  return filteredWords.length > 0;
}

function buildQuantityResult(
  boqRow: BoqExtractedRow,
  matchedParameter: ParametroB5DOrm | null,
  decimalPlaces: number,
): { bucket: ReportCategoryKey; row: QuantityReportRow } {
  const fallbackRow = buildQuantityRow(
    boqRow,
    matchedParameter,
    matchedParameter?.id ?? null,
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
  const rangeText = `${formatValue(rangeMin, decimalPlaces)} - ${formatValue(rangeMax, decimalPlaces)}`;

  if (boqRow.cantidad == null) {
    return {
      bucket: 'without-parameter',
      row: buildQuantityRow(
        boqRow,
        matchedParameter,
        matchedParameter.id,
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
        matchedParameter.id,
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
  const evaluatedText = `${formatValue(convertedValue, decimalPlaces)} ${unitLabel}`;
  const deltaText = `${delta >= 0 ? '+' : ''}${formatValue(delta, decimalPlaces)} ${unitLabel}`;

  if (delta < 0) {
    return {
      bucket: 'under-limit',
      row: buildQuantityRow(
        boqRow,
        matchedParameter,
        matchedParameter.id,
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
        matchedParameter.id,
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
      matchedParameter.id,
      evaluatedText,
      unitLabel,
      rangeText,
      `+${formatValue(0, decimalPlaces)}`,
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
  comparisonGranularity: ReportComparisonGranularity,
  wbsLevel: number,
  catalogWbsIndex: CatalogWbsIndex | null,
  decimalPlaces: number,
  manualConceptId: number | null,
): { bucket: ReportCategoryKey; row: CostReportRow } {
  const fallbackRow = buildCostRow(
    boqRow,
    matchedParameter,
    matchedParameter?.id ?? null,
    null,
    '-',
    null,
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

  const matchedConcept = resolveCostConceptForParameter(
    matchedParameter,
    boqRow,
    selectedCatalogConcepts,
    comparisonGranularity,
    wbsLevel,
    catalogWbsIndex,
    manualConceptId,
  );
  const rangeMin = matchedParameter.minimo;
  const rangeMax = matchedParameter.maximo;
  const rangeText = `${formatValue(rangeMin, decimalPlaces)} - ${formatValue(rangeMax, decimalPlaces)}`;

  if (!matchedConcept) {
    return {
      bucket: 'without-parameter',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedParameter.id,
        null,
        '-',
        matchedParameter.unidad ?? '-',
        '-',
        rangeText,
        '-',
        'Sin costo en el catalogo seleccionado',
        'warning',
        '-',
        'without-parameter',
      ),
    };
  }

  if (matchedParameter.tipo_parametro === 'costo_porcentaje') {
    const conceptPercentage = resolveConceptPercentage(matchedConcept);
    if (conceptPercentage == null) {
      return {
        bucket: 'without-parameter',
        row: buildCostRow(
          boqRow,
          matchedParameter,
          matchedParameter.id,
          matchedConcept.id,
          matchedConcept.clave ?? '-',
          matchedParameter.unidad ?? '%',
          '-',
          rangeText,
          '-',
          'Sin porcentaje en el catalogo seleccionado',
          'warning',
          '-',
          'without-parameter',
        ),
      };
    }

    const delta = computeRangeDelta(conceptPercentage, rangeMin, rangeMax);
    const unitLabel = matchedParameter.unidad?.trim() || '%';
    const evaluatedText = `${formatValue(conceptPercentage, decimalPlaces)} ${unitLabel}`;
    const deltaText = `${delta >= 0 ? '+' : ''}${formatValue(delta, decimalPlaces)} ${unitLabel}`;

    if (delta < 0) {
      return {
        bucket: 'under-limit',
        row: buildCostRow(
          boqRow,
          matchedParameter,
          matchedParameter.id,
          matchedConcept.id,
          matchedConcept.clave ?? '-',
          unitLabel,
          evaluatedText,
          rangeText,
          deltaText,
          'Por debajo del limite',
          'warning',
          `${formatValue(conceptPercentage, decimalPlaces)} ${unitLabel}`,
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
          matchedParameter.id,
          matchedConcept.id,
          matchedConcept.clave ?? '-',
          unitLabel,
          evaluatedText,
          rangeText,
          deltaText,
          'Por encima del limite',
          'error',
          `${formatValue(conceptPercentage, decimalPlaces)} ${unitLabel}`,
          'above-limit',
        ),
      };
    }

    return {
      bucket: 'in-range',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedParameter.id,
        matchedConcept.id,
        matchedConcept.clave ?? '-',
        unitLabel,
        evaluatedText,
        rangeText,
        `+${formatValue(0, decimalPlaces)}`,
        'En rango',
        'ok',
        `${formatValue(conceptPercentage, decimalPlaces)} ${unitLabel}`,
        'in-range',
      ),
    };
  }

  const conceptCost = resolveConceptUnitCost(matchedConcept);
  if (conceptCost == null) {
    return {
      bucket: 'without-parameter',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedParameter.id,
        matchedConcept.id,
        matchedConcept.clave ?? '-',
        matchedParameter.unidad ?? '-',
        '-',
        rangeText,
        '-',
        'Sin costo en el catalogo seleccionado',
        'warning',
        '-',
        'without-parameter',
      ),
    };
  }

  const delta = computeRangeDelta(conceptCost, rangeMin, rangeMax);
  const unitLabel = matchedParameter.unidad?.trim() || 'u';
  const evaluatedText = `${formatValue(conceptCost, decimalPlaces)} ${unitLabel}`;
  const deltaText = `${delta >= 0 ? '+' : ''}${formatValue(delta, decimalPlaces)} ${unitLabel}`;

  if (delta < 0) {
    return {
      bucket: 'under-limit',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedParameter.id,
        matchedConcept.id,
        matchedConcept.clave ?? '-',
        unitLabel,
        evaluatedText,
        rangeText,
        deltaText,
        'Por debajo del limite',
        'warning',
        formatValue(conceptCost, decimalPlaces),
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
        matchedParameter.id,
        matchedConcept.id,
        matchedConcept.clave ?? '-',
        unitLabel,
        evaluatedText,
        rangeText,
        deltaText,
        'Por encima del limite',
        'error',
        formatValue(conceptCost, decimalPlaces),
        'above-limit',
      ),
    };
  }

  return {
    bucket: 'in-range',
      row: buildCostRow(
        boqRow,
        matchedParameter,
        matchedParameter.id,
        matchedConcept.id,
        matchedConcept.clave ?? '-',
        unitLabel,
        evaluatedText,
        rangeText,
        `+${formatValue(0, decimalPlaces)}`,
        'En rango',
        'ok',
        formatValue(conceptCost, decimalPlaces),
        'in-range',
      ),
    };
  }

function buildQuantityRow(
  boqRow: BoqExtractedRow,
  matchedParameter: ParametroB5DOrm | null,
  parameterId: number | null,
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
    parameterId,
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
  ...args: Array<string | number | null>
): CostReportRow {
  let parameterId = matchedParameter?.id ?? null;
  let conceptoCostoId: number | null = null;
  let values = args;

  if (values.length > 0 && (typeof values[0] === 'number' || values[0] === null)) {
    parameterId = values[0] as number | null;
    if (values.length > 1 && (typeof values[1] === 'number' || values[1] === null)) {
      conceptoCostoId = values[1] as number | null;
      values = values.slice(2);
    } else {
      values = values.slice(1);
    }
  }

  const [conceptoCosto = '-', parametroUnidad = '-', evaluado = '-', rango = '-', diferencia = '-', resultado = '-', resultadoKind = 'none', costoUnitario = '-'] =
    values as [string?, string?, string?, string?, string?, string?, ReportResultKind?, string?];
  const kind = (resultadoKind ?? 'none') as ReportResultKind;

  return {
    ...boqRow,
    parameterId,
    parametro: matchedParameter?.clave ?? '-',
    parametroUnidad,
    conceptoCostoId,
    conceptoCosto,
    costoUnitario,
    evaluado,
    rango,
    diferencia,
    resultado,
    kind,
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
  comparisonGranularity: ReportComparisonGranularity,
  wbsLevel: number,
  catalogWbsIndex: CatalogWbsIndex | null,
  manualConceptId: number | null,
): ConceptoB5DOrm | null {
  if (manualConceptId != null) {
    const manualConcept = concepts.find((conceptRow) => conceptRow.id === manualConceptId) ?? null;
    if (manualConcept) return manualConcept;
  }

  const matchedConcept = findMatchingConcept(boqRow, concepts);
  if (matchedConcept) return matchedConcept;

  const candidates = getCostCandidateConcepts(matchedParameter, concepts);
  const conceptWithCost = candidates.find((conceptRow) => resolveConceptUnitCost(conceptRow) != null);
  if (conceptWithCost) return conceptWithCost;

  return candidates[0] ?? null;
}

function findMatchingConceptByWbs(
  boqRow: BoqExtractedRow,
  concepts: ConceptoB5DOrm[],
  wbsLevel: number,
  catalogWbsIndex: CatalogWbsIndex | null,
): ConceptoB5DOrm | null {
  const boqWbsSignatures = new Set(buildWbsWindowSignatures(boqRow.clave, wbsLevel));
  const normalizedBoqKey = normalizeText(boqRow.clave);
  const boqDescription = normalizeText(boqRow.descripcion);
  const candidates = catalogWbsIndex ? [...catalogWbsIndex.conceptById.values()] : concepts;

  const exactMatches: ConceptoB5DOrm[] = [];
  const agrupadorMatches: ConceptoB5DOrm[] = [];
  const partialMatches: ConceptoB5DOrm[] = [];
  const descriptionMatches: ConceptoB5DOrm[] = [];

  for (const conceptRow of candidates) {
    const conceptWbsSignatures = new Set(
      buildWbsWindowSignatures(catalogWbsIndex?.pathSegmentsById.get(conceptRow.id) ?? getConceptWbsKey(conceptRow), wbsLevel),
    );
    const codeCandidates = [
      normalizeText(conceptRow.clave ?? ''),
      normalizeText(conceptRow.clave_secundaria ?? ''),
    ].filter((value) => !!value);
    const description = normalizeText(conceptRow.descripcion ?? '');

    const hasExactWindowMatch = [...conceptWbsSignatures].some((signature) => boqWbsSignatures.has(signature));
    if (hasExactWindowMatch) {
      if (conceptRow.es_agrupador) {
        agrupadorMatches.push(conceptRow);
      } else {
        exactMatches.push(conceptRow);
      }
      continue;
    }

    if (
      codeCandidates.some((code) =>
        code &&
        (normalizedBoqKey === code || normalizedBoqKey.includes(code) || code.includes(normalizedBoqKey)),
      )
    ) {
      partialMatches.push(conceptRow);
      continue;
    }

    if ([...conceptWbsSignatures].some((signature) => normalizedBoqKey.includes(signature) || signature.includes(normalizedBoqKey))) {
      partialMatches.push(conceptRow);
      continue;
    }

    if (description && boqDescription.includes(description)) {
      descriptionMatches.push(conceptRow);
    }
  }

  if (agrupadorMatches.length) return agrupadorMatches[0];
  if (exactMatches.length) return exactMatches[0];
  if (partialMatches.length) return partialMatches[0];
  if (descriptionMatches.length) return descriptionMatches[0];
  return null;
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

export function buildCatalogWbsIndex(concepts: ConceptoB5DOrm[]): CatalogWbsIndex {
  const conceptById = new Map<number, ConceptoB5DOrm>();
  for (const concept of concepts) {
    conceptById.set(concept.id, concept);
  }

  const depthById = new Map<number, number>();
  const pathSegmentsById = new Map<number, string[]>();
  const visiting = new Set<number>();
  let maxDepth = 1;
  const resolvePathSegments = (conceptId: number): string[] => {
    const cachedSegments = pathSegmentsById.get(conceptId);
    if (cachedSegments) return cachedSegments;
    if (visiting.has(conceptId)) return [];
    const concept = conceptById.get(conceptId);
    if (!concept) return [];

    visiting.add(conceptId);
    const parentId = concept.agrupador_padre_id;
    const parentSegments = parentId != null && conceptById.has(parentId) ? resolvePathSegments(parentId) : [];
    const conceptKey = getConceptWbsKey(concept);
    const segments = conceptKey ? [...parentSegments, conceptKey] : parentSegments;
    visiting.delete(conceptId);
    pathSegmentsById.set(conceptId, segments);
    const depth = segments.length || 1;
    depthById.set(conceptId, depth);
    if (depth > maxDepth) {
      maxDepth = depth;
    }
    return segments;
  };

  const conceptsByDepth = new Map<number, ConceptoB5DOrm[]>();
  for (const concept of concepts) {
    const depth = resolvePathSegments(concept.id).length || 1;
    const bucket = conceptsByDepth.get(depth) ?? [];
    bucket.push(concept);
    conceptsByDepth.set(depth, bucket);
  }

  return {
    conceptById,
    depthById,
    pathSegmentsById,
    conceptsByDepth,
    maxDepth,
  };
}

function getConceptWbsKey(concept: ConceptoB5DOrm): string {
  return (concept.clave ?? concept.clave_secundaria ?? '').trim();
}

function resolveConceptUnitCost(concept: ConceptoB5DOrm): number | null {
  return parseNumericLikeValue(concept.importe ?? null);
}

function resolveConceptPercentage(concept: ConceptoB5DOrm): number | null {
  return parseNumericLikeValue(concept.porcentaje_padre ?? null);
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
  const epsilon = 0.0005;
  if (minimum != null && value < minimum - epsilon) return value - minimum;
  if (maximum != null && value > maximum + epsilon) return value - maximum;
  return 0;
}

function normalizeWbsLevel(value: number | null | undefined): number {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, numericValue);
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
    .replace(/_x000d_/gi, ' ')
    .replace(/\r\n?|\n/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringValue(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/_x000d_/gi, ' ')
    .replace(/\r\n?|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatValue(value: number | null, decimalPlaces = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const roundedValue = Math.abs(value) < 0.0005 ? 0 : value;
  return roundedValue.toFixed(decimalPlaces);
}

function normalizeDecimalPlaces(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 2;
  return Math.max(0, Math.min(6, Math.floor(value)));
}

function getPercent(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}
