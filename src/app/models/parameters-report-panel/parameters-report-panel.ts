import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkbookPreviewCacheService } from '../../services/workbook-preview-cache.service';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';
import { buildScopedStorageKey, readStoredJson, writeStoredJson } from '../../utils/ui-state-storage';
import type {
  CatalogoB5DOrm,
  ConceptoB5DOrm,
  CuantificacionB5DOrm,
  ParametroB5DOrm,
  ProyectoTrabajoOrm,
  WorkbookSummarySheetOrm,
} from '../../types/b5d-orm';
import {
  buildBoqComparisonReportData,
  buildCatalogWbsIndex,
  buildParametersReportData,
  extractBoqRows,
  getReportConceptKey,
  type ReportComparisonGranularity,
  type ReportParameterScope,
  type BoqExtractedRow,
  type BoqComparisonReportData,
  type BoqComparisonRow,
  type ParametersReportData,
} from '../../utils/parameters/parameters-report-analysis';
import { isCostParameterType } from '../../utils/parameters/parameter-types';
import { PARAMETERS_REPORT_PANEL_TRANSLATIONS } from './parameters-report-panel.translations';

type ReportMode = 'parameters' | 'boq-comparison';

type WbsReferenceOption = {
  label: string;
  level: number;
  matches: number;
};

type WbsManualConceptOption = {
  id: number;
  label: string;
  level: number;
};

type ReportPanelStoredState = {
  selectedReportMode?: ReportMode;
  selectedComparisonGranularity?: ReportComparisonGranularity;
  selectedParameterScope?: ReportParameterScope;
  selectedDecimalPlaces?: number;
  selectedWbsLevel?: number;
  selectedQuantificationId?: number | null;
  selectedSheetIndex?: number;
  selectedCatalogId?: number | null;
  selectedBuildingType?: string;
  selectedWorkType?: string;
  selectedZone?: string;
  selectedComparatorQuantificationIds?: number[];
  manualWbsConceptSelectionByParameterId?: Record<string, number>;
  manualParameterSelectionByConceptKey?: Record<string, number>;
};

type LoadedBoqSheet = {
  sheets: WorkbookSummarySheetOrm[];
  sheetIndex: number;
  sheetName: string;
  rows: BoqExtractedRow[];
};

@Component({
  selector: 'app-parameters-report-panel',
  imports: [CommonModule, FormsModule],
  templateUrl: './parameters-report-panel.html',
  styleUrl: './parameters-report-panel.scss',
})
export class ParametersReportPanel implements OnChanges {
  readonly parametersReportPanelTranslations = PARAMETERS_REPORT_PANEL_TRANSLATIONS;
  readonly globalTranslations = GLOBAL_TRANSLATIONS;
  readonly i18n = inject(I18nService);

  private t(key: string): string {
    return this.i18n.translateForComponent(this.parametersReportPanelTranslations, key);
  }

  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Input() parameters: ParametroB5DOrm[] = [];
  @Input() concepts: ConceptoB5DOrm[] = [];
  @Input() catalogs: CatalogoB5DOrm[] = [];
  @Input() activeCatalogId: number | null = null;
  @Input() b5dLoading = false;
  @Input() quantifications: CuantificacionB5DOrm[] = [];
  @Input() storageScopeKey = 'anonymous';

  workQuantifications: CuantificacionB5DOrm[] = [];
  selectedReportMode: ReportMode = 'parameters';
  selectedComparisonGranularity: ReportComparisonGranularity = 'individual';
  selectedParameterScope: ReportParameterScope = 'all';
  selectedDecimalPlaces = 2;
  selectedWbsLevel = 1;
  selectedQuantificationId: number | null = null;
  selectedSheetIndex = 0;
  selectedCatalogId: number | null = null;
  selectedBuildingType = 'all';
  selectedWorkType = 'all';
  selectedZone = 'all';
  selectedComparatorQuantificationIds: number[] = [];
  manualWbsConceptSelectionByParameterId = new Map<number, number>();
  manualParameterSelectionByConceptKey = new Map<string, number>();
  manualParameterSearchByConceptKey = new Map<string, string>();
  boqSheets: WorkbookSummarySheetOrm[] = [];
  boqRows: BoqExtractedRow[] = [];
  reportData: ParametersReportData = this.createEmptyReportData();
  boqComparisonData: BoqComparisonReportData = this.createEmptyBoqComparisonData();
  loading = false;
  error = '';
  reportRefreshToken = 0;

  private readonly workbookPreviewCache = inject(WorkbookPreviewCacheService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private loadToken = 0;
  private lastAppliedStorageScopeKey = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['storageScopeKey'] || changes['activeProject'] || !this.lastAppliedStorageScopeKey) {
      this.restoreReportPreferences();
    }

