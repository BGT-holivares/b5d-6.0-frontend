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
import { XlsxPreview } from '../xlsx-preview/xlsx-preview';

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
  deltaText: string;
  resultText: string;
  resultKind: 'ok' | 'warning' | 'error' | 'none';
};

type DescriptionMatchCandidateGroup = {
  parameterId: number;
  parameterCode: string;
  parameterDescription: string;
  candidates: BoqExtractedRow[];
};

@Component({
  selector: 'app-parameters-panel',
  imports: [FormsModule, ResizableTableDirective, XlsxPreview],
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
  savingParameterActiveById = new Set<number>();
  descriptionSelectionByParameterId = new Map<number, Set<string>>();
  parameterListVisible = true;
  boqPreviewVisible = true;
  descriptionMatchesVisible = true;
  analysisVisible = true;
  topLeftPaneWidth = 540;
  bottomLeftPaneWidth = 420;
  topWorkspaceHeight = 390;
  private readonly backendProyectos = inject(BackendProyectosService);
  private readonly workbookPreviewCache = inject(WorkbookPreviewCacheService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['parameters']) {
      this.workParameters = this.parameters.map((parameterRow) => ({ ...parameterRow }));
      this.selectedParameterIds = new Set(
        [...this.selectedParameterIds].filter((parameterId) => this.workParameters.some((row) => row.id === parameterId)),
      );
      this.synchronizeDescriptionSelections();
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

  get workspaceTemplateRows(): string {
    const topVisible = this.topWorkspaceVisible;
    const bottomVisible = this.bottomWorkspaceVisible;
    if (topVisible && bottomVisible) {
      return `${this.topWorkspaceHeight}px 8px minmax(0, 1fr)`;
    }
    if (topVisible || bottomVisible) {
      return 'minmax(0, 1fr)';
    }
    return '0px';
  }

  get topRowTemplateColumns(): string {
    if (this.parameterListVisible && this.boqPreviewVisible) {
      return `${this.topLeftPaneWidth}px 8px minmax(0, 1fr)`;
    }
    return 'minmax(0, 1fr)';
  }

  get bottomRowTemplateColumns(): string {
    if (this.descriptionMatchesVisible && this.descriptionMatchCandidateGroups.length > 0 && this.analysisVisible) {
      return `${this.bottomLeftPaneWidth}px 8px minmax(0, 1fr)`;
    }
    return 'minmax(0, 1fr)';
  }

  get topWorkspaceVisible(): boolean {
    return this.parameterListVisible || this.boqPreviewVisible;
  }

  get bottomWorkspaceVisible(): boolean {
    return (this.descriptionMatchesVisible && this.descriptionMatchCandidateGroups.length > 0) || this.analysisVisible;
  }

  get showTopVerticalSplitter(): boolean {
    return this.parameterListVisible && this.boqPreviewVisible;
  }

  get showBottomVerticalSplitter(): boolean {
    return this.descriptionMatchesVisible && this.descriptionMatchCandidateGroups.length > 0 && this.analysisVisible;
  }

  get showHorizontalSplitter(): boolean {
    return this.topWorkspaceVisible && this.bottomWorkspaceVisible;
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

  get descriptionMatchCandidateGroups(): DescriptionMatchCandidateGroup[] {
    const groups: DescriptionMatchCandidateGroup[] = [];
    for (const parameterRow of this.activeParametersForAnalysis) {
      if (parameterRow.tipo_parametro !== 'cantidad') continue;
      if (parameterRow.tipo_comparacion !== 'descripcion_parcial') continue;
      const normalizedDescription = this.normalizeText(parameterRow.descripcion ?? '');
      if (!normalizedDescription) continue;
      const candidates = this.boqRows.filter((boqRow) =>
        this.normalizeText(boqRow.descripcion).includes(normalizedDescription),
      );
      if (!candidates.length) continue;
      groups.push({
        parameterId: parameterRow.id,
        parameterCode: parameterRow.clave ?? '-',
        parameterDescription: parameterRow.descripcion ?? '-',
        candidates,
      });
    }
    return groups;
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
      return;
    }
    if (action === 'home-calc-parameter') {
      void this.runParameterTest();
      return;
    }
    if (action === 'parameter-toggle-list') {
      this.toggleParameterListVisible();
      return;
    }
    if (action === 'parameter-toggle-boq') {
      this.toggleBoqPreviewVisible();
      return;
    }
    if (action === 'parameter-toggle-matches') {
      this.toggleDescriptionMatchesVisible();
      return;
    }
    if (action === 'parameter-toggle-analysis') {
      this.toggleAnalysisVisible();
    }
  }

  async runParameterTest(): Promise<void> {
    await this.loadBoqExtractedRows();
  }

  toggleParameterListVisible(): void {
    this.parameterListVisible = !this.parameterListVisible;
    this.emitToolbarState();
  }

  toggleBoqPreviewVisible(): void {
    this.boqPreviewVisible = !this.boqPreviewVisible;
    this.emitToolbarState();
  }

  toggleDescriptionMatchesVisible(): void {
    this.descriptionMatchesVisible = !this.descriptionMatchesVisible;
    this.emitToolbarState();
  }

  toggleAnalysisVisible(): void {
    this.analysisVisible = !this.analysisVisible;
    this.emitToolbarState();
  }

  startInternalResize(
    event: PointerEvent,
    target: 'top-vertical' | 'bottom-vertical' | 'horizontal',
  ): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const initialTopWidth = this.topLeftPaneWidth;
    const initialBottomWidth = this.bottomLeftPaneWidth;
    const initialHeight = this.topWorkspaceHeight;
    const onPointerMove = (moveEvent: PointerEvent): void => {
      const widthDelta = moveEvent.clientX - startX;
      const heightDelta = moveEvent.clientY - startY;
      if (target === 'top-vertical') {
        this.topLeftPaneWidth = this.clamp(initialTopWidth + widthDelta, 320, 1200);
      } else if (target === 'bottom-vertical') {
        this.bottomLeftPaneWidth = this.clamp(initialBottomWidth + widthDelta, 260, 1200);
      } else {
        this.topWorkspaceHeight = this.clamp(initialHeight + heightDelta, 260, 900);
      }
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

  async onParameterActiveToggle(parameterRow: ParametroB5DOrm, nextValue: boolean): Promise<void> {
    if (!this.activeProject) return;
    if (this.savingParameterActiveById.has(parameterRow.id)) return;
    this.actionError = '';
    this.savingParameterActiveById.add(parameterRow.id);

    const previousValue = parameterRow.activo;
    parameterRow.activo = nextValue;
    this.synchronizeDescriptionSelections();
    this.emitToolbarState();

    try {
      const updated = await firstValueFrom(
        this.backendProyectos.actualizarParametro(this.activeProject.id, parameterRow.id, { activo: nextValue }),
      );
      this.workParameters = this.workParameters.map((row) => (row.id === updated.id ? { ...updated } : row));
      this.rowsChange.emit(this.workParameters.map((row) => ({ ...row })));
      this.synchronizeDescriptionSelections();
      this.emitToolbarState();
    } catch (error) {
      parameterRow.activo = previousValue;
      this.synchronizeDescriptionSelections();
      this.emitToolbarState();
      this.actionError = this.resolveErrorMessage(error, 'No fue posible actualizar el estado del parametro.');
    } finally {
      this.savingParameterActiveById.delete(parameterRow.id);
    }
  }

  isSavingParameterActive(parameterId: number): boolean {
    return this.savingParameterActiveById.has(parameterId);
  }

  isDescriptionCandidateSelected(parameterId: number, boqRow: BoqExtractedRow): boolean {
    const selectedRows = this.descriptionSelectionByParameterId.get(parameterId);
    if (!selectedRows) return false;
    return selectedRows.has(this.buildBoqRowKey(boqRow));
  }

  onDescriptionCandidateToggle(parameterId: number, boqRow: BoqExtractedRow, checked: boolean): void {
    const rowKey = this.buildBoqRowKey(boqRow);
    const selectedRows = new Set(this.descriptionSelectionByParameterId.get(parameterId) ?? []);
    if (checked) {
      selectedRows.add(rowKey);
    } else {
      selectedRows.delete(rowKey);
    }
    this.descriptionSelectionByParameterId.set(parameterId, selectedRows);
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
      selectedCatalogId: null,
      parametersTotal: this.visibleRows.length,
      selectedParameterIds: [...this.selectedParameterIds],
      parameterListVisible: this.parameterListVisible,
      parameterBoqVisible: this.boqPreviewVisible,
      parameterDescriptionMatchesVisible: this.descriptionMatchesVisible,
      parameterAnalysisVisible: this.analysisVisible,
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
      this.synchronizeDescriptionSelections();
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
        deltaText: '-',
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
        deltaText: '-',
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
        deltaText: '-',
        resultText: 'Unidad no compatible',
        resultKind: 'warning',
      };
    }

    const delta = this.computeRangeDelta(convertedValue, rangeMin, rangeMax);
    const unitLabel = matchedParameter.unidad?.trim() || boqRow.unidad?.trim() || 'u';
    const deltaText = `${delta >= 0 ? '+' : ''}${this.formatValue(delta)} ${unitLabel}`;
    if (delta !== 0) {
      return {
        ...boqRow,
        matchedParameterCode: matchedParameter.clave ?? '-',
        matchedParameterDescription: matchedParameter.descripcion ?? '-',
        matchedParameterUnit: matchedParameter.unidad ?? '-',
        rangeText,
        deltaText,
        resultText: 'Fuera de rango',
        resultKind: 'error',
      };
    }

    return {
      ...boqRow,
      matchedParameterCode: matchedParameter.clave ?? '-',
      matchedParameterDescription: matchedParameter.descripcion ?? '-',
      matchedParameterUnit: matchedParameter.unidad ?? '-',
      rangeText,
      deltaText: '+0',
      resultText: 'En rango',
      resultKind: 'ok',
    };
  }

  private findMatchingParameter(boqRow: BoqExtractedRow): ParametroB5DOrm | null {
    const boqCode = this.normalizeText(boqRow.clave);
    const boqDescription = this.normalizeText(boqRow.descripcion);

    const exactMatches: ParametroB5DOrm[] = [];
    const partialCodeMatches: ParametroB5DOrm[] = [];
    const partialDescriptionMatches: ParametroB5DOrm[] = [];

    for (const parameterRow of this.activeParametersForAnalysis) {
      if (parameterRow.tipo_parametro !== 'cantidad') continue;
      const code = this.normalizeText(parameterRow.clave ?? '');
      const description = this.normalizeText(parameterRow.descripcion ?? '');
      if (parameterRow.tipo_comparacion === 'clave_exacta' && code && boqCode === code) {
        exactMatches.push(parameterRow);
        continue;
      }
      if (parameterRow.tipo_comparacion === 'clave_parcial' && code && boqCode.includes(code)) {
        partialCodeMatches.push(parameterRow);
        continue;
      }
      if (
        parameterRow.tipo_comparacion === 'descripcion_parcial' &&
        description &&
        boqDescription.includes(description) &&
        this.isDescriptionCandidateSelected(parameterRow.id, boqRow)
      ) {
        partialDescriptionMatches.push(parameterRow);
      }
    }

    if (exactMatches.length) return exactMatches[0];
    if (partialCodeMatches.length) return partialCodeMatches[0];
    if (partialDescriptionMatches.length) return partialDescriptionMatches[0];
    return null;
  }

  private computeRangeDelta(value: number, minimum: number | null, maximum: number | null): number {
    if (minimum != null && value < minimum) return value - minimum;
    if (maximum != null && value > maximum) return value - maximum;
    return 0;
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

  private buildBoqRowKey(boqRow: BoqExtractedRow): string {
    return `${boqRow.row}|${this.normalizeText(boqRow.clave)}|${this.normalizeText(boqRow.descripcion)}`;
  }

  private synchronizeDescriptionSelections(): void {
    const nextSelectionMap = new Map<number, Set<string>>();
    for (const parameterRow of this.activeParametersForAnalysis) {
      if (parameterRow.tipo_parametro !== 'cantidad') continue;
      if (parameterRow.tipo_comparacion !== 'descripcion_parcial') continue;
      const normalizedDescription = this.normalizeText(parameterRow.descripcion ?? '');
      if (!normalizedDescription) continue;

      const candidateKeys = new Set<string>();
      for (const boqRow of this.boqRows) {
        const boqDescription = this.normalizeText(boqRow.descripcion);
        if (!boqDescription.includes(normalizedDescription)) continue;
        candidateKeys.add(this.buildBoqRowKey(boqRow));
      }
      if (!candidateKeys.size) continue;

      const previousSelection = this.descriptionSelectionByParameterId.get(parameterRow.id);
      const selectedKeys = new Set<string>();
      if (!previousSelection || !previousSelection.size) {
        for (const candidateKey of candidateKeys) selectedKeys.add(candidateKey);
      } else {
        for (const candidateKey of candidateKeys) {
          if (previousSelection.has(candidateKey)) selectedKeys.add(candidateKey);
        }
        if (!selectedKeys.size) {
          for (const candidateKey of candidateKeys) selectedKeys.add(candidateKey);
        }
      }
      nextSelectionMap.set(parameterRow.id, selectedKeys);
    }
    this.descriptionSelectionByParameterId = nextSelectionMap;
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
