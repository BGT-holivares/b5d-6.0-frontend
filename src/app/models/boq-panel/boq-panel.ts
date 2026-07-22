import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BackendProyectosService } from '../../services/backend-proyectos.service';
import { LoadingPanelService } from '../../services/loading-panel.service';
import { WorkbookPreviewCacheService } from '../../services/workbook-preview-cache.service';
import { ResizableTableDirective } from '../../directives/resizable-table/resizable-table.directive';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';
import { getSafeLocalStorage } from '../../utils/browser-storage';
import { buildScopedStorageKey } from '../../utils/ui-state-storage';
import { BOQ_PANEL_TRANSLATIONS } from './boq-panel.translations';
import {
  clampPanelPercent,
  handlePanelZoomWheel,
  startPointerDrag,
  stepPanelPercent,
  swapPanelOrder,
} from '../../utils/panel-interactions/panel-interactions';
import { XlsxPreview } from '../xlsx-preview/xlsx-preview';
import type { ToolbarActionId } from '../toolbar/toolbar';
import type { HomeToolbarState } from '../../types/home-toolbar';
import { createWorkbookSavePlan, createWorkbookUploadPlan } from '../../utils/loading-panel/loading-plans';
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
  CuantificacionB5DOrm,
  ProyectoTrabajoOrm,
  WorkbookCellChangeOrm,
} from '../../types/b5d-orm';

type QuantificationGroupRow = {
  groupName: string;
  items: CuantificacionB5DOrm[];
};

type QuantificationTableColumnKey = 'tipo' | 'nombre' | 'descripcion' | 'comentarios' | 'fecha';


@Component({
  selector: 'app-boq-panel',
  imports: [FormsModule, ResizableTableDirective, XlsxPreview],
  templateUrl: './boq-panel.html',
  styleUrl: './boq-panel.scss',
})
export class BoqPanel implements OnChanges, OnDestroy {
  readonly boqPanelTranslations = BOQ_PANEL_TRANSLATIONS;
  readonly globalTranslations = GLOBAL_TRANSLATIONS;
  readonly i18n = inject(I18nService);
  readonly loadingPanel = inject(LoadingPanelService);

  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Input() cuantificacionesB5d: CuantificacionB5DOrm[] = [];
  @Input() b5dLoading = false;
  @Input() tableFiltersVisible = false;
  @Input() storageScopeKey = 'anonymous';
  @Output() toolbarStateChange = new EventEmitter<HomeToolbarState>();

  readonly quantificationTableColumns: TableColumnDefinition<CuantificacionB5DOrm>[] = [
    {
      key: 'tipo',
      label: 'Tipo',
      labelKey: 'boqPanel.column.type',
      kind: 'number',
      widthPx: 120,
      getValue: (row) => row.tipo,
    },
    {
      key: 'nombre',
      label: 'Nombre',
      labelKey: 'boqPanel.column.name',
      kind: 'text',
      widthPx: 200,
      getValue: (row) => row.nombre ?? '',
    },
    {
      key: 'descripcion',
      label: 'Descripción',
      labelKey: 'boqPanel.column.description',
      kind: 'text',
      widthPx: 260,
      getValue: (row) => row.descripcion ?? '',
    },
    {
      key: 'comentarios',
      label: 'Comentarios',
      labelKey: 'boqPanel.column.comments',
      kind: 'text',
      widthPx: 260,
      getValue: (row) => row.comentarios ?? '',
    },
    {
      key: 'fecha',
      label: 'Fecha',
      labelKey: 'boqPanel.column.date',
      kind: 'date',
      widthPx: 170,
      getValue: (row) => row.fecha ?? '',
    },
  ];
  private readonly quantificationTableDefaults = createDefaultTableViewPreferences(
    this.quantificationTableColumns.map((column) => ({
      key: column.key,
      hiddenByDefault: column.hiddenByDefault,
    })),
  );
  private readonly quantificationTableStorageKeyBase = 'boq-panel';
  quantificationTablePreferences: TableViewPreferences = loadTableViewPreferences(
    this.quantificationTableStorageKey,
    this.quantificationTableDefaults,
  );
  quantificationColumnChooserLeft = 0;
  quantificationColumnChooserTop = 0;