    if (changes['quantifications']) {
      this.workQuantifications = this.quantifications.map((row) => ({ ...row }));
      const quantificationIds = new Set(this.workQuantifications.map((row) => row.id));
      if (this.selectedQuantificationId != null && quantificationIds.has(this.selectedQuantificationId)) {
        // Keeps the current selection.
      } else {
        const withWorkbook = this.workQuantifications.find((row) => row.tiene_libro_excel);
        this.selectedQuantificationId = withWorkbook?.id ?? null;
        this.selectedSheetIndex = 0;
      }
      this.syncSelectedComparators();
      void this.loadReportWorkbook();
    }

    if (changes['activeProject']) {
      void this.loadReportWorkbook();
    }

    const dataInputsChanged = !!(changes['parameters'] || changes['concepts'] || changes['catalogs'] || changes['activeCatalogId']);
    const reportDataReady = !this.b5dLoading && (dataInputsChanged || !!changes['b5dLoading']);
    if (reportDataReady && (changes['b5dLoading'] || dataInputsChanged)) {
      this.syncSelectedCatalog();
      this.syncSelectedWbsLevel();
      this.syncManualWbsSelections();
      this.syncManualParameterSelections();
      this.rebuildReportData();
    }
  }

  get reportStorageKey(): string {
    return buildScopedStorageKey('parameters-report-panel', `${this.storageScopeKey}:${this.activeProject?.id ?? 'no-project'}`);
  }

  get quantificationsWithWorkbook(): CuantificacionB5DOrm[] {
    return this.workQuantifications.filter((row) => row.tiene_libro_excel);
  }

  get selectedQuantificationLabel(): string {
    const selectedQuantification = this.quantificationsWithWorkbook.find((row) => row.id === this.selectedQuantificationId);
    return selectedQuantification?.nombre || selectedQuantification?.descripcion || '-';
  }

  get selectedSheetLabel(): string {
    return this.boqSheets.find((sheet) => sheet.index === this.selectedSheetIndex)?.name ?? '-';
  }

  get comparisonQuantifications(): CuantificacionB5DOrm[] {
    return this.quantificationsWithWorkbook.filter((row) => row.id !== this.selectedQuantificationId);
  }

  get selectedComparatorLabels(): string {
    const labels = this.comparisonQuantifications
      .filter((row) => this.selectedComparatorQuantificationIds.includes(row.id))
      .map((row) => row.nombre || row.descripcion || `${this.t('parametersReport.panel.quantificationLabel')} ${row.id}`);
    return labels.length ? labels.join(', ') : '-';
  }

  get comparisonGranularityHint(): string {
    if (this.selectedComparisonGranularity === 'wbs') {
      return `${this.t('parametersReport.panel.compareByHintWbs')} ${this.t('parametersReport.panel.wbsReferenceSuggestion')} ${this.selectedWbsReferenceLabel}.`;
    }

    return this.t('parametersReport.panel.compareByHintIndividual');
  }

  get availableWbsReferenceOptions(): WbsReferenceOption[] {
    const catalogIndex = this.getSelectedCatalogWbsIndex();
    const conceptLevels = [...catalogIndex.conceptsByDepth.entries()]
      .map(([level, concepts]) => {
        const representativeConcept = concepts
          .filter((concept) => concept.es_agrupador)
          .sort((first, second) => (first.orden ?? first.id) - (second.orden ?? second.id))[0]
          ?? concepts.sort((first, second) => (first.orden ?? first.id) - (second.orden ?? second.id))[0]
          ?? null;
        const label = representativeConcept
          ? `${this.t('parametersReport.panel.wbsReferenceOptionLevel')} ${level} · ${representativeConcept.clave?.trim() || representativeConcept.clave_secundaria?.trim() || '-'}`
          : `${this.t('parametersReport.panel.wbsReferenceOptionLevel')} ${level}`;
        return {
          level,
          label,
          matches: concepts.length,
        };
      })
      .sort((first, second) => first.level - second.level);

    const options = conceptLevels.filter((option) => option.matches > 0);
    options.sort((first, second) => {
      if (second.matches !== first.matches) return second.matches - first.matches;
      return first.level - second.level;
    });

    return options.length ? options : [{ level: 1, label: `${this.t('parametersReport.panel.wbsReferenceOptionLevel')} 1`, matches: 0 }];
  }

  get selectedWbsReferenceLabel(): string {
    return this.availableWbsReferenceOptions.find((option) => option.level === this.selectedWbsLevel)?.label
      ?? `${this.t('parametersReport.panel.wbsReferenceOptionLevel')} ${this.selectedWbsLevel}`;
  }

  get comparisonNote(): string {
    if (this.selectedComparisonGranularity === 'wbs') {
      return this.t('parametersReport.panel.comparisonNoteWbs');
    }

    return this.t('parametersReport.panel.comparisonNoteIndividual');
  }

  get availableWbsManualConceptOptions(): WbsManualConceptOption[] {
    const catalogIndex = this.getSelectedCatalogWbsIndex();
    return this.getSelectedCatalogConcepts()
      .filter((concept) => concept.es_agrupador)
      .map((concept) => {
        const pathSegments = catalogIndex.pathSegmentsById.get(concept.id) ?? [];
        const level = pathSegments.length || this.countWbsSegments(concept.clave ?? '');
        const clave = concept.clave?.trim() || '-';
        const descripcion = concept.descripcion?.trim() || '-';
        return {
          id: concept.id,
          level,
          label: `${this.t('parametersReport.panel.wbsReferenceOptionLevel')} ${level} · ${clave} · ${descripcion}`,
        };
      })
      .sort((first, second) => {
        if (first.level !== second.level) return first.level - second.level;
        return first.label.localeCompare(second.label, undefined, { sensitivity: 'base' });
      });
  }

  get manualWbsRows(): ParametersReportData['costRows'] {
    return [...this.reportData.costRows, ...this.reportData.percentCostRows].filter(
      (row) => row.parameterId != null && row.conceptoCostoId == null,
    );
  }

  getManualWbsSelection(parameterId: number | null): number | null {
    if (parameterId == null) return null;
    return this.manualWbsConceptSelectionByParameterId.get(parameterId) ?? null;
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
        nombre: `${this.t('parametersReport.panel.catalogLabel')} ${catalogId}`,
        descripcion: null,
        grupo_cantidades_bim: null,
        propiedad_tipo_bim: null,
        catalogo_externo: null,
      });
    }
    return fallbackCatalogs;
  }

  get buildingTypeOptions(): string[] {
    return this.collectParameterMetadataOptions((row) => row.tipo_edificacion);
  }

  get workTypeOptions(): string[] {
    return this.collectParameterMetadataOptions((row) => row.tipo_obra);
  }

  get zoneOptions(): string[] {
    return this.collectParameterMetadataOptions((row) => row.zona);
  }

  get selectedCatalogLabel(): string {
    const selectedCatalog = this.availableCostCatalogs.find((catalog) => catalog.id === this.selectedCatalogId);
    return selectedCatalog?.nombre ?? selectedCatalog?.descripcion ?? this.t('parametersReport.catalog.costs');
  }

  get showQuantitySection(): boolean {
    return this.selectedParameterScope === 'all' || this.selectedParameterScope === 'quantity';
  }

  get showCostSection(): boolean {
    return this.selectedParameterScope === 'all' || this.selectedParameterScope === 'cost';
  }

  get showCostPercentSection(): boolean {
    return this.selectedParameterScope === 'all' || this.selectedParameterScope === 'cost-percent';
  }

  get showUnassignedSection(): boolean {
    return this.selectedParameterScope !== 'quantity';
  }

  get hasReportData(): boolean {
    if (this.selectedReportMode === 'boq-comparison') {
      return !!this.boqComparisonData.groups.length;
    }
    return (
      (this.showQuantitySection && (this.reportData.quantityRows.length > 0 || this.reportData.quantitySummary.total > 0)) ||
      (this.showCostSection && (this.reportData.costRows.length > 0 || this.reportData.costSummary.total > 0)) ||
      (this.showCostPercentSection && (this.reportData.percentCostRows.length > 0 || this.reportData.percentCostSummary.total > 0)) ||
      (this.showUnassignedSection && this.reportData.unassignedRows.length > 0)
    );
  }

  selectQuantification(value: number | null): void {
    this.selectedQuantificationId = value;
    this.selectedSheetIndex = 0;
    this.syncSelectedComparators();
    this.persistReportPreferences();
    void this.loadReportWorkbook();
  }

  selectSheet(value: number | null): void {
    if (value == null || value === this.selectedSheetIndex) return;
    this.selectedSheetIndex = value;
    this.persistReportPreferences();
    void this.loadReportWorkbook();
  }

  selectCatalog(value: number | null): void {
    this.selectedCatalogId = value;
    this.syncSelectedWbsLevel();
    this.syncManualWbsSelections();
    this.syncManualParameterSelections();
    this.persistReportPreferences();
    this.rebuildReportData();
  }

  selectParameterScope(value: ReportParameterScope): void {
    if (value === this.selectedParameterScope) return;
    this.selectedParameterScope = value;
    this.persistReportPreferences();
    this.rebuildReportData();
  }

  selectBuildingType(value: string): void {
    if (value === this.selectedBuildingType) return;
    this.selectedBuildingType = value;
    this.persistReportPreferences();
    this.rebuildReportData();
  }

  selectWorkType(value: string): void {
    if (value === this.selectedWorkType) return;
    this.selectedWorkType = value;
    this.persistReportPreferences();
    this.rebuildReportData();
  }

  selectZone(value: string): void {
    if (value === this.selectedZone) return;
    this.selectedZone = value;
    this.persistReportPreferences();
    this.rebuildReportData();
  }

  selectDecimalPlaces(value: number | null): void {
    const normalizedValue = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(6, Math.floor(value))) : 2;
    if (normalizedValue === this.selectedDecimalPlaces) return;
    this.selectedDecimalPlaces = normalizedValue;
    this.persistReportPreferences();
    this.rebuildReportData();
  }

  selectComparisonGranularity(value: ReportComparisonGranularity): void {
    if (value === this.selectedComparisonGranularity) return;
    this.selectedComparisonGranularity = value;
    if (value === 'wbs') {
      this.syncSelectedWbsLevel();
    }
    this.persistReportPreferences();
    if (this.selectedReportMode === 'boq-comparison') {
      void this.loadReportWorkbook();
      return;
    }
    this.rebuildReportData();
  }

  selectWbsLevel(value: number | null): void {
    const normalizedValue = typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
    if (normalizedValue === this.selectedWbsLevel) return;
    this.selectedWbsLevel = normalizedValue;
    this.persistReportPreferences();
    this.rebuildReportData();
    if (this.selectedReportMode === 'boq-comparison') {
      void this.loadReportWorkbook();
    }
  }

  selectReportMode(value: ReportMode): void {
    if (value === this.selectedReportMode) return;
    this.selectedReportMode = value;
    this.syncSelectedComparators();
    this.persistReportPreferences();
    void this.loadReportWorkbook();
  }

  selectManualWbsConcept(parameterId: number | null, conceptId: number | null): void {
    if (parameterId == null) return;

    const currentValue = this.manualWbsConceptSelectionByParameterId.get(parameterId) ?? null;
    if (currentValue === conceptId) return;

    const nextSelections = new Map(this.manualWbsConceptSelectionByParameterId);
    if (conceptId == null) {
      nextSelections.delete(parameterId);
    } else {
      nextSelections.set(parameterId, conceptId);
    }

    this.manualWbsConceptSelectionByParameterId = nextSelections;
    this.persistReportPreferences();
    this.rebuildReportData();
  }

  getManualParameterSearch(conceptKey: string | null | undefined): string {
    if (!conceptKey) return '';
    return this.manualParameterSearchByConceptKey.get(conceptKey) ?? '';
  }

  updateManualParameterSearch(conceptKey: string | null | undefined, value: string): void {
    const normalizedConceptKey = (conceptKey ?? '').trim();
    if (!normalizedConceptKey) return;
    const nextValue = value ?? '';
    const currentValue = this.manualParameterSearchByConceptKey.get(normalizedConceptKey) ?? '';
    if (currentValue === nextValue) return;

    const nextSearch = new Map(this.manualParameterSearchByConceptKey);
    if (nextValue.trim()) {
      nextSearch.set(normalizedConceptKey, nextValue);
    } else {
      nextSearch.delete(normalizedConceptKey);
    }
    this.manualParameterSearchByConceptKey = nextSearch;

    const exactMatch = this.getManualParameterMatches(normalizedConceptKey).find(
      (parameter) => this.getManualParameterLabel(parameter).toLowerCase() === nextValue.trim().toLowerCase(),
    );
    if (exactMatch) {
      this.selectManualParameterForConcept(normalizedConceptKey, exactMatch.id);
    }
  }

  getManualParameterMatches(conceptKey: string | null | undefined): ParametroB5DOrm[] {
    const normalizedConceptKey = (conceptKey ?? '').trim();
    if (!normalizedConceptKey) return [];

    const searchText = this.getManualParameterSearch(normalizedConceptKey).trim().toLowerCase();
    const candidates = this.parameters.filter((row) => row.activo && isCostParameterType(row.tipo_parametro));
    if (!searchText) {
      return candidates.slice(0, 8);
    }

    return candidates
      .filter((row) => {
        const code = (row.clave ?? '').toLowerCase();
        const description = (row.descripcion ?? '').toLowerCase();
        return code.includes(searchText) || description.includes(searchText);
      })
      .slice(0, 8);
  }

  getManualParameterLabel(parameter: ParametroB5DOrm): string {
    const code = parameter.clave?.trim() || '-';
    const description = parameter.descripcion?.trim() || '-';
    return `${code} · ${description}`;
  }

  selectManualParameterForConcept(conceptKey: string | null | undefined, parameterId: number | null): void {
    const normalizedConceptKey = (conceptKey ?? '').trim();
    if (!normalizedConceptKey) return;

    const currentValue = this.manualParameterSelectionByConceptKey.get(normalizedConceptKey) ?? null;
    if (currentValue === parameterId) return;

    const nextSelections = new Map(this.manualParameterSelectionByConceptKey);
    if (parameterId == null) {
      nextSelections.delete(normalizedConceptKey);
    } else {
      nextSelections.set(normalizedConceptKey, parameterId);
    }
    this.manualParameterSelectionByConceptKey = nextSelections;
    const nextSearch = new Map(this.manualParameterSearchByConceptKey);
    if (parameterId == null) {
      nextSearch.delete(normalizedConceptKey);
    }
    this.manualParameterSearchByConceptKey = nextSearch;
    this.persistReportPreferences();
    this.rebuildReportData();
  }

  toggleComparatorSelection(quantificationId: number, selected: boolean): void {
    const nextSelections = new Set(this.selectedComparatorQuantificationIds);
    if (selected) {
      nextSelections.add(quantificationId);
    } else {
      nextSelections.delete(quantificationId);
    }
    this.selectedComparatorQuantificationIds = [...nextSelections];
    this.persistReportPreferences();
    void this.loadReportWorkbook();
  }

  resetView(): void {
    const preferredQuantification = this.quantificationsWithWorkbook.find((row) => row.id === this.selectedQuantificationId)
      ?? this.quantificationsWithWorkbook[0]
      ?? null;
    this.selectedReportMode = 'parameters';
    this.selectedComparisonGranularity = 'individual';
    this.selectedParameterScope = 'all';
    this.selectedDecimalPlaces = 2;
    this.selectedWbsLevel = 1;
    this.selectedQuantificationId = preferredQuantification?.id ?? null;
    this.selectedSheetIndex = 0;
    this.selectedComparatorQuantificationIds = [];
    this.selectedBuildingType = 'all';
    this.selectedWorkType = 'all';
    this.selectedZone = 'all';
    this.manualWbsConceptSelectionByParameterId = new Map<number, number>();
    this.manualParameterSelectionByConceptKey = new Map<string, number>();
    this.manualParameterSearchByConceptKey = new Map<string, string>();
    this.syncSelectedCatalog();
    this.syncSelectedWbsLevel();
    this.persistReportPreferences();
    this.reportRefreshToken += 1;
    void this.loadReportWorkbook();
  }

  formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  formatReportNumber(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '-';
    const roundedValue = Math.abs(value) < 0.0005 ? 0 : value;
    return roundedValue.toFixed(this.selectedDecimalPlaces);
  }

  trackByRow(_index: number, row: BoqExtractedRow): string {
    return `${row.row}-${row.clave}-${row.descripcion}`;
  }

  trackByComparisonRow(_index: number, row: BoqComparisonRow): string {
    return row.key;
  }

  private async loadReportWorkbook(): Promise<void> {
    const projectId = this.activeProject?.id ?? null;
    const quantificationId = this.selectedQuantificationId;
    const localToken = ++this.loadToken;

    this.loading = true;
    this.error = '';
    this.boqSheets = [];
    this.boqRows = [];
    this.reportData = this.createEmptyReportData();
    this.boqComparisonData = this.createEmptyBoqComparisonData();

    if (!projectId || quantificationId == null) {
      this.loading = false;
      if (this.selectedReportMode === 'parameters') {
        this.rebuildReportData();
      }
      return;
    }

    try {
      if (this.selectedReportMode === 'boq-comparison') {
        await this.loadBoqComparisonData(projectId, localToken);
      } else {
        const loadedSheet = await this.loadBoqSheet(projectId, quantificationId, this.selectedSheetIndex);
        if (localToken !== this.loadToken) return;
        this.boqSheets = loadedSheet.sheets;
        if (!this.boqSheets.length) {
          this.error = this.t('parametersReport.error.noVisibleSheets');
          return;
        }

        this.selectedSheetIndex = loadedSheet.sheetIndex;
        this.boqRows = loadedSheet.rows;
        this.syncSelectedWbsLevel();
        this.persistReportPreferences();
        this.rebuildReportData();
      }
    } catch {
      if (localToken === this.loadToken) {
        this.error =
          this.selectedReportMode === 'boq-comparison'
            ? this.t('parametersReport.error.readComparison')
            : this.t('parametersReport.error.readSelected');
      }
    } finally {
      if (localToken === this.loadToken) {
        this.loading = false;
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  private rebuildReportData(): void {
    this.reportData = buildParametersReportData(
      this.boqRows,
      this.parameters,
      this.concepts,
      this.selectedCatalogId,
      {
        comparisonGranularity: this.selectedComparisonGranularity,
        wbsLevel: this.selectedWbsLevel,
        parameterScope: this.selectedParameterScope,
        decimalPlaces: this.selectedDecimalPlaces,
        manualWbsConceptSelectionByParameterId: this.manualWbsConceptSelectionByParameterId,
        manualParameterSelectionByConceptKey: this.manualParameterSelectionByConceptKey,
        parameterBuildingType: this.selectedBuildingType === 'all' ? '' : this.selectedBuildingType,
        parameterWorkType: this.selectedWorkType === 'all' ? '' : this.selectedWorkType,
        parameterZone: this.selectedZone === 'all' ? '' : this.selectedZone,
      },
    );
    this.persistReportPreferences();
  }

  private async loadBoqComparisonData(projectId: number, localToken: number): Promise<void> {
    const primaryId = this.selectedQuantificationId;
    if (primaryId == null) {
      this.boqComparisonData = this.createEmptyBoqComparisonData();
      return;
    }

    const primarySheet = await this.loadBoqSheet(projectId, primaryId, this.selectedSheetIndex);
    if (localToken !== this.loadToken) return;
    this.boqSheets = primarySheet.sheets;
    if (!this.boqSheets.length) {
      this.error = this.t('parametersReport.error.noPrimaryVisibleSheets');
      return;
    }

    this.selectedSheetIndex = primarySheet.sheetIndex;
    this.boqRows = primarySheet.rows;
    this.syncSelectedWbsLevel();
    this.persistReportPreferences();

    const comparatorIds = this.selectedComparatorQuantificationIds.filter((quantificationId) => quantificationId !== primaryId);
    if (!comparatorIds.length) {
      this.boqComparisonData = {
        primaryQuantificationId: primaryId,
        primaryLabel: this.selectedQuantificationLabel,
        primarySheetName: this.selectedSheetLabel,
        groups: [],
      };
      return;
    }

    const comparatorInputs = await Promise.all(
      comparatorIds.map(async (quantificationId) => {
        const loadedSheet = await this.loadBoqSheet(projectId, quantificationId, this.selectedSheetIndex);
        return {
          quantificationId,
          quantificationLabel: this.getQuantificationLabel(quantificationId),
          sheetName: loadedSheet.sheetName,
          rows: loadedSheet.rows,
        };
      }),
    );
    if (localToken !== this.loadToken) return;

    this.boqComparisonData = buildBoqComparisonReportData(
      this.boqRows,
      primaryId,
      this.selectedQuantificationLabel,
      this.selectedSheetLabel,
      comparatorInputs,
      {
        comparisonGranularity: this.selectedComparisonGranularity,
        wbsLevel: this.selectedWbsLevel,
        decimalPlaces: this.selectedDecimalPlaces,
      },
    );
  }

  private async loadBoqSheet(projectId: number, quantificationId: number, preferredSheetIndex: number): Promise<LoadedBoqSheet> {
    const summary = await this.workbookPreviewCache.getWorkbookSummary(projectId, quantificationId);
    const sheets = summary.sheets ?? [];
    if (!sheets.length) {
      return {
        sheets: [],
        sheetIndex: preferredSheetIndex,
        sheetName: '-',
        rows: [],
      };
    }

    const sheetIndex = sheets.some((sheet) => sheet.index === preferredSheetIndex) ? preferredSheetIndex : sheets[0]?.index ?? 0;
    const selectedSheetName = sheets.find((sheet) => sheet.index === sheetIndex)?.name ?? '-';
    const layers = await this.workbookPreviewCache.getWorkbookSheetLayers(projectId, quantificationId, sheetIndex);

    return {
      sheets,
      sheetIndex,
      sheetName: selectedSheetName,
      rows: extractBoqRows(layers.cells),
    };
  }

  private syncSelectedComparators(): void {
    const availableIds = new Set(this.comparisonQuantifications.map((row) => row.id));
    const currentSelections = this.selectedComparatorQuantificationIds.filter((rowId) => availableIds.has(rowId));
    if (currentSelections.length) {
      if (!areNumberArraysEqual(currentSelections, this.selectedComparatorQuantificationIds)) {
        this.selectedComparatorQuantificationIds = currentSelections;
        this.persistReportPreferences();
      }
      return;
    }

    const firstComparator = this.comparisonQuantifications[0] ?? null;
    this.selectedComparatorQuantificationIds = firstComparator ? [firstComparator.id] : [];
    this.persistReportPreferences();
  }

  private getQuantificationLabel(quantificationId: number): string {
    const quantification = this.quantificationsWithWorkbook.find((row) => row.id === quantificationId);
    return quantification?.nombre || quantification?.descripcion || `${this.t('parametersReport.panel.quantificationLabel')} ${quantificationId}`;
  }

  private syncSelectedCatalog(): void {
    const catalogIds = new Set(this.availableCostCatalogs.map((row) => row.id));
    if (this.selectedCatalogId != null && catalogIds.has(this.selectedCatalogId)) {
      return;
    }

    this.selectedCatalogId =
      (this.activeCatalogId != null && catalogIds.has(this.activeCatalogId) ? this.activeCatalogId : null) ??
      this.availableCostCatalogs[0]?.id ??
      null;
    this.persistReportPreferences();
  }

  private syncManualWbsSelections(): void {
    const validParameterIds = new Set(
      this.parameters.filter((row) => row.activo && isCostParameterType(row.tipo_parametro)).map((row) => row.id),
    );
    const validConceptIds = new Set(this.getSelectedCatalogConcepts().filter((row) => row.es_agrupador).map((row) => row.id));

    const nextSelections = new Map<number, number>();
    for (const [parameterId, conceptId] of this.manualWbsConceptSelectionByParameterId.entries()) {
      if (!validParameterIds.has(parameterId)) continue;
      if (!validConceptIds.has(conceptId)) continue;
      nextSelections.set(parameterId, conceptId);
    }

    if (areNumberMapsEqual(nextSelections, this.manualWbsConceptSelectionByParameterId)) {
      return;
    }

    this.manualWbsConceptSelectionByParameterId = nextSelections;
    this.persistReportPreferences();
  }

  private syncManualParameterSelections(): void {
    const validConceptKeys = new Set(
      this.getSelectedCatalogConcepts().map((concept) =>
        getReportConceptKey({
          row: concept.orden ?? concept.id,
          clave: concept.clave?.trim() ?? '',
          descripcion: concept.descripcion?.trim() ?? '',
          cantidad: concept.cantidad ?? null,
          unidad: concept.unidad?.trim() || '-',
          conceptId: concept.id,
        }),
      ),
    );
    const validParameterIds = new Set(
      this.parameters.filter((row) => row.activo && isCostParameterType(row.tipo_parametro)).map((row) => row.id),
    );

    const nextSelections = new Map<string, number>();
    for (const [conceptKey, parameterId] of this.manualParameterSelectionByConceptKey.entries()) {
      if (!validConceptKeys.has(conceptKey)) continue;
      if (!validParameterIds.has(parameterId)) continue;
      nextSelections.set(conceptKey, parameterId);
    }

    if (areStringNumberMapsEqual(nextSelections, this.manualParameterSelectionByConceptKey)) {
      return;
    }

    this.manualParameterSelectionByConceptKey = nextSelections;
    this.persistReportPreferences();
  }

  private restoreReportPreferences(): void {
    const storedState = readStoredJson<ReportPanelStoredState>(this.reportStorageKey);
    this.lastAppliedStorageScopeKey = this.reportStorageKey;

    this.selectedReportMode = 'parameters';
    this.selectedComparisonGranularity = 'individual';
    this.selectedParameterScope = 'all';
    this.selectedDecimalPlaces = 2;
    this.selectedWbsLevel = 1;
    this.selectedQuantificationId = null;
    this.selectedSheetIndex = 0;
    this.selectedCatalogId = null;
    this.selectedComparatorQuantificationIds = [];
    this.manualWbsConceptSelectionByParameterId = new Map<number, number>();
    this.manualParameterSelectionByConceptKey = new Map<string, number>();
    this.manualParameterSearchByConceptKey = new Map<string, string>();
    this.selectedQuantificationId = this.quantificationsWithWorkbook[0]?.id ?? null;

    if (!storedState) return;

    if (storedState.selectedReportMode) this.selectedReportMode = storedState.selectedReportMode;
    if (storedState.selectedComparisonGranularity) this.selectedComparisonGranularity = storedState.selectedComparisonGranularity;
    if (storedState.selectedParameterScope) this.selectedParameterScope = storedState.selectedParameterScope;
    if (storedState.selectedDecimalPlaces != null) this.selectedDecimalPlaces = Math.max(0, Math.min(6, Math.floor(storedState.selectedDecimalPlaces)));
    if (storedState.selectedWbsLevel != null) this.selectedWbsLevel = Math.max(1, Math.floor(storedState.selectedWbsLevel));
    if (storedState.selectedQuantificationId !== undefined) this.selectedQuantificationId = storedState.selectedQuantificationId;
    if (storedState.selectedSheetIndex != null) this.selectedSheetIndex = Math.max(0, Math.floor(storedState.selectedSheetIndex));
    if (storedState.selectedCatalogId !== undefined) this.selectedCatalogId = storedState.selectedCatalogId;
    if (storedState.selectedComparatorQuantificationIds) {
      this.selectedComparatorQuantificationIds = [...new Set(storedState.selectedComparatorQuantificationIds.filter((value) => Number.isFinite(value)))];
    }
    this.manualWbsConceptSelectionByParameterId = new Map(
      Object.entries(storedState.manualWbsConceptSelectionByParameterId ?? {}).map(([parameterId, conceptId]) => [Number(parameterId), conceptId]),
    );
    this.manualParameterSelectionByConceptKey = new Map(
      Object.entries(storedState.manualParameterSelectionByConceptKey ?? {}).map(([conceptKey, parameterId]) => [conceptKey, parameterId]),
    );
    if (storedState.selectedBuildingType) this.selectedBuildingType = storedState.selectedBuildingType;
    if (storedState.selectedWorkType) this.selectedWorkType = storedState.selectedWorkType;
    if (storedState.selectedZone) this.selectedZone = storedState.selectedZone;
  }

  private persistReportPreferences(): void {
    const storedState: ReportPanelStoredState = {
      selectedReportMode: this.selectedReportMode,
      selectedComparisonGranularity: this.selectedComparisonGranularity,
      selectedParameterScope: this.selectedParameterScope,
      selectedDecimalPlaces: this.selectedDecimalPlaces,
      selectedWbsLevel: this.selectedWbsLevel,
      selectedQuantificationId: this.selectedQuantificationId,
      selectedSheetIndex: this.selectedSheetIndex,
      selectedCatalogId: this.selectedCatalogId,
      selectedBuildingType: this.selectedBuildingType,
      selectedWorkType: this.selectedWorkType,
      selectedZone: this.selectedZone,
      selectedComparatorQuantificationIds: this.selectedComparatorQuantificationIds,
      manualWbsConceptSelectionByParameterId: Object.fromEntries(this.manualWbsConceptSelectionByParameterId.entries()),
      manualParameterSelectionByConceptKey: Object.fromEntries(this.manualParameterSelectionByConceptKey.entries()),
    };

    writeStoredJson(this.reportStorageKey, storedState);
    this.lastAppliedStorageScopeKey = this.reportStorageKey;
  }

  private createEmptyReportData(): ParametersReportData {
    return {
      quantitySummary: {
        total: 0,
        inRange: 0,
        underLimit: 0,
        aboveLimit: 0,
        withoutParameter: 0,
        slices: [],
        background: 'radial-gradient(circle at center, #fff 0 58%, transparent 58% 100%)',
      },
      costSummary: {
        total: 0,
        inRange: 0,
        underLimit: 0,
        aboveLimit: 0,
        withoutParameter: 0,
        slices: [],
        background: 'radial-gradient(circle at center, #fff 0 58%, transparent 58% 100%)',
      },
      percentCostSummary: {
        total: 0,
        inRange: 0,
        underLimit: 0,
        aboveLimit: 0,
        withoutParameter: 0,
        slices: [],
        background: 'radial-gradient(circle at center, #fff 0 58%, transparent 58% 100%)',
      },
      quantityRows: [],
      costRows: [],
      percentCostRows: [],
      unassignedRows: [],
    };
  }

  private createEmptyBoqComparisonData(): BoqComparisonReportData {
    return {
      primaryQuantificationId: null,
      primaryLabel: '-',
      primarySheetName: '-',
      groups: [],
    };
  }

  private countWbsSegments(clave: string): number {
    const normalizedClave = clave
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    if (!normalizedClave) return 0;
    return normalizedClave
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .map((segment) => segment.trim())
      .filter((segment) => !!segment).length;
  }

  private getSelectedCatalogConcepts(): ConceptoB5DOrm[] {
    if (this.selectedCatalogId == null) return this.concepts;
    return this.concepts.filter((row) => row.catalogo_id === this.selectedCatalogId);
  }

  private getSelectedCatalogWbsIndex(): ReturnType<typeof buildCatalogWbsIndex> {
    return buildCatalogWbsIndex(this.getSelectedCatalogConcepts());
  }

  private syncSelectedWbsLevel(): void {
    if (this.selectedComparisonGranularity !== 'wbs') return;

    const options = this.availableWbsReferenceOptions;
    const availableLevels = new Set(options.map((option) => option.level));
    if (availableLevels.has(this.selectedWbsLevel)) {
      return;
    }

    const suggestedOption = options[0] ?? null;
    this.selectedWbsLevel = suggestedOption?.level ?? 1;
    this.persistReportPreferences();
  }

  private collectParameterMetadataOptions(selector: (row: ParametroB5DOrm) => string | null | undefined): string[] {
    const options = new Set<string>();
    for (const row of this.parameters) {
      const value = (selector(row) ?? '').trim();
      if (value) options.add(value);
    }
    return [...options].sort((first, second) => first.localeCompare(second, 'es'));
  }

}

function areNumberMapsEqual(first: Map<number, number>, second: Map<number, number>): boolean {
  if (first.size !== second.size) return false;
  for (const [key, value] of first.entries()) {
    if (second.get(key) !== value) return false;
  }
  return true;
}

function areStringNumberMapsEqual(first: Map<string, number>, second: Map<string, number>): boolean {
  if (first.size !== second.size) return false;
  for (const [key, value] of first.entries()) {
    if (second.get(key) !== value) return false;
  }
  return true;
}

function areNumberArraysEqual(first: number[], second: number[]): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}
