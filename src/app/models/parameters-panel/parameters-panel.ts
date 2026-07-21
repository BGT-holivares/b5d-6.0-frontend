import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ResizableTableDirective } from '../../directives/resizable-table/resizable-table.directive';
import { BackendProyectosService } from '../../services/backend-proyectos.service';
import { WorkbookPreviewCacheService } from '../../services/workbook-preview-cache.service';
import { getSafeLocalStorage } from '../../utils/browser-storage';
import { I18nService } from '../../utils/i18n/i18n.service';
import { handlePanelZoomWheel, startPointerDrag } from '../../utils/panel-interactions/panel-interactions';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';
import { buildScopedStorageKey } from '../../utils/ui-state-storage';
import { PARAMETERS_PANEL_TRANSLATIONS } from './parameters-panel.translations';
import {
  applyTableFilters,
  createDefaultTableViewPreferences,
  ensureTablePreferencesColumns,
  getFilterModesForKind,
  getVisibleColumns,
  loadTableViewPreferences,
  moveTableColumn,
  resetTableViewPreferences,
  saveTableViewPreferences,
  setTableFilterMode,
  setTableFilterValue,
  toggleTableColumnVisibility,
  type TableColumnDefinition,
  type TableViewPreferences,
} from '../../utils/table-view/table-view';
import type {
  CatalogoB5DOrm,
  CatalogoParametroB5DOrm,
  ConceptoB5DOrm,
  CuantificacionB5DOrm,
  ParametroB5DOrm,
  ProyectoTrabajoOrm,
  TipoComparacionParametroOrm,
  TipoParametroOrm,
  WorkbookCellOrm,
  WorkbookSummarySheetOrm,
} from '../../types/b5d-orm';
import { isCostParameterType } from '../../utils/parameters/parameter-types';
import type { InformacionElementoSeleccionado } from '../../types/ifc';
import type { HomeToolbarState } from '../../types/home-toolbar';
import type { ToolbarActionId } from '../toolbar/toolbar';

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
  evaluatedText: string;
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

type CostMatchCandidateGroup = {
  parameterId: number;
  parameterCode: string;
  parameterDescription: string;
  candidates: {
    id: number;
    clave: string;
    descripcion: string;
    unidad: string;
    precio_unitario: number | null;
  }[];
};

type CostPercentMatchCandidateGroup = {
  parameterId: number;
  parameterCode: string;
  parameterDescription: string;
  candidates: {
    id: number;
    clave: string;
    descripcion: string;
    unidad: string;
    porcentaje: number | null;
  }[];
};

type ParameterTableColumnKey =
  | 'activo'
  | 'clave'
  | 'descripcion'
  | 'tipo_comparacion'
  | 'tipo_parametro'
  | 'tipo_edificacion'
  | 'unidad'
  | 'minimo'
  | 'maximo'
  | 'promedio';

type ParameterPaneId = 'parameter-list' | 'description-matches' | 'analysis';

@Component({
  selector: 'app-parameters-panel',
  imports: [FormsModule, ResizableTableDirective],
  templateUrl: './parameters-panel.html',
  styleUrl: './parameters-panel.scss',
})
export class ParametersPanel implements OnChanges {
  readonly parametersPanelTranslations = PARAMETERS_PANEL_TRANSLATIONS;
  readonly globalTranslations = GLOBAL_TRANSLATIONS;
  readonly i18n = inject(I18nService);

  private t(key: string): string {
    return this.i18n.translateForComponent(this.parametersPanelTranslations, key);
  }

  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Input() parameters: ParametroB5DOrm[] = [];
  @Input() concepts: ConceptoB5DOrm[] = [];
  @Input() catalogs: CatalogoB5DOrm[] = [];
  @Input() activeCatalogId: number | null = null;
  @Input() parameterCatalogs: CatalogoParametroB5DOrm[] = [];
  @Input() activeParameterCatalogId: number | null = null;
  @Input() b5dLoading = false;
  @Input() tableFiltersVisible = false;
  @Input() informacionSeleccionada: InformacionElementoSeleccionado | null = null;
  @Input() quantifications: CuantificacionB5DOrm[] = [];
  @Input() conceptKeys: string[] = [];
  @Input() storageScopeKey = 'anonymous';
  @Output() rowsChange = new EventEmitter<ParametroB5DOrm[]>();
  @Output() toolbarStateChange = new EventEmitter<HomeToolbarState>();
  @Output() conceptSelectionRequested = new EventEmitter<string>();
  @Output() parameterCatalogChanged = new EventEmitter<void>();

  readonly parameterTableColumns: TableColumnDefinition<ParametroB5DOrm>[] = [
    {
      key: 'activo',
      label: this.t('parameters.column.active'),
      labelKey: 'parameters.column.active',
      kind: 'boolean',
      widthPx: 72,
      getValue: (row) => row.activo,
    },
    {
      key: 'clave',
      label: this.t('parameters.column.code'),
      labelKey: 'parameters.column.code',
      kind: 'text',
      widthPx: 160,
      getValue: (row) => row.clave ?? '',
    },
    {
      key: 'descripcion',
      label: this.t('parameters.column.description'),
      labelKey: 'parameters.column.description',
      kind: 'text',
      widthPx: 260,
      getValue: (row) => row.descripcion ?? '',
    },
    {
      key: 'tipo_comparacion',
      label: this.t('parameters.column.comparison'),
      labelKey: 'parameters.column.comparison',
      kind: 'select',
      widthPx: 150,
      getValue: (row) => row.tipo_comparacion,
    },
    {
      key: 'tipo_parametro',
      label: this.t('parameters.column.type'),
      labelKey: 'parameters.column.type',
      kind: 'select',
      widthPx: 120,
      getValue: (row) => row.tipo_parametro,
    },
    {
      key: 'tipo_edificacion',
      label: this.t('parameters.column.buildingType'),
      labelKey: 'parameters.column.buildingType',
      kind: 'text',
      widthPx: 160,
      getValue: (row) => row.tipo_edificacion ?? '',
    },
    {
      key: 'unidad',
      label: this.t('parameters.column.unit'),
      labelKey: 'parameters.column.unit',
      kind: 'text',
      widthPx: 110,
      getValue: (row) => row.unidad ?? '',
    },
    {
      key: 'minimo',
      label: this.t('parameters.column.min'),
      labelKey: 'parameters.column.min',
      kind: 'number',
      widthPx: 110,
      getValue: (row) => row.minimo,
    },
    {
      key: 'maximo',
      label: this.t('parameters.column.max'),
      labelKey: 'parameters.column.max',
      kind: 'number',
      widthPx: 110,
      getValue: (row) => row.maximo,
    },
    {
      key: 'promedio',
      label: this.t('parameters.column.average'),
      labelKey: 'parameters.column.average',
      kind: 'number',
      widthPx: 110,
      getValue: (row) => row.promedio,
    },
  ];
  private readonly parameterTableDefaults = createDefaultTableViewPreferences(
    this.parameterTableColumns.map((column) => ({
      key: column.key,
      hiddenByDefault: column.hiddenByDefault,
    })),
  );
  private readonly parameterTableStorageKeyBase = 'parameters-panel';
  parameterTablePreferences: TableViewPreferences = loadTableViewPreferences(
    this.parameterTableStorageKey,
    this.parameterTableDefaults,
  );
  parameterColumnChooserLeft = 0;
  parameterColumnChooserTop = 0;