  leftPanelWidth = 420;
  panelOrder: ('list' | 'preview')[] = ['list', 'preview'];
  private draggedPanelOrderId: 'list' | 'preview' | null = null;
  private panelOrderDragTargetId: 'list' | 'preview' | null = null;
  boqTableContextMenuVisible = false;
  boqTableContextMenuX = 0;
  boqTableContextMenuY = 0;
  boqTableRefreshToken = 0;
  cuantificacionSeleccionadaId: number | null = null;
  workQuantifications: CuantificacionB5DOrm[] = [];
  savingQuantificationRowById = new Set<number>();
  workbookLoading = false;
  workbookUploadInProgress = false;
  workbookSavingChanges = false;
  workbookError = '';
  workbookInfoMessage = '';
  workbookSheets: string[] = [];
  selectedSheetName = '';
  listZoomPercent = 100;
  sheetZoomPercent = 100;
  sheetZoomInputValue = '100';

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly backendProyectos = inject(BackendProyectosService);
  private readonly workbookPreviewCache = inject(WorkbookPreviewCacheService);
  private workbookLoadToken = 0;
  private workbookSheetIndexByName = new Map<string, number>();
  private pendingWorkbookCellChanges = new Map<string, WorkbookCellChangeOrm[]>();
  private pendingWorkbookRowLayoutChanges = new Map<string, Map<number, number>>();
  private pendingWorkbookColumnLayoutChanges = new Map<string, Map<number, number>>();
  selectedWorkbookCellAddress = '';
  selectedWorkbookCellValue = '';
  selectedWorkbookCellFormula = '';
  selectedWorkbookRowNumber: number | null = null;
  selectedWorkbookColumnNumber: number | null = null;
  selectedWorkbookRowHeightPx = '';
  selectedWorkbookColumnWidthPx = '';
  private lastAppliedStorageScopeKey = '';
  private quantificationColumnChooserPositionReady = false;
  quantificationColumnDragKey: string | null = null;
  private readonly quantificationColumnChooserWidth = 360;

