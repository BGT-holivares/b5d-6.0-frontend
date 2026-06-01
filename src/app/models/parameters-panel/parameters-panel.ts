import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ResizableTableDirective } from '../../directives/resizable-table/resizable-table.directive';
import { BackendProyectosService } from '../../services/backend-proyectos.service';
import { WorkbookPreviewCacheService } from '../../services/workbook-preview-cache.service';
import type {
  CuantificacionB5DOrm,
  ParametroB5DOrm,
  ProyectoTrabajoOrm,
  TipoComparacionParametroOrm,
  TipoParametroOrm,
  WorkbookCellOrm,
  WorkbookSummarySheetOrm,
} from '../../types/b5d-orm';
import type { InformacionElementoSeleccionado } from '../../types/ifc';
import type { HomeToolbarState } from '../../types/home-toolbar';
import type { ToolbarActionId } from '../toolbar/toolbar';
import { WorkbookPreview } from '../workbook-preview/workbook-preview';

type ParameterDraftRow = {
  clave: string;
  descripcion: string;
  tipo_comparacion: TipoComparacionParametroOrm;
  tipo_parametro: TipoParametroOrm;
  tipo_edificacion: string;
  unidad: string;
  minimo: string;
  maximo: string;
  promedio: string;
  activo: boolean;
};

type BoqExtractedRow = {
  row: number;
  clave: string;
  descripcion: string;
  cantidad: number | null;
  unidad: string;
};

type BoqAnalysisRow = BoqExtractedRow & {
  matchedParameterCode: string;
  matchedParameterDescription: string;
  matchedParameterUnit: string;
  rangeText: string;
  resultText: string;
  resultKind: 'ok' | 'warning' | 'error' | 'none';
};

@Component({
  selector: 'app-parameters-panel',
  imports: [FormsModule, ResizableTableDirective, WorkbookPreview],
  templateUrl: './parameters-panel.html',
  styleUrl: './parameters-panel.scss',
})
export class ParametersPanel implements OnChanges {
  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Input() parameters: ParametroB5DOrm[] = [];
  @Input() b5dLoading = false;
  @Input() informacionSeleccionada: InformacionElementoSeleccionado | null = null;
  @Input() quantifications: CuantificacionB5DOrm[] = [];
  @Output() rowsChange = new EventEmitter<ParametroB5DOrm[]>();
  @Output() toolbarStateChange = new EventEmitter<HomeToolbarState>();

  selectedParameterType: TipoParametroOrm | 'all' = 'all';
  selectedBuildingType = 'all';
  selectedParameterIds = new Set<number>();
  workParameters: ParametroB5DOrm[] = [];
  creatingParameterInline = false;
  creatingAnchorParameterId: number | null = null;
  creatingDraft: ParameterDraftRow = this.getEmptyDraft();
  creatingInProgress = false;
  deletingInProgress = false;
  actionError = '';

  selectedQuantificationId: number | null = null;
  selectedSheetIndex = 0;
  boqSheets: WorkbookSummarySheetOrm[] = [];
  boqRows: BoqExtractedRow[] = [];
  boqLoading = false;
  boqError = '';

  leftPanelWidth = 720;
  private readonly backendProyectos = inject(BackendProyectosService);
  private readonly workbookPreviewCache = inject(WorkbookPreviewCacheService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['parameters']) {
      this.workParameters = this.parameters.map((parameterRow) => ({ ...parameterRow }));
      this.selectedParameterIds = new Set(
        [...this.selectedParameterIds].filter((parameterId) => this.workParameters.some((row) => row.id === parameterId)),
      );
      this.emitToolbarState();
    }

    if (changes['quantifications']) {
      const quantificationIds = new Set(this.quantifications.map((row) => row.id));
      if (this.selectedQuantificationId != null && quantificationIds.has(this.selectedQuantificationId)) {
        // Keep selection.
      } else {
        const withWorkbook = this.quantifications.find((row) => row.tiene_libro_excel);
        this.selectedQuantificationId = withWorkbook?.id ?? null;
        this.selectedSheetIndex = 0;
      }
      void this.loadBoqExtractedRows();
    }