  selectedParameterType: TipoParametroOrm = 'cantidad';
  selectedBuildingType = 'all';
  selectedParameterIds = new Set<number>();
  workParameters: ParametroB5DOrm[] = [];
  selectedParameterCatalogId: number | null = null;
  creatingParameterCatalogVisible = false;
  creatingParameterCatalogName = '';
  creatingParameterCatalogDescription = '';
  parameterCatalogActionInProgress = false;
  creatingParameterInline = false;
  creatingAnchorParameterId: number | null = null;
  creatingDraft: ParameterDraftRow = this.getEmptyDraft();
  creatingInProgress = false;
  deletingInProgress = false;
  actionError = '';

  selectedQuantificationId: number | null = null;
  selectedSheetIndex = 0;
  parameterListZoomPercent = 100;
  descriptionMatchesZoomPercent = 100;
  analysisZoomPercent = 100;
  boqSheets: WorkbookSummarySheetOrm[] = [];
  boqRows: BoqExtractedRow[] = [];
  boqLoading = false;
  boqError = '';
  savingParameterActiveById = new Set<number>();
  descriptionSelectionByParameterId = new Map<number, Set<string>>();
  costConceptSelectionByParameterId = new Map<number, number>();
  selectedCostCatalogId: number | null = null;
  parameterListVisible = true;
  descriptionMatchesVisible = true;
  analysisVisible = true;
  paneOrder: ParameterPaneId[] = ['parameter-list', 'description-matches', 'analysis'];
  topLeftPaneWidth = 540;
  bottomLeftPaneWidth = 420;
  topWorkspaceHeight = 390;
  parameterTableContextMenuVisible = false;
  parameterTableContextMenuX = 0;
  parameterTableContextMenuY = 0;
  parameterTableRefreshToken = 0;
  draggedPaneId: ParameterPaneId | null = null;
  private lastAppliedStorageScopeKey = '';
  private parameterColumnChooserPositionReady = false;
  parameterColumnDragKey: string | null = null;
  private readonly parameterColumnChooserWidth = 360;
  private readonly backendProyectos = inject(BackendProyectosService);
  private readonly workbookPreviewCache = inject(WorkbookPreviewCacheService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['storageScopeKey'] || !this.lastAppliedStorageScopeKey) {
      this.restoreParameterTablePreferences();
    }

    if (changes['parameters']) {
      this.workParameters = this.parameters.map((parameterRow) => ({ ...parameterRow }));
      this.selectedParameterIds = new Set(
        [...this.selectedParameterIds].filter((parameterId) => this.workParameters.some((row) => row.id === parameterId)),
      );
      this.synchronizeDescriptionSelections();
      this.synchronizeCostSelections();
      this.syncParameterTablePreferences();
      this.emitToolbarState();
    }

    if (changes['activeCatalogId'] || changes['concepts']) {
      this.syncCostCatalogSelection();
      this.synchronizeCostSelections();
      this.emitToolbarState();
    }

    if (changes['catalogs']) {
      this.syncCostCatalogSelection();
      this.synchronizeCostSelections();
      this.emitToolbarState();
    }

    if (changes['activeParameterCatalogId']) {
      this.selectedParameterCatalogId = this.activeParameterCatalogId;
    }

    if (changes['parameterCatalogs']) {
      this.syncParameterCatalogSelection();
    }

    if (changes['quantifications']) {
      const workbookQuantifications = this.quantificationsWithWorkbook;
      if (
        this.selectedQuantificationId == null ||
        !workbookQuantifications.some((row) => row.id === this.selectedQuantificationId)
      ) {
        const withWorkbook = workbookQuantifications[0] ?? null;
        this.selectedQuantificationId = withWorkbook?.id ?? null;
      }
      void this.loadBoqExtractedRows();
    }