  // Keeps selection and workbook preview synchronized when backend rows change.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['storageScopeKey'] || !this.lastAppliedStorageScopeKey) {
      this.restoreQuantificationTablePreferences();
    }

    if (changes['cuantificacionesB5d']) {
      this.workQuantifications = this.cuantificacionesB5d.map((quantification) => ({ ...quantification }));
      const selectedId = this.cuantificacionSeleccionadaId;
      const selectedStillExists = selectedId != null && this.workQuantifications.some((item) => item.id === selectedId);
      if (!selectedStillExists) {
        this.cuantificacionSeleccionadaId = this.workQuantifications[0]?.id ?? null;
      }
      this.syncQuantificationTablePreferences();
      void this.loadSelectedWorkbookPreview();
    }
  }

  ngOnDestroy(): void {
  }

  get cuantificacionSeleccionada(): CuantificacionB5DOrm | null {
    if (this.cuantificacionSeleccionadaId == null) {
      return this.workQuantifications[0] ?? null;
    }
    return this.workQuantifications.find((item) => item.id === this.cuantificacionSeleccionadaId) ?? null;
  }

  seleccionarCuantificacion(id: number): void {
    this.cuantificacionSeleccionadaId = id;
    void this.loadSelectedWorkbookPreview();
  }

  triggerHomeAction(_action: ToolbarActionId): void {
    // The BOQ panel does not have additional Home actions beyond refresh/reset.
  }

  // Opens the local file picker to upload a replacement workbook.
  openWorkbookUploadDialog(fileInput: HTMLInputElement): void {
    if (this.workbookUploadInProgress) return;
    fileInput.value = '';
    fileInput.click();
  }

  t(key: string): string {
    return this.i18n.translateForComponent(this.boqPanelTranslations, key);
  }

  // Uploads the selected workbook file and refreshes the preview from backend bytes.
  async onWorkbookFileSelected(event: Event): Promise<void> {
    const inputElement = event.target as HTMLInputElement | null;
    const selectedFile = inputElement?.files?.[0] ?? null;
    if (!selectedFile) return;

    const projectId = this.activeProject?.id ?? null;
    const selectedQuantificationId = this.cuantificacionSeleccionada?.id ?? null;
    if (!projectId || !selectedQuantificationId) return;

    const normalizedFileName = selectedFile.name.trim().toLowerCase();
    if (!normalizedFileName.endsWith('.xlsx') && !normalizedFileName.endsWith('.xlsm')) {
      this.workbookError = this.t('boqPanel.invalidWorkbookFile');
      return;
    }

    const loadingSessionId = this.loadingPanel.start(
      createWorkbookUploadPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.uploadWorkbook')),
    );
    this.workbookUploadInProgress = true;
    this.workbookError = '';
    try {
      const updatedQuantification = await firstValueFrom(
        this.backendProyectos.subirLibroExcelCuantificacion(projectId, selectedQuantificationId, selectedFile),
      );
      this.loadingPanel.completeStep(loadingSessionId, 'uploading', this.t('boqPanel.workbookImported'));
      this.replaceQuantificationRow(updatedQuantification);
      this.workbookPreviewCache.clearQuantification(projectId, selectedQuantificationId);
      await this.loadSelectedWorkbookPreview();
      this.loadingPanel.completeStep(loadingSessionId, 'parsing', this.t('boqPanel.previewUpdated'));
    } catch {
      this.loadingPanel.abort(loadingSessionId);
      this.workbookError = this.t('boqPanel.uploadWorkbookError');
    } finally {
      this.workbookUploadInProgress = false;
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, this.t('boqPanel.workbookImported'));
      }
      if (inputElement) {
        inputElement.value = '';
      }
      this.changeDetectorRef.detectChanges();
    }
  }

  // Allows users to switch between workbook sheets.
  seleccionarHoja(sheetName: string): void {
    if (!sheetName || sheetName === this.selectedSheetName) return;
    this.selectedSheetName = sheetName;
    void this.loadSelectedWorkbookPreview();
  }

  get selectedSheetIndex(): number | null {
    return this.workbookSheetIndexByName.get(this.selectedSheetName) ?? null;
  }

  onWorkbookCellSelected(event: {
    address: string;
    value: string;
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
    this.selectedWorkbookCellAddress = event.address;
    this.selectedWorkbookCellValue = event.value;
    this.selectedWorkbookCellFormula = event.formula;
    this.selectedWorkbookRowNumber = event.row;
    this.selectedWorkbookColumnNumber = event.col;
  }

  onWorkbookZoomRequested(direction: 'in' | 'out'): void {
    if (direction === 'in') {
      this.increaseSheetZoom();
      return;
    }
    this.decreaseSheetZoom();
  }

  // Registers a pending cell change for the currently selected sheet.
  applySelectedCellValueChange(): void {
    if (!this.selectedSheetName || !this.selectedWorkbookCellAddress) return;

    const sheetChanges = [...(this.pendingWorkbookCellChanges.get(this.selectedSheetName) ?? [])];
    const normalizedCellAddress = this.selectedWorkbookCellAddress.trim().toUpperCase();
    const existingChangeIndex = sheetChanges.findIndex(
      (cellChange) => (cellChange.address ?? '').trim().toUpperCase() === normalizedCellAddress,
    );
    const nextChange: WorkbookCellChangeOrm = {
      address: normalizedCellAddress,
      value: this.selectedWorkbookCellValue,
      type: 'inlineStr',
      formula: this.selectedWorkbookCellFormula.trim() || null,
    };

    if (existingChangeIndex >= 0) {
      sheetChanges[existingChangeIndex] = nextChange;
    } else {
      sheetChanges.push(nextChange);
    }

    this.pendingWorkbookCellChanges.set(this.selectedSheetName, sheetChanges);
    this.workbookInfoMessage = `${this.t('boqPanel.localChangeApplied')} ${normalizedCellAddress}.`;
  }

  // Applies a formula-only update to the selected cell and keeps current displayed value.
  applySelectedCellFormulaChange(): void {
    if (!this.selectedWorkbookCellAddress) return;
    this.applySelectedCellValueChange();
  }

  // Stages row height update in pixels for the selected row.
  applySelectedRowHeightChange(): void {
    if (!this.selectedSheetName || !this.selectedWorkbookRowNumber) return;
    const heightPixels = Number.parseFloat(this.selectedWorkbookRowHeightPx);
    if (!Number.isFinite(heightPixels) || heightPixels <= 0) {
      this.workbookError = this.t('boqPanel.invalidRowHeight');
      return;
    }
    const rowUpdates = this.pendingWorkbookRowLayoutChanges.get(this.selectedSheetName) ?? new Map<number, number>();
    rowUpdates.set(this.selectedWorkbookRowNumber, heightPixels);
    this.pendingWorkbookRowLayoutChanges.set(this.selectedSheetName, rowUpdates);
    this.workbookInfoMessage = `${this.t('boqPanel.pendingRowHeight')} ${this.selectedWorkbookRowNumber}.`;
  }

  // Stages column width update in pixels for the selected column.
  applySelectedColumnWidthChange(): void {
    if (!this.selectedSheetName || !this.selectedWorkbookColumnNumber) return;
    const widthPixels = Number.parseFloat(this.selectedWorkbookColumnWidthPx);
    if (!Number.isFinite(widthPixels) || widthPixels <= 0) {
      this.workbookError = this.t('boqPanel.invalidColumnWidth');
      return;
    }
    const columnUpdates =
      this.pendingWorkbookColumnLayoutChanges.get(this.selectedSheetName) ?? new Map<number, number>();
    columnUpdates.set(this.selectedWorkbookColumnNumber, widthPixels);
    this.pendingWorkbookColumnLayoutChanges.set(this.selectedSheetName, columnUpdates);
    this.workbookInfoMessage = `${this.t('boqPanel.pendingColumnWidth')} ${this.columnLabelFromIndex(this.selectedWorkbookColumnNumber - 1)}.`;
  }

  // Sends pending workbook cell changes to backend and refreshes the sheet preview.
  async saveWorkbookSheetChanges(): Promise<void> {
    const selectedQuantification = this.cuantificacionSeleccionada;
    const projectId = this.activeProject?.id ?? null;
    if (!selectedQuantification || !projectId || !this.selectedSheetName) return;

    const sheetIndex = this.workbookSheetIndexByName.get(this.selectedSheetName);
    if (sheetIndex == null) return;

    const sheetChanges = this.pendingWorkbookCellChanges.get(this.selectedSheetName) ?? [];
    const rowLayoutUpdates = this.pendingWorkbookRowLayoutChanges.get(this.selectedSheetName) ?? new Map<number, number>();
    const columnLayoutUpdates =
      this.pendingWorkbookColumnLayoutChanges.get(this.selectedSheetName) ?? new Map<number, number>();
    if (!sheetChanges.length && !rowLayoutUpdates.size && !columnLayoutUpdates.size) {
      this.workbookInfoMessage = this.t('boqPanel.noPendingChanges');
      return;
    }

    const loadingSessionId = this.loadingPanel.start(
      createWorkbookSavePlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.saveWorkbook')),
    );
    this.workbookSavingChanges = true;
    this.workbookError = '';
    this.workbookInfoMessage = '';
    try {
      const response = await firstValueFrom(
        this.backendProyectos.actualizarCeldasHojaExcelCuantificacion(
          projectId,
          selectedQuantification.id,
          sheetIndex,
          sheetChanges,
        ),
      );
      if (rowLayoutUpdates.size || columnLayoutUpdates.size) {
        await firstValueFrom(
          this.backendProyectos.actualizarLayoutHojaExcelCuantificacion(
            projectId,
            selectedQuantification.id,
            sheetIndex,
            [...rowLayoutUpdates.entries()].map(([rowNumber, heightPx]) => ({ row: rowNumber, heightPx })),
            [...columnLayoutUpdates.entries()].map(([columnNumber, widthPx]) => ({ col: columnNumber, widthPx })),
          ),
        );
      this.loadingPanel.completeStep(loadingSessionId, 'saving', this.t('boqPanel.savedChanges'));
      }
      this.replaceQuantificationRow(response.cuantificacion);
      this.workbookPreviewCache.clearQuantification(projectId, selectedQuantification.id);
      this.pendingWorkbookCellChanges.delete(this.selectedSheetName);
      this.pendingWorkbookRowLayoutChanges.delete(this.selectedSheetName);
      this.pendingWorkbookColumnLayoutChanges.delete(this.selectedSheetName);
      this.workbookInfoMessage = this.t('boqPanel.savedToWorkbook');
      await this.loadSelectedWorkbookPreview();
      this.loadingPanel.completeStep(loadingSessionId, 'refreshing', this.t('boqPanel.previewUpdated'));
    } catch {
      this.loadingPanel.abort(loadingSessionId);
      this.workbookError = this.t('boqPanel.saveWorkbookError');
    } finally {
      this.workbookSavingChanges = false;
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, this.t('boqPanel.savedChanges'));
      }
      this.changeDetectorRef.detectChanges();
    }
  }

  // Increases only the internal workbook preview zoom level.
  increaseSheetZoom(): void {
    this.sheetZoomPercent = Math.min(300, this.sheetZoomPercent + 10);
    this.sheetZoomInputValue = String(this.sheetZoomPercent);
    this.refreshSheetPreviewZoom();
  }

  // Decreases only the internal workbook preview zoom level.
  decreaseSheetZoom(): void {
    this.sheetZoomPercent = Math.max(20, this.sheetZoomPercent - 10);
    this.sheetZoomInputValue = String(this.sheetZoomPercent);
    this.refreshSheetPreviewZoom();
  }

  // Restores workbook preview zoom to default value.
  resetSheetZoom(): void {
    this.sheetZoomPercent = 100;
    this.sheetZoomInputValue = String(this.sheetZoomPercent);
    this.refreshSheetPreviewZoom();
  }

  // Updates zoom input text while user types.
  onSheetZoomInputValueChange(value: string): void {
    this.sheetZoomInputValue = value;
  }

  // Applies manual zoom value typed by the user.
  commitSheetZoomInput(): void {
    const numericValue = Number.parseInt(this.sheetZoomInputValue.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(numericValue)) {
      this.sheetZoomInputValue = String(this.sheetZoomPercent);
      return;
    }
    this.sheetZoomPercent = this.clamp(numericValue, 20, 300);
    this.sheetZoomInputValue = String(this.sheetZoomPercent);
    this.refreshSheetPreviewZoom();
  }

  get etiquetaTienePlantilla(): string {
    return this.cuantificacionSeleccionada?.tiene_libro_excel ? this.t('boqPanel.yes') : this.t('boqPanel.no');
  }

  get visibleQuantificationColumns(): TableColumnDefinition<CuantificacionB5DOrm>[] {
    return getVisibleColumns(this.quantificationTableColumns, this.quantificationTablePreferences);
  }

  get quantificationsForTable(): CuantificacionB5DOrm[] {
    return applyTableFilters(this.workQuantifications, this.quantificationTableColumns, this.quantificationTablePreferences);
  }

  get groupedQuantifications(): QuantificationGroupRow[] {
    const groupedRows = new Map<string, CuantificacionB5DOrm[]>();
    for (const quantification of this.quantificationsForTable) {
      const groupName = (quantification.grupo || '').trim() || this.t('boqPanel.noGroup');
      if (!groupedRows.has(groupName)) {
        groupedRows.set(groupName, []);
      }
      groupedRows.get(groupName)?.push(quantification);
    }

    return [...groupedRows.entries()]
      .map(([groupName, items]) => ({
        groupName,
        items: [...items].sort((firstItem, secondItem) =>
          (firstItem.nombre || '').localeCompare(secondItem.nombre || '', 'es', { sensitivity: 'base' }),
        ),
      }))
      .sort((firstGroup, secondGroup) => firstGroup.groupName.localeCompare(secondGroup.groupName, 'es', { sensitivity: 'base' }));
  }

  // Renders a file-type icon based on quantification type identifiers.
  getQuantificationTypeIcon(quantificationType: number | null): string {
    if (quantificationType === 1) return 'bi-journal-code';
    return 'bi-file-earmark-spreadsheet';
  }

  // Provides accessible text for quantification type icons.
  getQuantificationTypeLabel(quantificationType: number | null): string {
    if (quantificationType === 1) return this.t('boqPanel.option.scheme');
    return this.t('boqPanel.option.quantification');
  }

  // Formats backend UTC datetimes to a user-friendly local timestamp.
  formatQuantificationDate(rawDate: string | null): string {
    if (!rawDate) return '-';
    const parsedDate = new Date(rawDate);
    if (Number.isNaN(parsedDate.getTime())) return rawDate;

    const datePart = new Intl.DateTimeFormat('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(parsedDate);
    const timeParts = new Intl.DateTimeFormat('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).formatToParts(parsedDate);
    const hourValue = timeParts.find((part) => part.type === 'hour')?.value ?? '00';
    const minuteValue = timeParts.find((part) => part.type === 'minute')?.value ?? '00';
    const secondValue = timeParts.find((part) => part.type === 'second')?.value ?? '00';
    const periodRawValue = timeParts.find((part) => part.type === 'dayPeriod')?.value.toLowerCase() ?? 'a. m.';
    const normalizedPeriod = periodRawValue.includes('p') ? 'p. m.' : 'a. m.';

    return `${datePart} ${hourValue}:${minuteValue}:${secondValue} ${normalizedPeriod}`;
  }

  startBoqPanelOrderDrag(panelId: 'list' | 'preview', event: DragEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.draggedPanelOrderId = panelId;
    this.panelOrderDragTargetId = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', panelId);
    }
  }

  onBoqPanelOrderDragOver(targetPanelId: 'list' | 'preview', event: DragEvent): void {
    event.preventDefault();
    const draggedPanelId = this.draggedPanelOrderId;
    if (!draggedPanelId || draggedPanelId === targetPanelId) return;
    if (this.panelOrderDragTargetId === targetPanelId) return;

    this.panelOrderDragTargetId = targetPanelId;
    this.panelOrder = swapPanelOrder([this.panelOrder[0], this.panelOrder[1]] as const);
    this.changeDetectorRef.detectChanges();
  }

  endBoqPanelOrderDrag(): void {
    this.draggedPanelOrderId = null;
    this.panelOrderDragTargetId = null;
  }

  // Returns the grid column assigned to the BOQ layout.
  get layoutTemplateColumns(): string {
    return `${this.leftPanelWidth}px 8px minmax(0, 1fr)`;
  }

  // Returns the zoom factor used by the BOQ list panel.
  getListZoomFactor(): number {
    return clampPanelPercent(this.listZoomPercent) / 100;
  }

  // Applies mouse-wheel zoom on the BOQ list pane.
  onListZoomWheel(event: WheelEvent): void {
    handlePanelZoomWheel(
      event,
      () => this.increaseListZoom(),
      () => this.decreaseListZoom(),
    );
  }

  // Increases only the BOQ list zoom level.
  increaseListZoom(): void {
    this.listZoomPercent = stepPanelPercent(this.listZoomPercent, 10);
    this.changeDetectorRef.detectChanges();
  }

  // Decreases only the BOQ list zoom level.
  decreaseListZoom(): void {
    this.listZoomPercent = stepPanelPercent(this.listZoomPercent, -10);
    this.changeDetectorRef.detectChanges();
  }

  // Restores the BOQ list zoom to default value.
  resetListZoom(): void {
    this.listZoomPercent = 100;
    this.changeDetectorRef.detectChanges();
  }

  resetTableViews(): void {
    this.leftPanelWidth = 420;
    this.panelOrder = ['list', 'preview'];
    this.resetQuantificationTablePreferences();
    this.resetQuantificationTableWidths();
    this.listZoomPercent = 100;
    this.resetSheetZoom();
  }

  openBoqTableContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.boqTableContextMenuVisible = true;
    this.boqTableContextMenuX = event.clientX;
    this.boqTableContextMenuY = event.clientY;
  }

  closeBoqTableContextMenu(): void {
    this.boqTableContextMenuVisible = false;
  }

  handleBoqTableContextMenuAction(action: 'chooser' | 'filters' | 'best-fit' | 'reset'): void {
    if (action === 'chooser') {
      this.toggleQuantificationTableChooser();
    } else if (action === 'filters') {
      this.toggleQuantificationFiltersVisible();
    } else if (action === 'best-fit') {
      this.resetQuantificationTableWidths();
    } else if (action === 'reset') {
      this.resetTableViews();
    }
    this.closeBoqTableContextMenu();
  }

  toggleQuantificationTableChooser(): void {
    this.quantificationTablePreferences.chooserOpen = !this.quantificationTablePreferences.chooserOpen;
    if (this.quantificationTablePreferences.chooserOpen) {
      this.ensureQuantificationColumnChooserPosition();
    }
    this.persistQuantificationTablePreferences();
  }

  closeQuantificationTableChooser(): void {
    if (!this.quantificationTablePreferences.chooserOpen) return;
    this.quantificationTablePreferences.chooserOpen = false;
    this.persistQuantificationTablePreferences();
  }

  toggleQuantificationFiltersVisible(): void {
    this.tableFiltersVisible = !this.tableFiltersVisible;
    this.toolbarStateChange.emit({
      activeBottomTab: 'boq',
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
      tableFiltersVisible: this.tableFiltersVisible,
    });
  }

  isQuantificationTableColumnVisible(columnKey: string): boolean {
    return !this.quantificationTablePreferences.hidden.includes(columnKey);
  }

  toggleQuantificationTableColumnVisibility(columnKey: string): void {
    toggleTableColumnVisibility(this.quantificationTablePreferences, columnKey);
    this.persistQuantificationTablePreferences();
    this.boqTableRefreshToken += 1;
  }

  startQuantificationColumnChooserDrag(event: PointerEvent): void {
    if (!this.quantificationTablePreferences.chooserOpen) return;
    if (event.button !== 0 || typeof window === 'undefined') return;

    this.ensureQuantificationColumnChooserPosition();
    event.preventDefault();
    event.stopPropagation();

    const offsetX = event.clientX - this.quantificationColumnChooserLeft;
    const offsetY = event.clientY - this.quantificationColumnChooserTop;

    startPointerDrag(event, (moveEvent) => {
      const maxLeft = Math.max(16, window.innerWidth - this.quantificationColumnChooserWidth - 16);
      const maxTop = Math.max(76, window.innerHeight - 120);
      this.quantificationColumnChooserLeft = this.clamp(moveEvent.clientX - offsetX, 16, maxLeft);
      this.quantificationColumnChooserTop = this.clamp(moveEvent.clientY - offsetY, 76, maxTop);
      this.changeDetectorRef.detectChanges();
    });
  }

  onQuantificationColumnDragStart(columnKey: string, event: DragEvent): void {
    this.quantificationColumnDragKey = columnKey;
    event.dataTransfer?.setData('text/plain', columnKey);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onQuantificationColumnDragOver(columnKey: string, event: DragEvent): void {
    event.preventDefault();
    const draggedColumnKey = this.quantificationColumnDragKey;
    if (!draggedColumnKey || draggedColumnKey === columnKey) return;

    const targetElement = event.currentTarget as HTMLElement | null;
    const targetRect = targetElement?.getBoundingClientRect();
    const beforeTarget = targetRect ? event.clientY < targetRect.top + targetRect.height / 2 : true;
    const targetIndex = this.quantificationTablePreferences.order.indexOf(columnKey);
    if (targetIndex < 0) return;

    const nextIndex = beforeTarget ? targetIndex : targetIndex + 1;
    moveTableColumn(this.quantificationTablePreferences, draggedColumnKey, nextIndex);
    this.persistQuantificationTablePreferences();
    this.boqTableRefreshToken += 1;
  }

  onQuantificationColumnDragEnd(): void {
    this.quantificationColumnDragKey = null;
  }

  getQuantificationFilterModes(columnKey: string): ReturnType<typeof getFilterModesForKind> {
    const column = this.quantificationTableColumns.find((columnItem) => columnItem.key === columnKey);
    return column ? getFilterModesForKind(column.kind) : getFilterModesForKind('text');
  }

  getQuantificationFilterMode(columnKey: string): string {
    return this.quantificationTablePreferences.filters[columnKey]?.mode ?? 'contains';
  }

  getQuantificationFilterValue(columnKey: string): string {
    return this.quantificationTablePreferences.filters[columnKey]?.value ?? '';
  }

  setQuantificationFilterMode(columnKey: string, mode: string): void {
    setTableFilterMode(this.quantificationTablePreferences, columnKey, mode as never);
    this.persistQuantificationTablePreferences();
  }

  setQuantificationFilterValue(columnKey: string, value: string): void {
    setTableFilterValue(this.quantificationTablePreferences, columnKey, value);
    this.persistQuantificationTablePreferences();
  }

  isQuantificationTableLastColumn(columnKey: string): boolean {
    return this.visibleQuantificationColumns.at(-1)?.key === columnKey;
  }

  async saveQuantificationRow(quantificationRow: CuantificacionB5DOrm): Promise<void> {
    if (!this.activeProject) return;
    if (this.savingQuantificationRowById.has(quantificationRow.id)) return;
    this.savingQuantificationRowById.add(quantificationRow.id);
    try {
      const updated = await firstValueFrom(
        this.backendProyectos.actualizarCuantificacion(this.activeProject.id, quantificationRow.id, {
          nombre: quantificationRow.nombre ?? null,
          descripcion: quantificationRow.descripcion ?? null,
          comentarios: quantificationRow.comentarios ?? null,
          grupo: quantificationRow.grupo ?? null,
          tipo: quantificationRow.tipo ?? null,
          calculada: quantificationRow.calculada,
        }),
      );
      this.workQuantifications = this.workQuantifications.map((quantification) =>
        quantification.id === updated.id ? { ...quantification, ...updated } : quantification,
      );
      this.replaceQuantificationRow(updated);
      this.workbookPreviewCache.clearQuantification(this.activeProject.id, updated.id);
    } catch {
      this.workbookError = this.t('boqPanel.saveQuantificationError');
    } finally {
      this.savingQuantificationRowById.delete(quantificationRow.id);
    }
  }

  // Keeps the quantification list in sync after upload/save operations.
  private replaceQuantificationRow(updatedQuantification: CuantificacionB5DOrm): void {
    this.workQuantifications = this.workQuantifications.map((quantification) =>
      quantification.id === updatedQuantification.id
        ? {
            ...quantification,
            ...updatedQuantification,
          }
        : quantification,
    );
  }

  private syncQuantificationTablePreferences(): void {
    ensureTablePreferencesColumns(this.quantificationTablePreferences, this.quantificationTableColumns);
    this.persistQuantificationTablePreferences();
  }

  private restoreQuantificationTablePreferences(): void {
    const storageKey = this.quantificationTableStorageKey;
    if (storageKey === this.lastAppliedStorageScopeKey) return;

    this.lastAppliedStorageScopeKey = storageKey;
    this.quantificationTablePreferences = loadTableViewPreferences(storageKey, this.quantificationTableDefaults);
    ensureTablePreferencesColumns(this.quantificationTablePreferences, this.quantificationTableColumns);
  }

  private persistQuantificationTablePreferences(): void {
    saveTableViewPreferences(this.quantificationTableStorageKey, this.quantificationTablePreferences);
  }

  get quantificationTableResizableStorageKey(): string {
    return this.quantificationTableStorageKey;
  }

  private get quantificationTableStorageKey(): string {
    return buildScopedStorageKey(this.quantificationTableStorageKeyBase, this.storageScopeKey);
  }

  resetQuantificationTablePreferences(): void {
    resetTableViewPreferences(this.quantificationTablePreferences, this.quantificationTableDefaults);
    this.persistQuantificationTablePreferences();
    this.boqTableRefreshToken += 1;
  }

  resetQuantificationTableWidths(): void {
    getSafeLocalStorage()?.removeItem(`b5d-resizable-table:${this.quantificationTableResizableStorageKey}`);
    this.boqTableRefreshToken += 1;
  }

  private ensureQuantificationColumnChooserPosition(): void {
    if (this.quantificationColumnChooserPositionReady || typeof window === 'undefined') return;
    this.quantificationColumnChooserLeft = Math.max(16, window.innerWidth - this.quantificationColumnChooserWidth - 24);
    this.quantificationColumnChooserTop = 120;
    this.quantificationColumnChooserPositionReady = true;
  }

  // Recomputes the preview view after zoom controls change the scale.
  private refreshSheetPreviewZoom(): void {
    this.changeDetectorRef.detectChanges();
  }

  // Resizes BOQ list and preview panels while dragging the vertical splitter.
  startInternalResize(event: PointerEvent): void {
    const parentElement = (event.currentTarget as HTMLElement | null)?.parentElement;
    if (!parentElement) return;

    const startX = event.clientX;
    const initialWidth = this.leftPanelWidth;
    const parentWidth = parentElement.clientWidth;
    startPointerDrag(event, (moveEvent) => {
      const splitterSize = 8;
      const minimumLeftPanelWidth = 260;
      const minimumRightPanelWidth = 360;
      const maximumLeftPanelWidth = parentWidth - minimumRightPanelWidth - splitterSize;
      this.leftPanelWidth = Math.min(
        Math.max(initialWidth + (moveEvent.clientX - startX), minimumLeftPanelWidth),
        Math.max(minimumLeftPanelWidth, maximumLeftPanelWidth),
      );
      this.changeDetectorRef.detectChanges();
    });
  }

  // Converts a zero-based column index into the Excel-style column label.
  private columnLabelFromIndex(columnIndex: number): string {
    let value = columnIndex + 1;
    let label = '';
    while (value > 0) {
      const modulo = (value - 1) % 26;
      label = String.fromCharCode(65 + modulo) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  }

  // Parses workbook bytes and renders selected sheet HTML in the right panel.
  private async loadSelectedWorkbookPreview(): Promise<void> {
    const selection = this.cuantificacionSeleccionada;
    const localToken = ++this.workbookLoadToken;
    const previouslySelectedSheetName = this.selectedSheetName;

    this.workbookLoading = true;
    this.workbookError = '';
    this.workbookInfoMessage = '';
    this.workbookSheets = [];
    this.selectedSheetName = '';

    if (!selection) {
      this.workbookLoading = false;
      return;
    }

    if (!selection.tiene_libro_excel) {
      this.workbookLoading = false;
      return;
    }

    try {
      const projectId = this.activeProject?.id ?? null;
      if (!projectId) return;
      const workbookSummary = await this.workbookPreviewCache.getWorkbookSummary(projectId, selection.id);
      if (localToken !== this.workbookLoadToken) return;
      if (!workbookSummary.sheets.length) {
        this.workbookError = this.t('boqPanel.noVisibleSheets');
        return;
      }

      this.workbookSheetIndexByName = new Map<string, number>();
      for (const sheetDescriptor of workbookSummary.sheets) {
        this.workbookSheetIndexByName.set(sheetDescriptor.name, sheetDescriptor.index);
      }
      this.workbookSheets = workbookSummary.sheets.map((sheetDescriptor) => sheetDescriptor.name);
      const targetSheetName = this.workbookSheets.includes(previouslySelectedSheetName)
        ? previouslySelectedSheetName
        : this.workbookSheets[0];
      this.selectedSheetName = targetSheetName;
    } catch {
      if (localToken === this.workbookLoadToken) {
        this.workbookError = this.t('boqPanel.readWorkbookError');
      }
    } finally {
      if (localToken === this.workbookLoadToken) {
        this.workbookLoading = false;
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  private clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(maxValue, Math.max(minValue, value));
  }
}