    if (changes['activeProject']) {
      void this.loadBoqExtractedRows();
    }
  }

  get layoutTemplateColumns(): string {
    return `${this.leftPanelWidth}px 8px minmax(340px, 1fr)`;
  }

  get buildingTypeOptions(): string[] {
    const options = new Set<string>();
    for (const row of this.workParameters) {
      const buildingType = (row.tipo_edificacion ?? '').trim();
      if (buildingType) options.add(buildingType);
    }
    return [...options].sort((first, second) => first.localeCompare(second, 'es'));
  }

  get visibleRows(): ParametroB5DOrm[] {
    return this.workParameters.filter((row) => {
      if (this.selectedParameterType !== 'all' && row.tipo_parametro !== this.selectedParameterType) return false;
      if (this.selectedBuildingType !== 'all' && (row.tipo_edificacion ?? '') !== this.selectedBuildingType) return false;
      return true;
    });
  }

  get activeParametersForAnalysis(): ParametroB5DOrm[] {
    return this.visibleRows.filter((row) => row.activo);
  }

  get boqAnalysisRows(): BoqAnalysisRow[] {
    return this.boqRows.slice(0, 500).map((boqRow) => this.buildBoqAnalysisRow(boqRow));
  }

  get comparisonLabel(): string {
    if (this.selectedParameterType === 'all') return 'Costos y cantidades';
    return this.selectedParameterType === 'costo' ? 'Costos' : 'Cantidades';
  }

  get buildingLabel(): string {
    return this.selectedBuildingType === 'all' ? 'Todos' : this.selectedBuildingType;
  }

  get quantificationsWithWorkbook(): CuantificacionB5DOrm[] {
    return this.quantifications.filter((row) => row.tiene_libro_excel);
  }

  get selectedBoqSheetName(): string {
    return this.boqSheets.find((sheet) => sheet.index === this.selectedSheetIndex)?.name ?? '';
  }

  get quantificationLabel(): string {
    const selectedQuantification = this.quantificationsWithWorkbook.find((row) => row.id === this.selectedQuantificationId);
    return selectedQuantification?.nombre || selectedQuantification?.descripcion || '-';
  }

  triggerHomeAction(action: ToolbarActionId): void {
    if (action === 'home-add-item') {
      this.startInlineCreate();
      return;
    }
    if (action === 'home-remove-item') {
      void this.deleteSelectedRows();
      return;
    }
    if (action === 'home-select-all') {
      this.selectAllVisibleRows();
    }
  }

  startInternalResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const initialWidth = this.leftPanelWidth;
    const onPointerMove = (moveEvent: PointerEvent): void => {
      const widthDelta = moveEvent.clientX - startX;
      this.leftPanelWidth = this.clamp(initialWidth + widthDelta, 420, 1600);
      this.changeDetectorRef.detectChanges();
    };

    const stopResizing = (): void => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResizing, { once: true });
  }

  onRowClick(parameterId: number, event?: MouseEvent): void {
    const additiveSelection = !!event?.ctrlKey || !!event?.metaKey;
    if (!additiveSelection) {
      this.selectedParameterIds = new Set([parameterId]);
    } else if (this.selectedParameterIds.has(parameterId)) {
      this.selectedParameterIds.delete(parameterId);
      this.selectedParameterIds = new Set(this.selectedParameterIds);
    } else {
      this.selectedParameterIds.add(parameterId);
      this.selectedParameterIds = new Set(this.selectedParameterIds);
    }
    this.emitToolbarState();
  }

  isSelectedRow(parameterId: number): boolean {
    return this.selectedParameterIds.has(parameterId);
  }

  onFilterChange(): void {
    this.emitToolbarState();
  }

  startInlineCreate(): void {
    this.actionError = '';
    const primarySelectedId = this.getPrimarySelectedRowId();
    this.creatingAnchorParameterId = primarySelectedId;
    this.creatingDraft = this.getPrefilledDraft(primarySelectedId);
    this.creatingParameterInline = true;
    this.emitToolbarState();
  }

  isInlineEditorAnchoredAfter(parameterId: number): boolean {
    return this.creatingParameterInline && this.creatingAnchorParameterId === parameterId;
  }

  cancelInlineCreate(): void {
    this.creatingParameterInline = false;
    this.creatingAnchorParameterId = null;
    this.creatingDraft = this.getEmptyDraft();
    this.emitToolbarState();
  }

  async saveInlineCreate(): Promise<void> {
    if (!this.activeProject || this.creatingInProgress) return;
    this.actionError = '';
    this.creatingInProgress = true;

    try {
      const created = await firstValueFrom(
        this.backendProyectos.crearParametro(this.activeProject.id, {
          clave: this.creatingDraft.clave.trim() || null,
          descripcion: this.creatingDraft.descripcion.trim() || null,
          tipo_comparacion: this.creatingDraft.tipo_comparacion,
          tipo_parametro: this.creatingDraft.tipo_parametro,
          tipo_edificacion: this.creatingDraft.tipo_edificacion.trim() || null,
          unidad: this.creatingDraft.unidad.trim() || null,
          minimo: this.parseNullableNumber(this.creatingDraft.minimo),
          maximo: this.parseNullableNumber(this.creatingDraft.maximo),
          promedio: this.parseNullableNumber(this.creatingDraft.promedio),
          activo: !!this.creatingDraft.activo,
        }),
      );

      const insertIndex = this.resolveInsertIndexForCreatedRow(this.creatingAnchorParameterId);
      const nextRows = [...this.workParameters];
      nextRows.splice(insertIndex, 0, created);
      this.workParameters = nextRows;
      this.selectedParameterIds = new Set([created.id]);
      this.creatingParameterInline = false;
      this.creatingAnchorParameterId = null;
      this.creatingDraft = this.getEmptyDraft();
      this.rowsChange.emit(this.workParameters.map((row) => ({ ...row })));
      this.emitToolbarState();
    } catch (error) {
      this.actionError = this.resolveErrorMessage(error, 'No fue posible crear el parametro.');
    } finally {
      this.creatingInProgress = false;
    }
  }

  async deleteSelectedRows(): Promise<void> {
    if (!this.activeProject || !this.selectedParameterIds.size || this.deletingInProgress) return;
    this.actionError = '';
    this.deletingInProgress = true;
    try {
      await Promise.all(
        [...this.selectedParameterIds].map((parameterId) =>
          firstValueFrom(this.backendProyectos.eliminarParametro(this.activeProject!.id, parameterId)),
        ),
      );
      this.workParameters = this.workParameters.filter((row) => !this.selectedParameterIds.has(row.id));
      this.selectedParameterIds.clear();
      this.rowsChange.emit(this.workParameters.map((row) => ({ ...row })));
      this.emitToolbarState();
    } catch (error) {
      this.actionError = this.resolveErrorMessage(error, 'No fue posible eliminar los parametros seleccionados.');
    } finally {
      this.deletingInProgress = false;
    }
  }

  selectAllVisibleRows(): void {
    this.selectedParameterIds = new Set(this.visibleRows.map((row) => row.id));
    this.emitToolbarState();
  }

  async selectBoqQuantification(quantificationId: number | null): Promise<void> {
    this.selectedQuantificationId = quantificationId;
    this.selectedSheetIndex = 0;
    await this.loadBoqExtractedRows();
  }

  async selectBoqSheet(sheetIndex: number): Promise<void> {
    this.selectedSheetIndex = sheetIndex;
    await this.loadBoqExtractedRows();
  }

  resolveAverage(row: ParametroB5DOrm): number | null {
    if (row.promedio != null) return row.promedio;
    if (row.minimo == null || row.maximo == null) return null;
    return (row.minimo + row.maximo) / 2;
  }

  resolveComparisonLabel(value: ParametroB5DOrm['tipo_comparacion']): string {
    if (value === 'clave_exacta') return 'Clave exacta';
    if (value === 'clave_parcial') return 'Clave parcial';
    return 'Descripcion parcial';
  }

  formatValue(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '-';
    return Number(value).toLocaleString('es-MX', { maximumFractionDigits: 4 });
  }

  getAnalysisResultClass(kind: BoqAnalysisRow['resultKind']): string {
    if (kind === 'ok') return 'b5d-parameters-panel__analysis-result--ok';
    if (kind === 'warning') return 'b5d-parameters-panel__analysis-result--warning';
    if (kind === 'error') return 'b5d-parameters-panel__analysis-result--error';
    return '';
  }

  private emitToolbarState(): void {
    this.toolbarStateChange.emit({
      activeBottomTab: 'parameters',
      activePanel: 'concepts',
      linksViewVisible: false,
      conceptsTotal: 0,
      objectsTotal: 0,
      linksTotal: 0,
      selectedConceptIds: [],
      selectedNonGroupingConceptIds: [],
      selectedObjectIds: [],
      selectedLinkIds: [],
      canPasteConcept: false,
      parametersTotal: this.visibleRows.length,
      selectedParameterIds: [...this.selectedParameterIds],
    });
  }

  private getEmptyDraft(): ParameterDraftRow {
    return {
      clave: '',
      descripcion: '',
      tipo_comparacion: 'clave_exacta',
      tipo_parametro: 'cantidad',
      tipo_edificacion: '',
      unidad: '',
      minimo: '',
      maximo: '',
      promedio: '',
      activo: true,
    };
  }

  private getPrefilledDraft(selectedParameterId: number | null): ParameterDraftRow {
    const selected = selectedParameterId == null ? null : this.workParameters.find((row) => row.id === selectedParameterId);
    if (!selected) return this.getEmptyDraft();
    return {
      clave: selected.clave ?? '',
      descripcion: selected.descripcion ?? '',
      tipo_comparacion: selected.tipo_comparacion,
      tipo_parametro: selected.tipo_parametro,
      tipo_edificacion: selected.tipo_edificacion ?? '',
      unidad: selected.unidad ?? '',
      minimo: selected.minimo == null ? '' : String(selected.minimo),
      maximo: selected.maximo == null ? '' : String(selected.maximo),
      promedio: selected.promedio == null ? '' : String(selected.promedio),
      activo: selected.activo,
    };
  }

  private getPrimarySelectedRowId(): number | null {
    const rows = this.visibleRows;
    for (const row of rows) {
      if (this.selectedParameterIds.has(row.id)) return row.id;
    }
    return rows[0]?.id ?? null;
  }

  private resolveInsertIndexForCreatedRow(anchorId: number | null): number {
    if (anchorId == null) return this.workParameters.length;
    const index = this.workParameters.findIndex((row) => row.id === anchorId);
    if (index < 0) return this.workParameters.length;
    return index + 1;
  }

  private parseNullableNumber(value: string): number | null {
    const normalized = (value ?? '').trim();
    if (!normalized) return null;
    const numericValue = Number(normalized.replace(',', '.'));
    if (!Number.isFinite(numericValue)) return null;
    return numericValue;
  }

  private async loadBoqExtractedRows(): Promise<void> {
    const projectId = this.activeProject?.id;
    const quantificationId = this.selectedQuantificationId;
    if (!projectId || !quantificationId) {
      this.boqSheets = [];
      this.boqRows = [];
      return;
    }

    this.boqLoading = true;
    this.boqError = '';
    try {
      const summary = await this.workbookPreviewCache.getWorkbookSummary(projectId, quantificationId);
      this.boqSheets = summary.sheets;
      if (!this.boqSheets.some((sheet) => sheet.index === this.selectedSheetIndex)) {
        this.selectedSheetIndex = this.boqSheets[0]?.index ?? 0;
      }

      const layers = await this.workbookPreviewCache.getWorkbookSheetLayers(projectId, quantificationId, this.selectedSheetIndex);
      this.boqRows = this.extractBoqRows(layers.cells);
    } catch (error) {
      this.boqRows = [];
      this.boqError = this.resolveErrorMessage(error, 'No fue posible extraer los datos BOQ.');
    } finally {
      this.boqLoading = false;
    }
  }

  private extractBoqRows(cells: WorkbookCellOrm[]): BoqExtractedRow[] {
    if (!cells.length) return [];
    const cellsByRow = new Map<number, WorkbookCellOrm[]>();
    for (const cellData of cells) {
      const rowCells = cellsByRow.get(cellData.row) ?? [];
      rowCells.push(cellData);
      cellsByRow.set(cellData.row, rowCells);
    }

    const sortedRows = [...cellsByRow.entries()].sort((first, second) => first[0] - second[0]);
    const headerMap = this.findBoqHeaderMap(sortedRows);
    const extractedRows: BoqExtractedRow[] = [];

    for (const [rowNumber, rowCells] of sortedRows) {
      if (headerMap && rowNumber <= headerMap.headerRow) continue;
      rowCells.sort((first, second) => first.col - second.col);

      const extractedRow = this.extractBoqRowFromCells(rowNumber, rowCells, headerMap);
      if (!extractedRow) continue;
      extractedRows.push(extractedRow);
    }

    return extractedRows.slice(0, 500);
  }

  private findBoqHeaderMap(
    rows: Array<[number, WorkbookCellOrm[]]>,
  ): { headerRow: number; claveCol: number; descripcionCol: number; cantidadCol: number; unidadCol: number } | null {
    for (const [rowNumber, rowCells] of rows) {
      const byText = new Map<string, number>();
      for (const cellData of rowCells) {
        const text = this.normalizeCellText(cellData);
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

  private extractBoqRowFromCells(
    rowNumber: number,
    rowCells: WorkbookCellOrm[],
    headerMap: { claveCol: number; descripcionCol: number; cantidadCol: number; unidadCol: number } | null,
  ): BoqExtractedRow | null {
    if (headerMap) {
      const clave = this.valueAtColumn(rowCells, headerMap.claveCol);
      const descripcion = this.valueAtColumn(rowCells, headerMap.descripcionCol);
      const cantidad = this.parseNumericCell(this.valueAtColumn(rowCells, headerMap.cantidadCol));
      const unidad = this.valueAtColumn(rowCells, headerMap.unidadCol);
      if (!clave && !descripcion && cantidad == null && !unidad) return null;
      return { row: rowNumber, clave, descripcion, cantidad, unidad };
    }

    const textCells = rowCells
      .map((cellData) => ({ col: cellData.col, value: this.stringValue(cellData.value) }))
      .filter((cellData) => !!cellData.value);
    if (textCells.length < 3) return null;

    const numberCell = rowCells
      .map((cellData) => ({ col: cellData.col, value: this.parseNumericCell(this.stringValue(cellData.value)) }))
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

  private buildBoqAnalysisRow(boqRow: BoqExtractedRow): BoqAnalysisRow {
    const matchedParameter = this.findMatchingParameter(boqRow);
    if (!matchedParameter) {
      return {
        ...boqRow,
        matchedParameterCode: '-',
        matchedParameterDescription: '-',
        matchedParameterUnit: '-',
        rangeText: '-',
        resultText: 'Sin parametro',
        resultKind: 'none',
      };
    }

    const rangeMin = matchedParameter.minimo;
    const rangeMax = matchedParameter.maximo;
    const rangeText = `${this.formatValue(rangeMin)} - ${this.formatValue(rangeMax)}`;
    const boqQuantity = boqRow.cantidad;
    if (boqQuantity == null) {
      return {
        ...boqRow,
        matchedParameterCode: matchedParameter.clave ?? '-',
        matchedParameterDescription: matchedParameter.descripcion ?? '-',
        matchedParameterUnit: matchedParameter.unidad ?? '-',
        rangeText,
        resultText: 'Sin cantidad',
        resultKind: 'warning',
      };
    }

    const convertedValue = this.convertQuantityToUnit(boqQuantity, boqRow.unidad, matchedParameter.unidad ?? '');
    if (convertedValue == null) {
      return {
        ...boqRow,
        matchedParameterCode: matchedParameter.clave ?? '-',
        matchedParameterDescription: matchedParameter.descripcion ?? '-',
        matchedParameterUnit: matchedParameter.unidad ?? '-',
        rangeText,
        resultText: 'Unidad no compatible',
        resultKind: 'warning',
      };
    }

    const isBelow = rangeMin != null && convertedValue < rangeMin;
    const isAbove = rangeMax != null && convertedValue > rangeMax;
    if (isBelow || isAbove) {
      return {
        ...boqRow,
        matchedParameterCode: matchedParameter.clave ?? '-',
        matchedParameterDescription: matchedParameter.descripcion ?? '-',
        matchedParameterUnit: matchedParameter.unidad ?? '-',
        rangeText,
        resultText: `Fuera de rango (${this.formatValue(convertedValue)})`,
        resultKind: 'error',
      };
    }

    return {
      ...boqRow,
      matchedParameterCode: matchedParameter.clave ?? '-',
      matchedParameterDescription: matchedParameter.descripcion ?? '-',
      matchedParameterUnit: matchedParameter.unidad ?? '-',
      rangeText,
      resultText: `En rango (${this.formatValue(convertedValue)})`,
      resultKind: 'ok',
    };
  }

  private findMatchingParameter(boqRow: BoqExtractedRow): ParametroB5DOrm | null {
    const boqCode = this.normalizeText(boqRow.clave);
    const boqDescription = this.normalizeText(boqRow.descripcion);
    for (const parameterRow of this.activeParametersForAnalysis) {
      if (parameterRow.tipo_parametro !== 'cantidad') continue;
      const code = this.normalizeText(parameterRow.clave ?? '');
      const description = this.normalizeText(parameterRow.descripcion ?? '');
      if (parameterRow.tipo_comparacion === 'clave_exacta' && code && boqCode === code) return parameterRow;
      if (parameterRow.tipo_comparacion === 'clave_parcial' && code && boqCode.includes(code)) return parameterRow;
      if (
        parameterRow.tipo_comparacion === 'descripcion_parcial' &&
        description &&
        boqDescription.includes(description)
      ) {
        return parameterRow;
      }
    }
    return null;
  }

  private convertQuantityToUnit(value: number, fromUnit: string, toUnit: string): number | null {
    const from = this.normalizeUnit(fromUnit);
    const to = this.normalizeUnit(toUnit);
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

  private normalizeUnit(unit: string): string {
    return unit.trim().toLowerCase().replace(/\s+/g, '');
  }

  private valueAtColumn(rowCells: WorkbookCellOrm[], col: number): string {
    const cellData = rowCells.find((cellItem) => cellItem.col === col);
    return this.stringValue(cellData?.value ?? null);
  }

  private parseNumericCell(value: string): number | null {
    if (!value) return null;
    const sanitized = value.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
    const numericValue = Number(sanitized);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  private normalizeCellText(cellData: WorkbookCellOrm): string {
    return this.normalizeText(this.stringValue(cellData.value));
  }

  private normalizeText(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private stringValue(value: unknown): string {
    if (value == null) return '';
    return String(value).trim();
  }

  private clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(Math.max(value, minValue), maxValue);
  }

  private resolveErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const httpError = error as { error?: { error?: string } };
      const message = httpError.error?.error;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }
}