    if (changes['activeProject']) {
      this.selectedQuantificationId = null;
      void this.loadBoqExtractedRows();
    }
  }

  get workspaceTemplateRows(): string {
    if (this.topRowPaneIds.length && this.bottomRowPaneIds.length) {
      return `${this.topWorkspaceHeight}px 8px minmax(0, 1fr)`;
    }
    if (this.topRowPaneIds.length || this.bottomRowPaneIds.length) {
      return 'minmax(0, 1fr)';
    }
    return '0px';
  }

  get workspaceTemplateColumns(): string {
    if (this.showTopVerticalSplitter || this.showBottomVerticalSplitter) {
      return `${this.topLeftPaneWidth}px 8px minmax(0, 1fr)`;
    }
    return 'minmax(0, 1fr)';
  }

  get orderedVisiblePaneIds(): ParameterPaneId[] {
    return this.paneOrder.filter((paneId) => this.isPaneVisible(paneId));
  }

  get topRowPaneIds(): ParameterPaneId[] {
    return this.orderedVisiblePaneIds.slice(0, 1);
  }

  get bottomRowPaneIds(): ParameterPaneId[] {
    return this.orderedVisiblePaneIds.slice(1, 4);
  }

  get showTopVerticalSplitter(): boolean {
    return this.topRowPaneIds.length === 2;
  }

  get showHorizontalSplitter(): boolean {
    return this.topRowPaneIds.length > 0 && this.bottomRowPaneIds.length > 0;
  }

  get showBottomVerticalSplitter(): boolean {
    return this.bottomRowPaneIds.length === 2;
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
    const filteredByToolbar = this.workParameters.filter((row) => {
      if (row.tipo_parametro !== this.selectedParameterType) return false;
      if (this.selectedBuildingType !== 'all' && (row.tipo_edificacion ?? '') !== this.selectedBuildingType) return false;
      return true;
    });
    return applyTableFilters(filteredByToolbar, this.parameterTableColumns, this.parameterTablePreferences);
  }

  get visibleParameterColumns(): TableColumnDefinition<ParametroB5DOrm>[] {
    return getVisibleColumns(this.parameterTableColumns, this.parameterTablePreferences);
  }

  get activeParametersForAnalysis(): ParametroB5DOrm[] {
    return this.visibleRows.filter((row) => row.activo);
  }

  get activeConceptsForAnalysis(): ConceptoB5DOrm[] {
    if (this.activeCatalogId == null) return this.concepts;
    return this.concepts.filter((row) => row.catalogo_id === this.activeCatalogId);
  }

  get availableCostCatalogs(): CatalogoB5DOrm[] {
    if (this.catalogs.length) return this.catalogs;

    const seenCatalogIds = new Set<number>();
    const fallbackCatalogs: CatalogoB5DOrm[] = [];
    for (const conceptRow of this.concepts) {
      const catalogId = conceptRow.catalogo_id;
      if (catalogId == null || seenCatalogIds.has(catalogId)) continue;
      seenCatalogIds.add(catalogId);
      fallbackCatalogs.push({
        id: catalogId,
        identificador_original: null,
        nombre: `${this.t('parameters.panel.catalogLabel')} ${catalogId}`,
        descripcion: null,
        grupo_cantidades_bim: null,
        propiedad_tipo_bim: null,
        catalogo_externo: null,
      });
    }
    return fallbackCatalogs;
  }

  get selectedCostCatalogLabel(): string {
    const selectedCatalog = this.availableCostCatalogs.find((catalog) => catalog.id === this.selectedCostCatalogId);
    return selectedCatalog?.nombre ?? selectedCatalog?.descripcion ?? this.t('parameters.catalog.costs');
  }

  get availableParameterCatalogs(): CatalogoParametroB5DOrm[] {
    return this.parameterCatalogs;
  }

  get selectedParameterCatalogLabel(): string {
    const selectedCatalog = this.availableParameterCatalogs.find((catalog) => catalog.id === this.selectedParameterCatalogId);
    return selectedCatalog?.nombre ?? this.t('parameters.panel.noParameterCatalogs');
  }

  private getCostConceptsForSelectedCatalog(): ConceptoB5DOrm[] {
    const selectedCatalogId = this.selectedCostCatalogId ?? this.activeCatalogId;
    if (selectedCatalogId == null) return this.concepts;
    return this.concepts.filter((row) => row.catalogo_id === selectedCatalogId);
  }

  get boqAnalysisRows(): BoqAnalysisRow[] {
    return this.boqRows.slice(0, 500).map((boqRow) => this.buildBoqAnalysisRow(boqRow));
  }

  get descriptionMatchCandidateGroups(): DescriptionMatchCandidateGroup[] {
    const groups: DescriptionMatchCandidateGroup[] = [];
    for (const parameterRow of this.activeParametersForAnalysis) {
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

  get costMatchCandidateGroups(): CostMatchCandidateGroup[] {
    const groups: CostMatchCandidateGroup[] = [];
    for (const parameterRow of this.activeParametersForAnalysis) {
      if (parameterRow.tipo_parametro !== 'costo') continue;
      const candidates = this.getCostCandidateConcepts(parameterRow);
      if (!candidates.length) continue;
      groups.push({
        parameterId: parameterRow.id,
        parameterCode: parameterRow.clave ?? '-',
        parameterDescription: parameterRow.descripcion ?? '-',
        candidates: candidates.map((conceptRow) => ({
          id: conceptRow.id,
          clave: conceptRow.clave ?? '-',
          descripcion: conceptRow.descripcion ?? '-',
          unidad: conceptRow.unidad ?? '-',
          precio_unitario: this.resolveConceptUnitCost(conceptRow),
        })),
      });
    }
    return groups;
  }

  get costPercentMatchCandidateGroups(): CostPercentMatchCandidateGroup[] {
    const groups: CostPercentMatchCandidateGroup[] = [];
    for (const parameterRow of this.activeParametersForAnalysis) {
      if (parameterRow.tipo_parametro !== 'costo_porcentaje') continue;
      const candidates = this.getCostCandidateConcepts(parameterRow);
      if (!candidates.length) continue;
      groups.push({
        parameterId: parameterRow.id,
        parameterCode: parameterRow.clave ?? '-',
        parameterDescription: parameterRow.descripcion ?? '-',
        candidates: candidates.map((conceptRow) => ({
          id: conceptRow.id,
          clave: conceptRow.clave ?? '-',
          descripcion: conceptRow.descripcion ?? '-',
          unidad: conceptRow.unidad ?? '-',
          porcentaje: this.resolveConceptPercentage(conceptRow),
        })),
      });
    }
    return groups;
  }

  get comparisonLabel(): string {
    if (this.selectedParameterType === 'cantidad') return this.t('parameters.filter.quantities');
    if (this.selectedParameterType === 'costo') return this.t('parameters.filter.costs');
    return this.t('parameters.parameter.costPercent');
  }

  get analysisPreviewLabel(): string {
    if (this.selectedParameterType === 'cantidad') return this.t('parameters.panel.previewQuantity');
    if (this.selectedParameterType === 'costo') return this.t('parameters.panel.previewCost');
    return this.t('parameters.panel.previewCostPercent');
  }

  get analysisEvaluatedLabel(): string {
    if (this.selectedParameterType === 'cantidad') return this.t('parameters.analysis.evaluatedQuantity');
    if (this.selectedParameterType === 'costo') return this.t('parameters.analysis.evaluatedCost');
    return this.t('parameters.analysis.evaluatedCostPercent');
  }

  get buildingLabel(): string {
    return this.selectedBuildingType === 'all' ? this.t('parameters.filter.allBuildings') : this.selectedBuildingType;
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

  toggleDescriptionMatchesVisible(): void {
    this.descriptionMatchesVisible = !this.descriptionMatchesVisible;
    this.emitToolbarState();
  }

  toggleAnalysisVisible(): void {
    this.analysisVisible = !this.analysisVisible;
    this.emitToolbarState();
  }

  startPaneDrag(paneId: ParameterPaneId, event: DragEvent): void {
    this.draggedPaneId = paneId;
    event.dataTransfer?.setData('text/plain', paneId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onPaneDragOver(targetPaneId: ParameterPaneId, event: DragEvent): void {
    event.preventDefault();
    const draggedPaneId = this.draggedPaneId;
    if (!draggedPaneId || draggedPaneId === targetPaneId) return;

    const targetElement = event.currentTarget as HTMLElement | null;
    const targetRect = targetElement?.getBoundingClientRect();
    const beforeTarget = targetRect ? event.clientY < targetRect.top + targetRect.height / 2 : true;

    const draggedIndex = this.paneOrder.indexOf(draggedPaneId);
    const targetIndex = this.paneOrder.indexOf(targetPaneId);
    if (draggedIndex < 0 || targetIndex < 0) return;

    const nextOrder = [...this.paneOrder];
    const [removedPaneId] = nextOrder.splice(draggedIndex, 1);
    const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    const insertIndex = beforeTarget ? adjustedTargetIndex : adjustedTargetIndex + 1;
    nextOrder.splice(this.clamp(insertIndex, 0, nextOrder.length), 0, removedPaneId);
    this.paneOrder = nextOrder;
    this.emitToolbarState();
  }

  endPaneDrag(): void {
    this.draggedPaneId = null;
  }

  // Returns the zero-based position of a visible pane in the current order.
  private getPaneVisibleIndex(paneId: ParameterPaneId): number {
    return this.orderedVisiblePaneIds.indexOf(paneId);
  }

  // Returns true when a pane is visible in the workspace.
  isPaneVisible(paneId: ParameterPaneId): boolean {
    if (paneId === 'parameter-list') return this.parameterListVisible;
    if (paneId === 'description-matches') {
      return (
        (this.descriptionMatchesVisible && this.descriptionMatchCandidateGroups.length > 0) ||
        this.costMatchCandidateGroups.length > 0 ||
        this.costPercentMatchCandidateGroups.length > 0
      );
    }
    return this.analysisVisible;
  }

  // Returns the grid row assigned to the pane.
  getPaneGridRow(paneId: ParameterPaneId): string {
    if (!this.showHorizontalSplitter) return '1';
    return this.getPaneVisibleIndex(paneId) < this.topRowPaneIds.length ? '1' : '3';
  }

  // Returns the grid column assigned to the pane.
  getPaneGridColumn(paneId: ParameterPaneId): string {
    const paneIndex = this.getPaneVisibleIndex(paneId);
    if (paneIndex === -1) return '1 / 4';
    if (!(this.showTopVerticalSplitter || this.showBottomVerticalSplitter)) return '1 / 2';

    const rowPaneIds = paneIndex < this.topRowPaneIds.length ? this.topRowPaneIds : this.bottomRowPaneIds;
    if (rowPaneIds.length === 1) return '1 / 4';
    return rowPaneIds[0] === paneId ? '1 / 2' : '3 / 4';
  }

  resetTableViews(): void {
    this.selectedParameterType = 'cantidad';
    this.selectedBuildingType = 'all';
    this.resetParameterTableViews();
    this.parameterListVisible = true;
    this.descriptionMatchesVisible = true;
    this.analysisVisible = true;
    this.paneOrder = ['parameter-list', 'description-matches', 'analysis'];
    this.topLeftPaneWidth = 540;
    this.bottomLeftPaneWidth = 420;
    this.topWorkspaceHeight = 390;
    this.emitToolbarState();
  }

  private ensureParameterColumnChooserPosition(): void {
    if (this.parameterColumnChooserPositionReady || typeof window === 'undefined') return;
    this.parameterColumnChooserLeft = Math.max(16, window.innerWidth - this.parameterColumnChooserWidth - 24);
    this.parameterColumnChooserTop = 120;
    this.parameterColumnChooserPositionReady = true;
  }

  toggleParameterTableChooser(): void {
    this.parameterTablePreferences.chooserOpen = !this.parameterTablePreferences.chooserOpen;
    if (this.parameterTablePreferences.chooserOpen) {
      this.ensureParameterColumnChooserPosition();
    }
    this.persistParameterTablePreferences();
  }

  closeParameterTableChooser(): void {
    if (!this.parameterTablePreferences.chooserOpen) return;
    this.parameterTablePreferences.chooserOpen = false;
    this.persistParameterTablePreferences();
  }

  openParameterTableContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.parameterTableContextMenuVisible = true;
    this.parameterTableContextMenuX = event.clientX;
    this.parameterTableContextMenuY = event.clientY;
  }

  closeParameterTableContextMenu(): void {
    this.parameterTableContextMenuVisible = false;
  }

  handleParameterTableContextMenuAction(action: 'chooser' | 'filters' | 'best-fit' | 'reset'): void {
    if (action === 'chooser') {
      this.toggleParameterTableChooser();
    } else if (action === 'filters') {
      this.toggleParameterFiltersVisible();
    } else if (action === 'best-fit') {
      this.resetParameterTableWidths();
    } else if (action === 'reset') {
      this.resetParameterTableViews();
    }
    this.closeParameterTableContextMenu();
  }

  isParameterTableColumnVisible(columnKey: string): boolean {
    return !this.parameterTablePreferences.hidden.includes(columnKey);
  }

  toggleParameterTableColumnVisibility(columnKey: string): void {
    toggleTableColumnVisibility(this.parameterTablePreferences, columnKey);
    this.persistParameterTablePreferences();
    this.parameterTableRefreshToken += 1;
  }

  startParameterColumnChooserDrag(event: PointerEvent): void {
    if (!this.parameterTablePreferences.chooserOpen) return;
    if (event.button !== 0 || typeof window === 'undefined') return;

    this.ensureParameterColumnChooserPosition();
    event.preventDefault();
    event.stopPropagation();

    const offsetX = event.clientX - this.parameterColumnChooserLeft;
    const offsetY = event.clientY - this.parameterColumnChooserTop;

    startPointerDrag(event, (moveEvent: PointerEvent) => {
      const maxLeft = Math.max(16, window.innerWidth - this.parameterColumnChooserWidth - 16);
      const maxTop = Math.max(76, window.innerHeight - 120);
      this.parameterColumnChooserLeft = this.clamp(moveEvent.clientX - offsetX, 16, maxLeft);
      this.parameterColumnChooserTop = this.clamp(moveEvent.clientY - offsetY, 76, maxTop);
      this.changeDetectorRef.detectChanges();
    });
  }

  onParameterColumnDragStart(columnKey: string, event: DragEvent): void {
    this.parameterColumnDragKey = columnKey;
    event.dataTransfer?.setData('text/plain', columnKey);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onParameterColumnDragOver(columnKey: string, event: DragEvent): void {
    event.preventDefault();
    const draggedColumnKey = this.parameterColumnDragKey;
    if (!draggedColumnKey || draggedColumnKey === columnKey) return;

    const targetElement = event.currentTarget as HTMLElement | null;
    const targetRect = targetElement?.getBoundingClientRect();
    const beforeTarget = targetRect ? event.clientY < targetRect.top + targetRect.height / 2 : true;
    const targetIndex = this.parameterTablePreferences.order.indexOf(columnKey);
    if (targetIndex < 0) return;

    const nextIndex = beforeTarget ? targetIndex : targetIndex + 1;
    moveTableColumn(this.parameterTablePreferences, draggedColumnKey, nextIndex);
    this.persistParameterTablePreferences();
    this.parameterTableRefreshToken += 1;
  }

  onParameterColumnDragEnd(): void {
    this.parameterColumnDragKey = null;
  }

  getParameterFilterModes(columnKey: string): ReturnType<typeof getFilterModesForKind> {
    const column = this.parameterTableColumns.find((columnItem) => columnItem.key === columnKey);
    return column ? getFilterModesForKind(column.kind) : getFilterModesForKind('text');
  }

  getParameterFilterMode(columnKey: string): string {
    return this.parameterTablePreferences.filters[columnKey]?.mode ?? 'contains';
  }

  getParameterFilterValue(columnKey: string): string {
    return this.parameterTablePreferences.filters[columnKey]?.value ?? '';
  }

  isParameterTableLastColumn(columnKey: string): boolean {
    return this.visibleParameterColumns.at(-1)?.key === columnKey;
  }

  setParameterFilterMode(columnKey: string, mode: string): void {
    setTableFilterMode(this.parameterTablePreferences, columnKey, mode as never);
    this.persistParameterTablePreferences();
  }

  setParameterFilterValue(columnKey: string, value: string): void {
    setTableFilterValue(this.parameterTablePreferences, columnKey, value);
    this.persistParameterTablePreferences();
  }

  resetParameterTablePreferences(): void {
    resetTableViewPreferences(this.parameterTablePreferences, this.parameterTableDefaults);
    this.persistParameterTablePreferences();
    this.parameterTableRefreshToken += 1;
  }

  toggleParameterFiltersVisible(): void {
    this.tableFiltersVisible = !this.tableFiltersVisible;
    this.emitToolbarState();
  }

  resetParameterTableWidths(): void {
    getSafeLocalStorage()?.removeItem(`b5d-resizable-table:${this.parameterTableResizableStorageKey}`);
    this.parameterTableRefreshToken += 1;
  }

  resetParameterTableViews(): void {
    this.resetParameterTablePreferences();
    this.resetParameterTableWidths();
    this.paneOrder = ['parameter-list', 'description-matches', 'analysis'];
    this.parameterListZoomPercent = 100;
    this.descriptionMatchesZoomPercent = 100;
    this.analysisZoomPercent = 100;
  }

  private syncCostCatalogSelection(): void {
    const availableCatalogIds = new Set(this.availableCostCatalogs.map((catalog) => catalog.id));
    if (this.selectedCostCatalogId != null && availableCatalogIds.has(this.selectedCostCatalogId)) {
      return;
    }

    if (this.activeCatalogId != null && availableCatalogIds.has(this.activeCatalogId)) {
      this.selectedCostCatalogId = this.activeCatalogId;
      return;
    }

    this.selectedCostCatalogId = this.availableCostCatalogs[0]?.id ?? null;
  }

  private syncParameterCatalogSelection(): void {
    const availableCatalogIds = new Set(this.availableParameterCatalogs.map((catalog) => catalog.id));
    if (this.activeParameterCatalogId != null && availableCatalogIds.has(this.activeParameterCatalogId)) {
      this.selectedParameterCatalogId = this.activeParameterCatalogId;
      return;
    }

    if (this.selectedParameterCatalogId != null && availableCatalogIds.has(this.selectedParameterCatalogId)) {
      return;
    }

    this.selectedParameterCatalogId = this.availableParameterCatalogs[0]?.id ?? null;
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
        const nextWidth = this.clamp(initialTopWidth + widthDelta, 320, 1200);
        this.topLeftPaneWidth = nextWidth;
        this.bottomLeftPaneWidth = nextWidth;
      } else if (target === 'bottom-vertical') {
        const nextWidth = this.clamp(initialBottomWidth + widthDelta, 320, 1200);
        this.topLeftPaneWidth = nextWidth;
        this.bottomLeftPaneWidth = nextWidth;
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

    const selectedParameter = this.workParameters.find((row) => row.id === parameterId);
    const conceptKey = selectedParameter?.clave?.trim() ?? '';
    if (conceptKey && this.isKnownConceptKey(conceptKey)) {
      this.conceptSelectionRequested.emit(conceptKey);
    }

    this.emitToolbarState();
  }

  isSelectedRow(parameterId: number): boolean {
    return this.selectedParameterIds.has(parameterId);
  }

  onFilterChange(): void {
    this.emitToolbarState();
  }

  toggleParameterCatalogCreate(): void {
    if (this.parameterCatalogActionInProgress) return;
    if (this.creatingParameterCatalogVisible) {
      this.cancelParameterCatalogCreate();
      return;
    }
    this.creatingParameterCatalogVisible = !this.creatingParameterCatalogVisible;
    this.creatingParameterCatalogName = '';
    this.creatingParameterCatalogDescription = '';
    this.actionError = '';
  }

  cancelParameterCatalogCreate(): void {
    this.creatingParameterCatalogVisible = false;
    this.creatingParameterCatalogName = '';
    this.creatingParameterCatalogDescription = '';
    this.actionError = '';
  }

  async saveParameterCatalogCreate(): Promise<void> {
    if (!this.activeProject || this.parameterCatalogActionInProgress) return;
    const nombre = this.creatingParameterCatalogName.trim();
    if (!nombre) {
      this.actionError = this.t('parameters.catalog.errorName');
      return;
    }

    this.parameterCatalogActionInProgress = true;
    this.actionError = '';
    try {
      const response = await firstValueFrom(
        this.backendProyectos.crearCatalogoParametro(this.activeProject.id, {
          nombre,
          descripcion: this.creatingParameterCatalogDescription.trim() || undefined,
        }),
      );
      this.selectedParameterCatalogId = response.catalogo_parametro_activo_id ?? response.catalogo?.id ?? null;
      this.creatingParameterCatalogVisible = false;
      this.creatingParameterCatalogName = '';
      this.creatingParameterCatalogDescription = '';
      this.parameterCatalogChanged.emit();
    } catch (error) {
      this.actionError = this.resolveErrorMessage(error, this.t('parameters.catalog.errorCreate'));
    } finally {
      this.parameterCatalogActionInProgress = false;
    }
  }

  async onParameterCatalogChange(catalogId: number | null): Promise<void> {
    this.selectedParameterCatalogId = catalogId;
    if (!this.activeProject || catalogId == null) return;
    if (catalogId === this.activeParameterCatalogId) return;

    this.parameterCatalogActionInProgress = true;
    this.actionError = '';
    try {
      const response = await firstValueFrom(
        this.backendProyectos.seleccionarCatalogoParametro(this.activeProject.id, catalogId),
      );
      this.selectedParameterCatalogId = response.catalogo_parametro_activo_id ?? catalogId;
      this.parameterCatalogChanged.emit();
    } catch (error) {
      this.selectedParameterCatalogId = this.activeParameterCatalogId;
      this.actionError = this.resolveErrorMessage(error, this.t('parameters.catalog.errorSelect'));
    } finally {
      this.parameterCatalogActionInProgress = false;
    }
  }

  onCostCatalogChange(catalogId: number | null): void {
    this.selectedCostCatalogId = catalogId;
    this.synchronizeCostSelections();
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
      this.actionError = this.resolveErrorMessage(error, this.t('parameters.error.updateState'));
    } finally {
      this.savingParameterActiveById.delete(parameterRow.id);
    }
  }

  isSavingParameterActive(parameterId: number): boolean {
    return this.savingParameterActiveById.has(parameterId);
  }

  async saveParameterRow(parameterRow: ParametroB5DOrm): Promise<void> {
    if (!this.activeProject) return;
    if (this.savingParameterActiveById.has(parameterRow.id)) return;
    this.actionError = '';
    this.savingParameterActiveById.add(parameterRow.id);

    try {
      const updated = await firstValueFrom(
        this.backendProyectos.actualizarParametro(this.activeProject.id, parameterRow.id, {
          clave: parameterRow.clave ?? null,
          descripcion: parameterRow.descripcion ?? null,
          tipo_comparacion: parameterRow.tipo_comparacion,
          tipo_parametro: parameterRow.tipo_parametro,
          tipo_edificacion: parameterRow.tipo_edificacion ?? null,
          unidad: parameterRow.unidad ?? null,
          minimo: parameterRow.minimo,
          maximo: parameterRow.maximo,
          promedio: parameterRow.promedio,
          activo: parameterRow.activo,
        }),
      );
      this.workParameters = this.workParameters.map((row) => (row.id === updated.id ? { ...updated } : row));
      this.rowsChange.emit(this.workParameters.map((row) => ({ ...row })));
      this.synchronizeDescriptionSelections();
      this.emitToolbarState();
    } catch (error) {
      this.actionError = this.resolveErrorMessage(error, this.t('parameters.error.update'));
    } finally {
      this.savingParameterActiveById.delete(parameterRow.id);
    }
  }

  parseOptionalNumber(value: unknown): number | null {
    if (value == null) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    const numericValue = Number(normalized.replace(',', '.'));
    return Number.isFinite(numericValue) ? numericValue : null;
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

  isCostConceptSelected(parameterId: number, conceptId: number): boolean {
    return this.costConceptSelectionByParameterId.get(parameterId) === conceptId;
  }

  onCostConceptToggle(parameterId: number, conceptId: number): void {
    this.costConceptSelectionByParameterId.set(parameterId, conceptId);
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
      this.actionError = this.resolveErrorMessage(error, this.t('parameters.error.create'));
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
      this.actionError = this.resolveErrorMessage(error, this.t('parameters.error.deleteSelected'));
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
    await this.loadBoqExtractedRows();
  }

  async selectBoqSheet(sheetIndex: number): Promise<void> {
    this.selectedSheetIndex = sheetIndex;
    await this.loadBoqExtractedRows();
  }

  onBoqPreviewCellSelected(event: {
    value: string | number | boolean | null;
    address: string;
    formula: string;
    row: number | null;
    col: number | null;
    cellClassName: string;
    cellInlineStyle: string;
    computedBackgroundColor: string;
    computedColor: string;
    computedTextAlign: string;
    computedFontWeight: string;
  }): void {
    const conceptKey = String(event.value ?? '').trim();
    if (!conceptKey || !this.isKnownConceptKey(conceptKey)) return;
    this.conceptSelectionRequested.emit(conceptKey);
  }

  // Returns the zoom factor used by any pane in the parameters workspace.
  getPaneZoomFactor(paneId: ParameterPaneId): number {
    return this.clamp(this.getPaneZoomPercent(paneId), 20, 300) / 100;
  }

  // Increases the zoom level for a specific pane.
  increasePaneZoom(paneId: ParameterPaneId): void {
    this.setPaneZoomPercent(paneId, this.getPaneZoomPercent(paneId) + 10);
  }

  // Decreases the zoom level for a specific pane.
  decreasePaneZoom(paneId: ParameterPaneId): void {
    this.setPaneZoomPercent(paneId, this.getPaneZoomPercent(paneId) - 10);
  }

  // Restores the zoom level for a specific pane.
  resetPaneZoom(paneId: ParameterPaneId): void {
    this.setPaneZoomPercent(paneId, 100);
  }

  // Applies mouse-wheel zoom requests when the pointer is over a pane.
  onPaneZoomWheel(event: WheelEvent, paneId: ParameterPaneId): void {
    handlePanelZoomWheel(
      event,
      () => this.increasePaneZoom(paneId),
      () => this.decreasePaneZoom(paneId),
    );
  }

  private getPaneZoomPercent(paneId: ParameterPaneId): number {
    if (paneId === 'parameter-list') return this.parameterListZoomPercent;
    if (paneId === 'description-matches') return this.descriptionMatchesZoomPercent;
    return this.analysisZoomPercent;
  }

  private setPaneZoomPercent(paneId: ParameterPaneId, zoomPercent: number): void {
    const nextZoomPercent = this.clamp(zoomPercent, 20, 300);
    if (paneId === 'parameter-list') {
      this.parameterListZoomPercent = nextZoomPercent;
      return;
    }
    if (paneId === 'description-matches') {
      this.descriptionMatchesZoomPercent = nextZoomPercent;
      return;
    }
    this.analysisZoomPercent = nextZoomPercent;
  }

  resolveAverage(row: ParametroB5DOrm): number | null {
    if (row.promedio != null) return row.promedio;
    if (row.minimo == null || row.maximo == null) return null;
    return (row.minimo + row.maximo) / 2;
  }

  resolveComparisonLabel(value: ParametroB5DOrm['tipo_comparacion']): string {
    if (value === 'clave_exacta') return this.t('parameters.comparison.exactCode');
    if (value === 'clave_parcial') return this.t('parameters.comparison.partialCode');
    return this.t('parameters.comparison.partialDescription');
  }

  formatValue(value: number | null): string {
    const numericValue = this.parseNumericLikeValue(value);
    if (numericValue == null) return '-';
    return numericValue.toLocaleString('es-MX', { maximumFractionDigits: 4 });
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
      selectedCatalogId: this.activeCatalogId,
      parametersTotal: this.visibleRows.length,
      selectedParameterIds: [...this.selectedParameterIds],
      parameterListVisible: this.parameterListVisible,
      parameterDescriptionMatchesVisible: this.descriptionMatchesVisible,
      parameterAnalysisVisible: this.analysisVisible,
      tableFiltersVisible: this.tableFiltersVisible,
    });
  }

  private syncParameterTablePreferences(): void {
    ensureTablePreferencesColumns(this.parameterTablePreferences, this.parameterTableColumns);
    this.persistParameterTablePreferences();
  }

  private restoreParameterTablePreferences(): void {
    const storageKey = this.parameterTableStorageKey;
    if (storageKey === this.lastAppliedStorageScopeKey) return;

    this.lastAppliedStorageScopeKey = storageKey;
    this.parameterTablePreferences = loadTableViewPreferences(storageKey, this.parameterTableDefaults);
    ensureTablePreferencesColumns(this.parameterTablePreferences, this.parameterTableColumns);
  }

  private persistParameterTablePreferences(): void {
    saveTableViewPreferences(this.parameterTableStorageKey, this.parameterTablePreferences);
  }

  get parameterTableResizableStorageKey(): string {
    return this.parameterTableStorageKey;
  }

  get parameterBoqAnalysisResizableStorageKey(): string {
    return buildScopedStorageKey('parameters-boq-analysis', this.storageScopeKey);
  }

  private get parameterTableStorageKey(): string {
    return buildScopedStorageKey(this.parameterTableStorageKeyBase, this.storageScopeKey);
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

  private isKnownConceptKey(conceptKey: string): boolean {
    const normalizedConceptKey = conceptKey.trim().toLowerCase();
    if (!normalizedConceptKey) return false;
    return this.conceptKeys.some((candidateKey) => candidateKey.trim().toLowerCase() === normalizedConceptKey);
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
    const selectedQuantification = this.quantificationsWithWorkbook.find((row) => row.id === this.selectedQuantificationId) ?? null;
    if (!projectId || !selectedQuantification) {
      this.boqSheets = [];
      this.boqRows = [];
      return;
    }

    this.boqLoading = true;
    this.boqError = '';
    try {
      const summary = await this.workbookPreviewCache.getWorkbookSummary(projectId, selectedQuantification.id);
      this.boqSheets = summary.sheets;
      if (!this.boqSheets.some((sheet) => sheet.index === this.selectedSheetIndex)) {
        this.selectedSheetIndex = this.boqSheets[0]?.index ?? 0;
      }

      const layers = await this.workbookPreviewCache.getWorkbookSheetLayers(
        projectId,
        selectedQuantification.id,
        this.selectedSheetIndex,
      );
      this.boqRows = this.extractBoqRows(layers.cells);
      this.synchronizeDescriptionSelections();
      this.synchronizeCostSelections();
    } catch (error) {
      this.boqRows = [];
      this.boqError = this.resolveErrorMessage(error, this.t('parameters.error.extractBoq'));
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
        evaluatedText: '-',
        rangeText: '-',
        deltaText: '-',
        resultText: this.t('parameters.analysis.noParameter'),
        resultKind: 'none',
      };
    }

    if (isCostParameterType(matchedParameter.tipo_parametro)) {
      return this.buildCostAnalysisRow(boqRow, matchedParameter);
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
        evaluatedText: '-',
        rangeText,
        deltaText: '-',
        resultText: this.t('parameters.analysis.noQuantity'),
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
        evaluatedText: '-',
        rangeText,
        deltaText: '-',
        resultText: this.t('parameters.analysis.incompatibleUnit'),
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
        evaluatedText: `${this.formatValue(convertedValue)} ${unitLabel}`,
        rangeText,
        deltaText,
        resultText: this.t('parameters.analysis.outOfRange'),
        resultKind: 'error',
      };
    }

    return {
      ...boqRow,
      matchedParameterCode: matchedParameter.clave ?? '-',
      matchedParameterDescription: matchedParameter.descripcion ?? '-',
      matchedParameterUnit: matchedParameter.unidad ?? '-',
      evaluatedText: `${this.formatValue(convertedValue)} ${unitLabel}`,
      rangeText,
      deltaText: '+0',
      resultText: this.t('parameters.analysis.inRange'),
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

  private buildCostAnalysisRow(boqRow: BoqExtractedRow, matchedParameter: ParametroB5DOrm): BoqAnalysisRow {
    const rangeMin = matchedParameter.minimo;
    const rangeMax = matchedParameter.maximo;
    const rangeText = `${this.formatValue(rangeMin)} - ${this.formatValue(rangeMax)}`;
    const matchedConcept = this.resolveCostConceptForParameter(matchedParameter, boqRow);
    if (!matchedConcept) {
      return {
        ...boqRow,
        matchedParameterCode: matchedParameter.clave ?? '-',
        matchedParameterDescription: matchedParameter.descripcion ?? '-',
        matchedParameterUnit: matchedParameter.unidad ?? '-',
        evaluatedText: '-',
        rangeText,
        deltaText: '-',
        resultText: this.t('parameters.analysis.noCostConcept'),
        resultKind: 'warning',
      };
    }

    if (matchedParameter.tipo_parametro === 'costo_porcentaje') {
      const conceptPercentage = this.resolveConceptPercentage(matchedConcept);
      if (conceptPercentage == null) {
        return {
          ...boqRow,
          matchedParameterCode: matchedParameter.clave ?? '-',
          matchedParameterDescription: matchedParameter.descripcion ?? '-',
          matchedParameterUnit: matchedParameter.unidad ?? '-',
          evaluatedText: '-',
          rangeText,
          deltaText: '-',
          resultText: this.t('parameters.analysis.noSelectedCatalogCost'),
          resultKind: 'warning',
        };
      }

      const delta = this.computeRangeDelta(conceptPercentage, rangeMin, rangeMax);
      const unitLabel = matchedParameter.unidad?.trim() || '%';
      const evaluatedText = `${this.formatValue(conceptPercentage)} ${unitLabel}`;
      const deltaText = `${delta >= 0 ? '+' : ''}${this.formatValue(delta)} ${unitLabel}`;

      if (delta !== 0) {
        return {
          ...boqRow,
          matchedParameterCode: matchedParameter.clave ?? '-',
          matchedParameterDescription: matchedParameter.descripcion ?? '-',
          matchedParameterUnit: matchedParameter.unidad ?? '-',
          evaluatedText,
          rangeText,
          deltaText,
          resultText: this.t('parameters.analysis.outOfRange'),
          resultKind: 'error',
        };
      }

      return {
        ...boqRow,
        matchedParameterCode: matchedParameter.clave ?? '-',
        matchedParameterDescription: matchedParameter.descripcion ?? '-',
        matchedParameterUnit: matchedParameter.unidad ?? '-',
        evaluatedText,
        rangeText,
        deltaText: '+0',
        resultText: this.t('parameters.analysis.inRange'),
        resultKind: 'ok',
      };
    }

    const unitCost = this.resolveConceptUnitCost(matchedConcept);
    if (unitCost == null) {
      return {
        ...boqRow,
        matchedParameterCode: matchedParameter.clave ?? '-',
        matchedParameterDescription: matchedParameter.descripcion ?? '-',
        matchedParameterUnit: matchedParameter.unidad ?? '-',
        evaluatedText: '-',
        rangeText,
        deltaText: '-',
        resultText: this.t('parameters.analysis.noSelectedCatalogCost'),
        resultKind: 'warning',
      };
    }

    const delta = this.computeRangeDelta(unitCost, rangeMin, rangeMax);
    const unitLabel = matchedParameter.unidad?.trim() || 'u';
    const evaluatedText = `${this.formatValue(unitCost)} ${unitLabel}`;
    const deltaText = `${delta >= 0 ? '+' : ''}${this.formatValue(delta)} ${unitLabel}`;
    if (delta !== 0) {
      return {
        ...boqRow,
        matchedParameterCode: matchedParameter.clave ?? '-',
        matchedParameterDescription: matchedParameter.descripcion ?? '-',
        matchedParameterUnit: matchedParameter.unidad ?? '-',
        evaluatedText,
        rangeText,
        deltaText,
        resultText: this.t('parameters.analysis.outOfRange'),
        resultKind: 'error',
      };
    }

    return {
      ...boqRow,
      matchedParameterCode: matchedParameter.clave ?? '-',
      matchedParameterDescription: matchedParameter.descripcion ?? '-',
      matchedParameterUnit: matchedParameter.unidad ?? '-',
      evaluatedText,
      rangeText,
      deltaText: '+0',
      resultText: this.t('parameters.analysis.inRange'),
      resultKind: 'ok',
    };
  }

  private resolveConceptPercentage(concept: ConceptoB5DOrm): number | null {
    return this.parseNumericLikeValue(concept.porcentaje_padre ?? null);
  }

  private findMatchingConcept(boqRow: BoqExtractedRow, concepts: ConceptoB5DOrm[] = this.activeConceptsForAnalysis): ConceptoB5DOrm | null {
    const boqCode = this.normalizeText(boqRow.clave);
    const boqDescription = this.normalizeText(boqRow.descripcion);

    const exactMatches: ConceptoB5DOrm[] = [];
    const partialCodeMatches: ConceptoB5DOrm[] = [];
    const partialDescriptionMatches: ConceptoB5DOrm[] = [];

    for (const conceptRow of concepts) {
      const code = this.normalizeText(conceptRow.clave ?? '');
      const description = this.normalizeText(conceptRow.descripcion ?? '');
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

  private resolveCostConceptForParameter(matchedParameter: ParametroB5DOrm, boqRow: BoqExtractedRow): ConceptoB5DOrm | null {
    const selectedConceptId = this.costConceptSelectionByParameterId.get(matchedParameter.id);
    if (selectedConceptId != null) {
      const selectedConcept = this.getCostConceptsForSelectedCatalog().find((conceptRow) => conceptRow.id === selectedConceptId) ?? null;
      if (selectedConcept) return selectedConcept;
    }

    const selectedCatalogConcepts = this.getCostConceptsForSelectedCatalog();
    const matchedConcept = this.findMatchingConcept(boqRow, selectedCatalogConcepts);
    if (matchedConcept) return matchedConcept;

    const candidates = this.getCostCandidateConcepts(matchedParameter);
    const conceptWithCost = candidates.find((conceptRow) => this.resolveConceptUnitCost(conceptRow) != null);
    if (conceptWithCost) return conceptWithCost;

    return candidates[0] ?? null;
  }

  private getCostCandidateConcepts(parameterRow: ParametroB5DOrm): ConceptoB5DOrm[] {
    const boqCode = this.normalizeText(parameterRow.clave ?? '');
    const boqDescription = this.normalizeText(parameterRow.descripcion ?? '');
    const exactMatches: ConceptoB5DOrm[] = [];
    const partialCodeMatches: ConceptoB5DOrm[] = [];
    const partialDescriptionMatches: ConceptoB5DOrm[] = [];

    for (const conceptRow of this.getCostConceptsForSelectedCatalog()) {
      const code = this.normalizeText(conceptRow.clave ?? '');
      const description = this.normalizeText(conceptRow.descripcion ?? '');
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

  private resolveConceptUnitCost(concept: ConceptoB5DOrm): number | null {
    return this.parseNumericLikeValue(concept.importe);
  }

  private parseNumericLikeValue(value: unknown): number | null {
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
      .replace(/_x000d_/gi, ' ')
      .replace(/\r\n?|\n/g, ' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private stringValue(value: unknown): string {
    if (value == null) return '';
    return String(value)
      .replace(/_x000d_/gi, ' ')
      .replace(/\r\n?|\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildBoqRowKey(boqRow: BoqExtractedRow): string {
    return `${boqRow.row}|${this.normalizeText(boqRow.clave)}|${this.normalizeText(boqRow.descripcion)}`;
  }

  private synchronizeDescriptionSelections(): void {
    const nextSelectionMap = new Map<number, Set<string>>();
    for (const parameterRow of this.activeParametersForAnalysis) {
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

  private synchronizeCostSelections(): void {
    const nextSelectionMap = new Map<number, number>();
    for (const parameterRow of this.activeParametersForAnalysis) {
      if (parameterRow.tipo_parametro !== 'costo') continue;
      const candidateConcepts = this.getCostCandidateConcepts(parameterRow);
      if (!candidateConcepts.length) continue;

      const previousSelection = this.costConceptSelectionByParameterId.get(parameterRow.id);
      const selectedConcept =
        (previousSelection != null &&
          candidateConcepts.find((conceptRow) => conceptRow.id === previousSelection)) ??
        candidateConcepts.find((conceptRow) => this.resolveConceptUnitCost(conceptRow) != null) ??
        candidateConcepts[0];
      if (selectedConcept) {
        nextSelectionMap.set(parameterRow.id, selectedConcept.id);
      }
    }
    this.costConceptSelectionByParameterId = nextSelectionMap;
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
