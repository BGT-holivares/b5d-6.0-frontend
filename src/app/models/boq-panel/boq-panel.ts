import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { BackendProyectosService } from '../../services/backend-proyectos.service';
import { WorkbookPreviewCacheService } from '../../services/workbook-preview-cache.service';
import { buildWorkbookPreviewDocument } from '../../services/workbook-preview-document.util';
import { ResizableTableDirective } from '../../directives/resizable-table/resizable-table.directive';
import { WorkbookPreview } from '../workbook-preview/workbook-preview';
import type {
  CuantificacionB5DOrm,
  ProyectoTrabajoOrm,
  WorkbookCellChangeOrm,
  WorkbookCellOrm,
  WorkbookImageOrm,
  WorkbookLayersOrm,
  WorkbookStyleOrm,
  WorkbookSummarySheetOrm,
} from '../../types/b5d-orm';

type QuantificationGroupRow = {
  groupName: string;
  items: CuantificacionB5DOrm[];
};

type WorksheetBounds = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

type WorkbookVisualContext = {
  cellStyleIdByAddress: Map<string, number>;
  rowStyleIdByRow: Map<number, number>;
  columnStyleRanges: Array<{ startColumn: number; endColumn: number; styleId: number }>;
  styleCssById: Map<number, string>;
  floatingImagesHtml: string[];
};

@Component({
  selector: 'app-boq-panel',
  imports: [ResizableTableDirective, WorkbookPreview],
  templateUrl: './boq-panel.html',
  styleUrl: './boq-panel.scss',
})
export class BoqPanel implements OnChanges, OnDestroy {
  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Input() cuantificacionesB5d: CuantificacionB5DOrm[] = [];
  @Input() b5dLoading = false;

  leftPanelWidth = 420;
  cuantificacionSeleccionadaId: number | null = null;
  workbookLoading = false;
  workbookUploadInProgress = false;
  workbookSavingChanges = false;
  workbookError = '';
  workbookInfoMessage = '';
  workbookSheets: string[] = [];
  selectedSheetName = '';
  selectedSheetHtml = '';
  selectedSheetDocument = '';
  sheetPreviewUrl: SafeResourceUrl;
  sheetZoomPercent = 100;
  sheetZoomInputValue = '100';
  sheetFrameMode: 'sandboxed' | 'unsandboxed' = 'sandboxed';
  workbookDebugEnabled = false;
  workbookDebugOutput = '';

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly backendProyectos = inject(BackendProyectosService);
  private readonly workbookPreviewCache = inject(WorkbookPreviewCacheService);
  private readonly domSanitizer = inject(DomSanitizer);
  private workbookLoadToken = 0;
  private workbookVisualContext: WorkbookVisualContext | null = null;
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
  private currentSheetBlobUrl: string | null = null;
  private sheetInteractionToken = '';
  private sheetFrameReady = false;
  private sheetFrameReadyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastWorkbookLayerSummary: Record<string, unknown> | null = null;
  private lastWorkbookImageLoadSummary: Record<string, unknown> | null = null;
  private lastSelectedCellRenderSummary: Record<string, unknown> | null = null;
  private lastWorkbookStylesById: Record<string, WorkbookStyleOrm> = {};
  private readonly workbookImageDataUriCache = new Map<string, string>();
  private readonly workbookImageCacheStoragePrefix = 'b5d-workbook-image:';
  private readonly sheetFrameMessageHandler = (event: MessageEvent): void => {
    const messageData = event.data as Record<string, unknown> | null;
    if (!messageData) return;

    if (messageData['type'] === 'b5d-sheet-ready') {
      if (messageData['token'] !== this.sheetInteractionToken) return;
      this.sheetFrameReady = true;
      this.clearSheetFrameReadyTimeout();
      return;
    }

    if (messageData['type'] === 'b5d-cell-selected') {
      if (messageData['token'] !== this.sheetInteractionToken) return;
      const selectedCellAddress = typeof messageData['address'] === 'string' ? messageData['address'] : '';
      const selectedCellValue = typeof messageData['value'] === 'string' ? messageData['value'] : '';
      const selectedCellFormula = typeof messageData['formula'] === 'string' ? messageData['formula'] : '';
      this.selectedWorkbookCellAddress = selectedCellAddress;
      this.selectedWorkbookCellValue = selectedCellValue;
      this.selectedWorkbookCellFormula = selectedCellFormula;
      const parsedCellAddress = this.parseCellAddress(selectedCellAddress);
      this.selectedWorkbookRowNumber = parsedCellAddress?.row ?? null;
      this.selectedWorkbookColumnNumber = parsedCellAddress?.col ?? null;
      this.lastSelectedCellRenderSummary = {
        cellClassName: typeof messageData['cellClassName'] === 'string' ? messageData['cellClassName'] : '',
        cellInlineStyle: typeof messageData['cellInlineStyle'] === 'string' ? messageData['cellInlineStyle'] : '',
        computedBackgroundColor:
          typeof messageData['computedBackgroundColor'] === 'string' ? messageData['computedBackgroundColor'] : '',
        computedColor: typeof messageData['computedColor'] === 'string' ? messageData['computedColor'] : '',
        computedTextAlign: typeof messageData['computedTextAlign'] === 'string' ? messageData['computedTextAlign'] : '',
        computedFontWeight: typeof messageData['computedFontWeight'] === 'string' ? messageData['computedFontWeight'] : '',
      };
      if (this.workbookDebugEnabled) {
        this.refreshWorkbookDebugOutput();
      }
      this.changeDetectorRef.detectChanges();
      return;
    }

    if (messageData['type'] !== 'b5d-sheet-zoom') return;
    if (messageData['token'] !== this.sheetInteractionToken) return;

    const direction = messageData['direction'];
    if (direction === 'in') {
      this.increaseSheetZoom();
      return;
    }
    if (direction === 'out') {
      this.decreaseSheetZoom();
    }
  };

  constructor() {
    this.sheetPreviewUrl = this.domSanitizer.bypassSecurityTrustResourceUrl(
      'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Cbody%3E%3C/body%3E%3C/html%3E',
    );
    window.addEventListener('message', this.sheetFrameMessageHandler);
  }

  // Keeps selection and workbook preview synchronized when backend rows change.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cuantificacionesB5d']) {
      const selectedId = this.cuantificacionSeleccionadaId;
      const selectedStillExists = selectedId != null && this.cuantificacionesB5d.some((item) => item.id === selectedId);
      if (!selectedStillExists) {
        this.cuantificacionSeleccionadaId = this.cuantificacionesB5d[0]?.id ?? null;
      }
      void this.loadSelectedWorkbookPreview();
    }
  }

  ngOnDestroy(): void {
    this.clearSheetFrameReadyTimeout();
    window.removeEventListener('message', this.sheetFrameMessageHandler);
    this.releaseSheetBlobUrl();
  }

  get cuantificacionSeleccionada(): CuantificacionB5DOrm | null {
    if (this.cuantificacionSeleccionadaId == null) {
      return this.cuantificacionesB5d[0] ?? null;
    }
    return this.cuantificacionesB5d.find((item) => item.id === this.cuantificacionSeleccionadaId) ?? null;
  }

  seleccionarCuantificacion(id: number): void {
    this.cuantificacionSeleccionadaId = id;
    void this.loadSelectedWorkbookPreview();
  }

  // Opens the local file picker to upload a replacement workbook.
  openWorkbookUploadDialog(fileInput: HTMLInputElement): void {
    if (this.workbookUploadInProgress) return;
    fileInput.value = '';
    fileInput.click();
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
      this.workbookError = 'Solo se permiten archivos .xlsx o .xlsm.';
      return;
    }

    this.workbookUploadInProgress = true;
    this.workbookError = '';
    try {
      const updatedQuantification = await firstValueFrom(
        this.backendProyectos.subirLibroExcelCuantificacion(projectId, selectedQuantificationId, selectedFile),
      );
      this.replaceQuantificationRow(updatedQuantification);
      this.clearWorkbookImageCacheForQuantification(projectId, selectedQuantificationId);
      this.workbookPreviewCache.clearQuantification(projectId, selectedQuantificationId);
      await this.loadSelectedWorkbookPreview();
    } catch {
      this.workbookError = 'No se pudo subir el archivo Excel de esta cuantificacion.';
    } finally {
      this.workbookUploadInProgress = false;
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

  // Enables or disables temporary diagnostics for workbook endpoint and style resolution checks.
  toggleWorkbookDebug(): void {
    this.workbookDebugEnabled = !this.workbookDebugEnabled;
    this.refreshWorkbookDebugOutput();
  }

  // Calls workbook layer endpoints and prints a consolidated temporary diagnostic report.
  async runWorkbookEndpointDebug(): Promise<void> {
    const projectId = this.activeProject?.id ?? null;
    const selectedQuantification = this.cuantificacionSeleccionada;
    const sheetIndex = this.workbookSheetIndexByName.get(this.selectedSheetName ?? '');
    if (!projectId || !selectedQuantification || sheetIndex == null) return;

    try {
      const [cellsLayer, layoutLayer, stylesLayer, mergesLayer, imagesLayer] = await Promise.all([
        firstValueFrom(
          this.backendProyectos.obtenerCeldasHojaExcelCuantificacion(projectId, selectedQuantification.id, sheetIndex),
        ),
        firstValueFrom(
          this.backendProyectos.obtenerLayoutHojaExcelCuantificacion(projectId, selectedQuantification.id, sheetIndex),
        ),
        firstValueFrom(
          this.backendProyectos.obtenerEstilosHojaExcelCuantificacion(projectId, selectedQuantification.id, sheetIndex),
        ),
        firstValueFrom(
          this.backendProyectos.obtenerMergesHojaExcelCuantificacion(projectId, selectedQuantification.id, sheetIndex),
        ),
        firstValueFrom(
          this.backendProyectos.obtenerImagenesHojaExcelCuantificacion(projectId, selectedQuantification.id, sheetIndex),
        ),
      ]);

      const endpointDebugSummary = {
        endpoint: {
          projectId,
          quantificationId: selectedQuantification.id,
          sheetIndex,
          sheetName: this.selectedSheetName,
        },
        cellsCount: cellsLayer.cells.length,
        stylesCount: Object.keys(stylesLayer.styles ?? {}).length,
        mergesCount: mergesLayer.merges.length,
        imagesCount: imagesLayer.images.length,
        rowsWithLayout: layoutLayer.layout.rows.length,
        columnsWithLayout: layoutLayer.layout.columns.length,
      };
      console.info('[BOQ XLSX DEBUG] endpoint-summary', endpointDebugSummary);
      this.workbookInfoMessage = 'Debug de endpoints generado en consola.';
      this.refreshWorkbookDebugOutput(endpointDebugSummary);
    } catch (error) {
      console.error('[BOQ XLSX DEBUG] endpoint-summary-error', error);
      this.workbookError = 'No se pudo generar el debug de endpoints.';
    }
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
    this.workbookInfoMessage = `Cambio local aplicado en ${normalizedCellAddress}.`;
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
      this.workbookError = 'La altura de fila debe ser numerica y mayor a 0.';
      return;
    }
    const rowUpdates = this.pendingWorkbookRowLayoutChanges.get(this.selectedSheetName) ?? new Map<number, number>();
    rowUpdates.set(this.selectedWorkbookRowNumber, heightPixels);
    this.pendingWorkbookRowLayoutChanges.set(this.selectedSheetName, rowUpdates);
    this.workbookInfoMessage = `Altura pendiente para fila ${this.selectedWorkbookRowNumber}.`;
  }

  // Stages column width update in pixels for the selected column.
  applySelectedColumnWidthChange(): void {
    if (!this.selectedSheetName || !this.selectedWorkbookColumnNumber) return;
    const widthPixels = Number.parseFloat(this.selectedWorkbookColumnWidthPx);
    if (!Number.isFinite(widthPixels) || widthPixels <= 0) {
      this.workbookError = 'El ancho de columna debe ser numerico y mayor a 0.';
      return;
    }
    const columnUpdates =
      this.pendingWorkbookColumnLayoutChanges.get(this.selectedSheetName) ?? new Map<number, number>();
    columnUpdates.set(this.selectedWorkbookColumnNumber, widthPixels);
    this.pendingWorkbookColumnLayoutChanges.set(this.selectedSheetName, columnUpdates);
    this.workbookInfoMessage = `Ancho pendiente para columna ${this.columnLabelFromIndex(this.selectedWorkbookColumnNumber - 1)}.`;
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
      this.workbookInfoMessage = 'No hay cambios pendientes por guardar.';
      return;
    }

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
      }
      this.replaceQuantificationRow(response.cuantificacion);
      this.clearWorkbookImageCacheForQuantification(projectId, selectedQuantification.id);
      this.workbookPreviewCache.clearQuantification(projectId, selectedQuantification.id);
      this.pendingWorkbookCellChanges.delete(this.selectedSheetName);
      this.pendingWorkbookRowLayoutChanges.delete(this.selectedSheetName);
      this.pendingWorkbookColumnLayoutChanges.delete(this.selectedSheetName);
      this.workbookInfoMessage = 'Cambios guardados en LibroExcel.';
      await this.loadSelectedWorkbookPreview();
    } catch {
      this.workbookError = 'No fue posible guardar los cambios de la hoja Excel.';
    } finally {
      this.workbookSavingChanges = false;
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
    return this.cuantificacionSeleccionada?.tiene_libro_excel ? 'Si' : 'No';
  }

  get groupedQuantifications(): QuantificationGroupRow[] {
    const groupedRows = new Map<string, CuantificacionB5DOrm[]>();
    for (const quantification of this.cuantificacionesB5d) {
      const groupName = (quantification.grupo || '').trim() || 'Sin grupo';
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
    if (quantificationType === 1) return 'Esquema de cuantificacion';
    return 'Cuantificacion';
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

  get layoutTemplateColumns(): string {
    return `${this.leftPanelWidth}px 8px minmax(0, 1fr)`;
  }

  // Resizes BOQ list and preview panels while dragging the vertical splitter.
  startInternalResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    const parentElement = (event.currentTarget as HTMLElement | null)?.parentElement;
    if (!parentElement) return;

    event.preventDefault();
    const startX = event.clientX;
    const initialWidth = this.leftPanelWidth;
    const parentWidth = parentElement.clientWidth;

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const splitterSize = 8;
      const minimumLeftPanelWidth = 260;
      const minimumRightPanelWidth = 360;
      const maximumLeftPanelWidth = parentWidth - minimumRightPanelWidth - splitterSize;
      this.leftPanelWidth = this.clamp(
        initialWidth + (moveEvent.clientX - startX),
        minimumLeftPanelWidth,
        Math.max(minimumLeftPanelWidth, maximumLeftPanelWidth),
      );
      this.changeDetectorRef.detectChanges();
    };

    const stopResizing = (): void => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResizing, { once: true });
  }

  // Parses workbook bytes and renders selected sheet HTML in the right panel.
  private async loadSelectedWorkbookPreview(): Promise<void> {
    const selection = this.cuantificacionSeleccionada;
    let workbookPayload = this.getWorkbookPayload(selection);
    let workbookBytesFromBackend: Uint8Array | null = null;
    const localToken = ++this.workbookLoadToken;
    const previouslySelectedSheetName = this.selectedSheetName;

    this.workbookLoading = true;
    this.workbookError = '';
    this.workbookInfoMessage = '';
    this.workbookSheets = [];
    this.selectedSheetName = '';
    this.selectedSheetHtml = '';
    this.selectedSheetDocument = '';
    this.selectedWorkbookCellAddress = '';
    this.selectedWorkbookCellValue = '';
    this.selectedWorkbookCellFormula = '';
    this.selectedWorkbookRowNumber = null;
    this.selectedWorkbookColumnNumber = null;
    this.selectedWorkbookRowHeightPx = '';
    this.selectedWorkbookColumnWidthPx = '';
    this.workbookVisualContext = null;
    this.lastWorkbookLayerSummary = null;
    this.lastWorkbookImageLoadSummary = null;
    this.lastSelectedCellRenderSummary = null;
    this.lastWorkbookStylesById = {};
    this.sheetFrameMode = 'sandboxed';
    this.sheetFrameReady = false;
    this.clearSheetFrameReadyTimeout();
    this.updateSheetPreviewUrl('');

    if (!selection) {
      this.workbookLoading = false;
      return;
    }

    const loadedFromLayers = await this.tryLoadWorkbookPreviewFromLayers(selection, previouslySelectedSheetName, localToken);
    if (loadedFromLayers) {
      this.workbookLoading = false;
      this.changeDetectorRef.detectChanges();
      return;
    }

    if (!workbookPayload && selection.tiene_libro_excel) {
      const backendWorkbook = await this.hydrateWorkbookFromBackend(selection);
      workbookPayload = backendWorkbook.payload;
      workbookBytesFromBackend = backendWorkbook.bytes;
    }

    if (!workbookPayload && !workbookBytesFromBackend) {
      this.workbookLoading = false;
      if (selection.tiene_libro_excel) {
        this.workbookError = 'La cuantificacion indica libro Excel, pero no se recibio contenido para previsualizar.';
      }
      return;
    }

    try {
      const workbookBytes = workbookBytesFromBackend ?? this.decodeWorkbookPayload(workbookPayload as string);
      const xlsxModule = await import('xlsx');
      let workbook: ReturnType<typeof xlsxModule.read>;
      try {
        workbook = xlsxModule.read(workbookBytes, { type: 'array', cellStyles: true, cellHTML: true, bookFiles: true });
      } catch {
        workbook = xlsxModule.read(workbookBytes, { type: 'array', bookFiles: true });
      }
      const sheetNames = workbook.SheetNames ?? [];

      if (localToken !== this.workbookLoadToken) return;
      if (!sheetNames.length) {
        this.workbookError = 'El libro Excel no contiene hojas visibles para mostrar.';
        return;
      }

      this.workbookSheets = sheetNames;
      const targetSheetName = this.workbookSheets.includes(previouslySelectedSheetName)
        ? previouslySelectedSheetName
        : this.workbookSheets[0];
      this.selectedSheetName = targetSheetName;
      const targetSheet = workbook.Sheets[targetSheetName];
      if (targetSheet) {
        this.workbookVisualContext = this.buildWorkbookVisualContext(
          workbook as unknown as Record<string, unknown>,
          targetSheetName,
          targetSheet as Record<string, unknown>,
          workbookBytes,
          xlsxModule,
        );
        try {
          this.selectedSheetHtml = this.renderWorksheetGridHtml(targetSheet, xlsxModule);
        } catch {
          this.selectedSheetHtml = xlsxModule.utils.sheet_to_html(targetSheet, { editable: false, id: 'b5d-xlsx-preview' });
        }
      } else {
        this.selectedSheetHtml = '';
      }
      this.sheetInteractionToken = this.generateInteractionToken();
      this.selectedSheetDocument = this.buildSheetPreviewDocument(this.selectedSheetHtml, this.sheetInteractionToken);
      this.updateSheetPreviewUrl(this.selectedSheetDocument);
      this.armSheetFrameReadyWatchdog();
      this.refreshWorkbookDebugOutput();

      if (!this.selectedSheetHtml) {
        this.workbookError = 'No fue posible renderizar la hoja seleccionada.';
      }
    } catch {
      if (localToken === this.workbookLoadToken) {
        this.workbookError = 'No se pudo leer el contenido Excel de esta cuantificacion.';
      }
    } finally {
      if (localToken === this.workbookLoadToken) {
        this.workbookLoading = false;
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  // Uses backend workbook layers (cells/layout/styles/merges/images) as primary BOQ preview source.
  private async tryLoadWorkbookPreviewFromLayers(
    selection: CuantificacionB5DOrm,
    previouslySelectedSheetName: string,
    localToken: number,
  ): Promise<boolean> {
    if (!selection.tiene_libro_excel) return false;
    const projectId = this.activeProject?.id ?? null;
    if (!projectId) return false;

    try {
      const workbookSummary = await this.workbookPreviewCache.getWorkbookSummary(projectId, selection.id);
      if (localToken !== this.workbookLoadToken) return false;
      if (!workbookSummary.sheets.length) return false;

      this.workbookSheetIndexByName = new Map<string, number>();
      for (const sheetDescriptor of workbookSummary.sheets) {
        this.workbookSheetIndexByName.set(sheetDescriptor.name, sheetDescriptor.index);
      }
      this.workbookSheets = workbookSummary.sheets.map((sheetDescriptor) => sheetDescriptor.name);

      const targetSheetName = this.workbookSheets.includes(previouslySelectedSheetName)
        ? previouslySelectedSheetName
        : this.workbookSheets[0];
      this.selectedSheetName = targetSheetName;
      const targetSheetIndex = this.workbookSheetIndexByName.get(targetSheetName);
      if (targetSheetIndex == null) return false;

      const sheetLayers = await this.workbookPreviewCache.getWorkbookSheetLayers(projectId, selection.id, targetSheetIndex);
      if (localToken !== this.workbookLoadToken) return false;
      this.lastWorkbookLayerSummary = {
        sheetName: sheetLayers.sheet.name,
        sheetIndex: sheetLayers.sheet.index,
        cellsCount: sheetLayers.cells.length,
        mergesCount: sheetLayers.merges.length,
        stylesCount: Object.keys(sheetLayers.styles ?? {}).length,
        imagesCount: sheetLayers.images.length,
        layoutRowsCount: sheetLayers.layout.rows.length,
        layoutColumnsCount: sheetLayers.layout.columns.length,
      };
      this.lastWorkbookStylesById = sheetLayers.styles ?? {};
      const sheetWorksheet = this.buildWorksheetFromWorkbookLayers(sheetLayers);
      if (!sheetWorksheet) return false;
      const imageDataUriById = await this.loadWorkbookImageDataUris(
        projectId,
        selection.id,
        targetSheetIndex,
        sheetLayers.images,
      );

      const cellStyleIdByAddress = new Map<string, number>();
      for (const cellData of sheetLayers.cells) {
        if (!cellData.address || cellData.styleId == null) continue;
        cellStyleIdByAddress.set(cellData.address, cellData.styleId);
      }

      const rowStyleIdByRow = new Map<number, number>();
      for (const rowDefinition of sheetLayers.layout.rows) {
        if (rowDefinition.styleId == null) continue;
        rowStyleIdByRow.set(rowDefinition.row, rowDefinition.styleId);
      }

      const columnStyleRanges: Array<{ startColumn: number; endColumn: number; styleId: number }> = [];
      for (const columnDefinition of sheetLayers.layout.columns) {
        if (columnDefinition.styleId == null) continue;
        columnStyleRanges.push({
          startColumn: columnDefinition.min,
          endColumn: columnDefinition.max,
          styleId: columnDefinition.styleId,
        });
      }

      this.workbookVisualContext = {
        cellStyleIdByAddress,
        rowStyleIdByRow,
        columnStyleRanges,
        styleCssById: this.buildStyleCssByIdFromLayerStyles(sheetLayers.styles),
        floatingImagesHtml: this.buildFloatingImagesHtmlFromLayers(
          sheetLayers.images,
          sheetLayers.layout,
          projectId,
          selection.id,
          targetSheetIndex,
          imageDataUriById,
        ),
      };

      const xlsxModule = await import('xlsx');
      this.selectedSheetHtml = this.renderWorksheetGridHtml(sheetWorksheet, xlsxModule);
      this.sheetInteractionToken = this.generateInteractionToken();
      this.selectedSheetDocument = this.buildSheetPreviewDocument(this.selectedSheetHtml, this.sheetInteractionToken);
      this.updateSheetPreviewUrl(this.selectedSheetDocument);
      this.armSheetFrameReadyWatchdog();
      this.refreshWorkbookDebugOutput();
      return true;
    } catch {
      return false;
    }
  }

  // Refreshes a readable debug payload to validate endpoint parsing and rendered style/image outputs.
  private refreshWorkbookDebugOutput(endpointSummary: Record<string, unknown> | null = null): void {
    if (!this.workbookDebugEnabled) {
      this.workbookDebugOutput = '';
      return;
    }

    const selectedCellAddress = this.selectedWorkbookCellAddress.trim().toUpperCase();
    const parsedCellAddress = this.parseCellAddress(selectedCellAddress);
    const styleIdFromContext =
      this.workbookVisualContext && parsedCellAddress
        ? this.resolveWorkbookStyleId(
            parsedCellAddress.row - 1,
            parsedCellAddress.col - 1,
            selectedCellAddress,
            this.workbookVisualContext,
          )
        : null;

    const debugPayload = {
      timestamp: new Date().toISOString(),
      projectId: this.activeProject?.id ?? null,
      quantificationId: this.cuantificacionSeleccionada?.id ?? null,
      selectedSheetName: this.selectedSheetName,
      selectedSheetIndex: this.workbookSheetIndexByName.get(this.selectedSheetName ?? '') ?? null,
      selectedCell: {
        address: this.selectedWorkbookCellAddress,
        value: this.selectedWorkbookCellValue,
        formula: this.selectedWorkbookCellFormula,
        row: this.selectedWorkbookRowNumber,
        col: this.selectedWorkbookColumnNumber,
        styleIdFromContext,
        styleDefinition:
          styleIdFromContext != null ? this.lastWorkbookStylesById[String(styleIdFromContext)] ?? null : null,
      },
      visualContext: this.workbookVisualContext
        ? {
            cellStyles: this.workbookVisualContext.cellStyleIdByAddress.size,
            rowStyles: this.workbookVisualContext.rowStyleIdByRow.size,
            columnStyleRanges: this.workbookVisualContext.columnStyleRanges.length,
            styleCssCount: this.workbookVisualContext.styleCssById.size,
            floatingImagesHtmlCount: this.workbookVisualContext.floatingImagesHtml.length,
          }
        : null,
      selectedCellRender: this.lastSelectedCellRenderSummary,
      layerSummary: this.lastWorkbookLayerSummary,
      imageLoadSummary: this.lastWorkbookImageLoadSummary,
      endpointSummary,
    };

    this.workbookDebugOutput = JSON.stringify(debugPayload, null, 2);
    console.info('[BOQ XLSX DEBUG] viewer-debug', debugPayload);
  }

  // Converts normalized workbook layers into a worksheet-like object consumed by the grid renderer.
  private buildWorksheetFromWorkbookLayers(sheetLayers: WorkbookLayersOrm): Record<string, unknown> | null {
    const maximumRow = sheetLayers.layout.maxRow || 1;
    const maximumColumn = sheetLayers.layout.maxCol || 1;
    if (maximumRow <= 0 || maximumColumn <= 0) return null;

    const worksheet: Record<string, unknown> = {};
    worksheet['!ref'] = `A1:${this.columnLabelFromIndex(maximumColumn - 1)}${maximumRow}`;

    const columnLayout = new Array<Record<string, unknown>>(maximumColumn);
    for (let columnIndex = 0; columnIndex < maximumColumn; columnIndex += 1) {
      columnLayout[columnIndex] = {};
    }
    for (const columnRange of sheetLayers.layout.columns) {
      for (let columnNumber = columnRange.min; columnNumber <= columnRange.max; columnNumber += 1) {
        const columnIndex = columnNumber - 1;
        if (columnIndex < 0 || columnIndex >= columnLayout.length) continue;
        if (columnRange.hidden) {
          columnLayout[columnIndex]['hidden'] = true;
        }
        const widthPixels = columnRange.widthPx ?? sheetLayers.layout.defaultColumnWidthPx ?? null;
        if (widthPixels != null) {
          columnLayout[columnIndex]['wpx'] = widthPixels;
        } else if (columnRange.hidden) {
          columnLayout[columnIndex]['wpx'] = 0;
        }
      }
    }
    worksheet['!cols'] = columnLayout;

    const rowLayout = new Array<Record<string, unknown>>(maximumRow);
    for (let rowIndex = 0; rowIndex < maximumRow; rowIndex += 1) {
      rowLayout[rowIndex] = {};
    }
    for (const rowDefinition of sheetLayers.layout.rows) {
      const rowIndex = rowDefinition.row - 1;
      if (rowIndex < 0 || rowIndex >= rowLayout.length) continue;
      if (rowDefinition.hidden) {
        rowLayout[rowIndex]['hidden'] = true;
      }
      const heightPixels = rowDefinition.heightPx ?? sheetLayers.layout.defaultRowHeightPx ?? null;
      if (heightPixels != null) {
        rowLayout[rowIndex]['hpx'] = heightPixels;
      } else if (rowDefinition.hidden) {
        rowLayout[rowIndex]['hpx'] = 0;
      }
    }
    worksheet['!rows'] = rowLayout;

    const styleById = new Map<number, WorkbookStyleOrm>();
    for (const [styleId, styleDefinition] of Object.entries(sheetLayers.styles)) {
      const styleNumericId = Number.parseInt(styleId, 10);
      if (!Number.isFinite(styleNumericId)) continue;
      styleById.set(styleNumericId, styleDefinition);
    }

    for (const cellData of sheetLayers.cells) {
      worksheet[cellData.address] = this.convertWorkbookCellToWorksheetCell(cellData, styleById);
    }

    worksheet['!merges'] = sheetLayers.merges.map((mergeRange) => ({
      s: { r: mergeRange.startRow - 1, c: mergeRange.startCol - 1 },
      e: { r: mergeRange.endRow - 1, c: mergeRange.endCol - 1 },
    }));

    return worksheet;
  }

  // Maps backend layer cells to SheetJS-like cells for existing rendering pipeline reuse.
  private convertWorkbookCellToWorksheetCell(
    cellData: WorkbookCellOrm,
    styleById: Map<number, WorkbookStyleOrm>,
  ): Record<string, unknown> {
    const worksheetCell: Record<string, unknown> = {};
    const workbookCellType = (cellData.type || '').toLowerCase();
    if (workbookCellType === 'b') {
      worksheetCell['t'] = 'b';
      worksheetCell['v'] = Boolean(cellData.value);
    } else if (workbookCellType === 'n') {
      worksheetCell['t'] = 'n';
      worksheetCell['v'] = typeof cellData.value === 'number' ? cellData.value : Number(cellData.value ?? 0);
    } else {
      worksheetCell['t'] = 's';
      worksheetCell['v'] = cellData.value == null ? '' : String(cellData.value);
    }

    if (cellData.formattedValue != null) {
      worksheetCell['w'] = cellData.formattedValue;
    }
    if (cellData.formula) {
      worksheetCell['f'] = cellData.formula;
    }
    if (cellData.styleId != null) {
      worksheetCell['s'] = this.convertWorkbookStyleToCellStyleObject(styleById.get(cellData.styleId) ?? null);
    }
    return worksheetCell;
  }

  // Converts normalized workbook styles to the shape expected by existing style renderer.
  private convertWorkbookStyleToCellStyleObject(workbookStyle: WorkbookStyleOrm | null): Record<string, unknown> | null {
    if (!workbookStyle) return null;
    const cellStyle: Record<string, unknown> = {};
    if (workbookStyle.fill) {
      cellStyle['fill'] = {
        patternType: workbookStyle.fill.type ?? 'solid',
        fgColor: workbookStyle.fill.color ? { rgb: workbookStyle.fill.color.replace('#', '') } : undefined,
        bgColor: workbookStyle.fill.backgroundColor
          ? { rgb: workbookStyle.fill.backgroundColor.replace('#', '') }
          : undefined,
      };
    }
    if (workbookStyle.font) {
      cellStyle['font'] = {
        name: workbookStyle.font.name ?? undefined,
        sz: workbookStyle.font.size ?? undefined,
        bold: workbookStyle.font.bold ?? undefined,
        italic: workbookStyle.font.italic ?? undefined,
        underline: workbookStyle.font.underline ?? undefined,
        strike: workbookStyle.font.strike ?? undefined,
        color: workbookStyle.font.color ? { rgb: workbookStyle.font.color.replace('#', '') } : undefined,
      };
    }
    if (workbookStyle.alignment) {
      cellStyle['alignment'] = {
        horizontal: workbookStyle.alignment.horizontal ?? undefined,
        vertical: workbookStyle.alignment.vertical ?? undefined,
        wrapText: workbookStyle.alignment.wrapText ?? undefined,
      };
    }
    if (workbookStyle.border) {
      const borderDefinition: Record<string, unknown> = {};
      for (const sideName of ['top', 'right', 'bottom', 'left'] as const) {
        const sideDefinition = workbookStyle.border[sideName];
        if (!sideDefinition) continue;
        borderDefinition[sideName] = {
          style: sideDefinition.style ?? undefined,
          color: sideDefinition.color ? { rgb: sideDefinition.color.replace('#', '') } : undefined,
        };
      }
      cellStyle['border'] = borderDefinition;
    }
    return cellStyle;
  }

  // Converts backend workbook styles into inline CSS indexed by style identifier.
  private buildStyleCssByIdFromLayerStyles(stylesById: Record<string, WorkbookStyleOrm>): Map<number, string> {
    const styleCssById = new Map<number, string>();
    for (const [styleIdRaw, workbookStyle] of Object.entries(stylesById)) {
      const styleId = Number.parseInt(styleIdRaw, 10);
      if (!Number.isFinite(styleId)) continue;
      const cellStyleObject = this.convertWorkbookStyleToCellStyleObject(workbookStyle ?? null);
      if (!cellStyleObject) continue;
      const inlineCss = this.resolveCellInlineStyle(
        { s: cellStyleObject },
        0,
        0,
        '',
        null,
      );
      if (!inlineCss) continue;
      styleCssById.set(styleId, inlineCss);
    }
    return styleCssById;
  }

  // Builds floating image overlays from backend anchor metadata and layout pixel metrics.
  private buildFloatingImagesHtmlFromLayers(
    images: WorkbookImageOrm[],
    layout: WorkbookLayersOrm['layout'],
    projectId: number,
    quantificationId: number,
    sheetIndex: number,
    imageDataUriById: Map<string, string>,
  ): string[] {
    const resolveColumnLeftPx = (columnNumber: number): number => {
      let positionLeftPx = 48;
      for (let currentColumn = 1; currentColumn < columnNumber; currentColumn += 1) {
        const columnRange = layout.columns.find((range) => currentColumn >= range.min && currentColumn <= range.max);
        positionLeftPx += columnRange?.widthPx ?? layout.defaultColumnWidthPx ?? 80;
      }
      return positionLeftPx;
    };

    const resolveRowTopPx = (rowNumber: number): number => {
      let positionTopPx = 22;
      for (let currentRow = 1; currentRow < rowNumber; currentRow += 1) {
        const rowDefinition = layout.rows.find((rowItem) => rowItem.row === currentRow);
        positionTopPx += rowDefinition?.heightPx ?? layout.defaultRowHeightPx ?? 22;
      }
      return positionTopPx;
    };

    return images.map((imageData) => {
      const fromAnchor = imageData.anchor.from;
      const leftPx = resolveColumnLeftPx(fromAnchor.col) + (fromAnchor.colOffsetPx ?? 0);
      const topPx = resolveRowTopPx(fromAnchor.row) + (fromAnchor.rowOffsetPx ?? 0);
      const imageSource =
        imageDataUriById.get(imageData.id)
        ?? `/api/proyectos/${projectId}/cuantificaciones/${quantificationId}/libro-excel/hojas/${sheetIndex}/imagenes/${imageData.id}/`;

      let widthPx = imageData.widthPx ?? 100;
      let heightPx = imageData.heightPx ?? 60;
      if (imageData.anchor.to) {
        const toAnchor = imageData.anchor.to;
        const rightPx = resolveColumnLeftPx(toAnchor.col) + (toAnchor.colOffsetPx ?? 0);
        const bottomPx = resolveRowTopPx(toAnchor.row) + (toAnchor.rowOffsetPx ?? 0);
        widthPx = Math.max(16, rightPx - leftPx);
        heightPx = Math.max(16, bottomPx - topPx);
      }

      const toAnchor = imageData.anchor.to;
      const toRow = toAnchor?.row ?? 0;
      const toCol = toAnchor?.col ?? 0;
      const toRowOffsetPx = toAnchor?.rowOffsetPx ?? 0;
      const toColOffsetPx = toAnchor?.colOffsetPx ?? 0;

      return `<img class="excel-floating-image" src="${this.escapeHtmlAttribute(imageSource)}"
        data-image-id="${this.escapeHtmlAttribute(imageData.id)}"
        data-anchor-type="${this.escapeHtmlAttribute(imageData.anchor.type)}"
        data-from-row="${fromAnchor.row}"
        data-from-col="${fromAnchor.col}"
        data-from-row-offset="${(fromAnchor.rowOffsetPx ?? 0).toFixed(3)}"
        data-from-col-offset="${(fromAnchor.colOffsetPx ?? 0).toFixed(3)}"
        data-to-row="${toRow}"
        data-to-col="${toCol}"
        data-to-row-offset="${toRowOffsetPx.toFixed(3)}"
        data-to-col-offset="${toColOffsetPx.toFixed(3)}"
        data-width-px="${widthPx.toFixed(3)}"
        data-height-px="${heightPx.toFixed(3)}"
        style="left:${leftPx.toFixed(2)}px;top:${topPx.toFixed(2)}px;width:${widthPx.toFixed(2)}px;height:${heightPx.toFixed(2)}px;"
        alt="" />`;
    });
  }

  // Downloads sheet image binaries and converts them to data-URI values for iframe rendering.
  private async loadWorkbookImageDataUris(
    projectId: number,
    quantificationId: number,
    sheetIndex: number,
    images: WorkbookImageOrm[],
  ): Promise<Map<string, string>> {
    const imageDataUriById = new Map<string, string>();
    const cachedImages: Array<{ id: string; contentType: string; bytesApprox: number }> = [];
    const loadedImages: Array<{ id: string; contentType: string; bytesApprox: number }> = [];
    const failedImages: Array<{ id: string; error: string }> = [];
    const imageLoadTasks = images.map(async (imageData) => {
      const cacheKey = this.buildWorkbookImageCacheKey(projectId, quantificationId, sheetIndex, imageData.id);
      const cachedImageDataUri = this.readWorkbookImageDataUriFromCache(cacheKey);
      if (cachedImageDataUri) {
        imageDataUriById.set(imageData.id, cachedImageDataUri);
        cachedImages.push({
          id: imageData.id,
          contentType: imageData.contentType,
          bytesApprox: Math.round((cachedImageDataUri.length * 3) / 4),
        });
        return;
      }

      try {
        const imageBlob = await firstValueFrom(
          this.backendProyectos.descargarImagenHojaExcelCuantificacion(
            projectId,
            quantificationId,
            sheetIndex,
            imageData.id,
          ),
        );
        const imageDataUri = await this.convertBlobToDataUri(imageBlob);
        if (imageDataUri) {
          imageDataUriById.set(imageData.id, imageDataUri);
          this.writeWorkbookImageDataUriToCache(cacheKey, imageDataUri);
          loadedImages.push({
            id: imageData.id,
            contentType: imageData.contentType,
            bytesApprox: imageBlob.size,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'unknown-error';
        failedImages.push({ id: imageData.id, error: errorMessage });
        console.warn('[BOQ XLSX] No se pudo cargar imagen de hoja.', {
          imageId: imageData.id,
          projectId,
          quantificationId,
          sheetIndex,
          error,
        });
      }
    });
    await Promise.all(imageLoadTasks);
    this.lastWorkbookImageLoadSummary = {
      projectId,
      quantificationId,
      sheetIndex,
      requestedImagesCount: images.length,
      cachedImagesCount: cachedImages.length,
      loadedImagesCount: loadedImages.length,
      failedImagesCount: failedImages.length,
      cachedImages,
      loadedImages,
      failedImages,
    };
    return imageDataUriById;
  }

  private buildWorkbookImageCacheKey(
    projectId: number,
    quantificationId: number,
    sheetIndex: number,
    imageId: string,
  ): string {
    return `${projectId}:${quantificationId}:${sheetIndex}:${imageId}`;
  }

  private readWorkbookImageDataUriFromCache(cacheKey: string): string {
    const memoryCachedValue = this.workbookImageDataUriCache.get(cacheKey) ?? '';
    if (memoryCachedValue) return memoryCachedValue;

    const storageKey = `${this.workbookImageCacheStoragePrefix}${cacheKey}`;
    try {
      const localStorageValue = localStorage.getItem(storageKey) ?? '';
      if (localStorageValue.startsWith('data:image/')) {
        this.workbookImageDataUriCache.set(cacheKey, localStorageValue);
        return localStorageValue;
      }
    } catch {
      // Ignores localStorage availability and quota errors.
    }
    return '';
  }

  private writeWorkbookImageDataUriToCache(cacheKey: string, imageDataUri: string): void {
    this.workbookImageDataUriCache.set(cacheKey, imageDataUri);
    if (this.workbookImageDataUriCache.size > 400) {
      const oldestKey = this.workbookImageDataUriCache.keys().next().value;
      if (oldestKey) {
        this.workbookImageDataUriCache.delete(oldestKey);
      }
    }

    const storageKey = `${this.workbookImageCacheStoragePrefix}${cacheKey}`;
    try {
      localStorage.setItem(storageKey, imageDataUri);
    } catch {
      // Ignores localStorage availability and quota errors.
    }
  }

  private clearWorkbookImageCacheForQuantification(projectId: number, quantificationId: number): void {
    const cachePrefix = `${projectId}:${quantificationId}:`;
    for (const cacheKey of Array.from(this.workbookImageDataUriCache.keys())) {
      if (cacheKey.startsWith(cachePrefix)) {
        this.workbookImageDataUriCache.delete(cacheKey);
      }
    }

    const localStoragePrefix = `${this.workbookImageCacheStoragePrefix}${cachePrefix}`;
    try {
      for (let itemIndex = localStorage.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const localStorageKey = localStorage.key(itemIndex) ?? '';
        if (localStorageKey.startsWith(localStoragePrefix)) {
          localStorage.removeItem(localStorageKey);
        }
      }
    } catch {
      // Ignores localStorage availability errors.
    }
  }

  // Converts a blob response to an embeddable data URI string.
  private convertBlobToDataUri(blobData: Blob): Promise<string> {
    return new Promise((resolve) => {
      if (!blobData || blobData.size <= 0) {
        resolve('');
        return;
      }

      const fileReader = new FileReader();
      fileReader.onload = () => {
        resolve(typeof fileReader.result === 'string' ? fileReader.result : '');
      };
      fileReader.onerror = () => resolve('');
      fileReader.readAsDataURL(blobData);
    });
  }

  // Resolves workbook payload from possible backend field names.
  private getWorkbookPayload(selection: CuantificacionB5DOrm | null): string | null {
    if (!selection) return null;
    const candidateValues = [selection.libro_excel, selection.LibroExcel, selection.libroExcel, selection.Libro_Excel];
    for (const candidateValue of candidateValues) {
      if (typeof candidateValue === 'string' && candidateValue.trim()) {
        return candidateValue;
      }
    }
    return null;
  }

  // Keeps list data in sync after uploading a workbook to the selected quantification.
  private replaceQuantificationRow(updatedQuantification: CuantificacionB5DOrm): void {
    this.cuantificacionesB5d = this.cuantificacionesB5d.map((quantification) =>
      quantification.id === updatedQuantification.id
        ? {
            ...quantification,
            ...updatedQuantification,
          }
        : quantification,
    );
  }

  // Requests workbook binary content from the backend quantification workbook endpoint.
  private async hydrateWorkbookFromBackend(selection: CuantificacionB5DOrm): Promise<{
    payload: string | null;
    bytes: Uint8Array | null;
  }> {
    const projectId = this.activeProject?.id ?? null;
    if (!projectId) {
      return { payload: null, bytes: null };
    }

    try {
      const workbookArrayBuffer = await firstValueFrom(
        this.backendProyectos.descargarLibroExcelCuantificacion(projectId, selection.id),
      );
      if (workbookArrayBuffer.byteLength > 0) {
        return { payload: null, bytes: new Uint8Array(workbookArrayBuffer) };
      }
    } catch {
      // Leaves preview empty when backend workbook endpoint is unavailable.
    }

    return { payload: null, bytes: null };
  }

  // Builds an Excel-like table with sticky row/column headers and merge support.
  private renderWorksheetGridHtml(worksheet: Record<string, unknown>, xlsxModule: typeof import('xlsx')): string {
    const sheetRange = this.resolveWorksheetBounds(worksheet, xlsxModule);
    if (!sheetRange) return '';

    const visualContext = this.workbookVisualContext;
    const mergeMap = this.buildMergeMap(worksheet, sheetRange);
    const headerColumns: string[] = [];
    const colStyles: string[] = [];

    for (let columnIndex = sheetRange.startColumn; columnIndex <= sheetRange.endColumn; columnIndex += 1) {
      headerColumns.push(this.columnLabelFromIndex(columnIndex));
      const hiddenColumn = this.isColumnHidden(worksheet, columnIndex);
      const widthPixels = this.resolveColumnWidthPixels(worksheet, columnIndex);
      const colStyleSegments: string[] = [];
      if (widthPixels != null) {
        colStyleSegments.push(`width:${widthPixels}px`);
        colStyleSegments.push(`min-width:${widthPixels}px`);
      }
      if (hiddenColumn) {
        colStyleSegments.push('display:none');
      }
      const colStyle = colStyleSegments.length ? ` style="${colStyleSegments.join(';')};"` : '';
      colStyles.push(`<col${colStyle} />`);
    }

    const rowHtml: string[] = [];
    for (let rowIndex = sheetRange.startRow; rowIndex <= sheetRange.endRow; rowIndex += 1) {
      const rowNumber = rowIndex + 1;
      const hiddenRow = this.isRowHidden(worksheet, rowIndex);
      const rowHeightPixels = this.resolveRowHeightPixels(worksheet, rowIndex);
      const rowStyleSegments: string[] = [];
      if (rowHeightPixels != null) {
        rowStyleSegments.push(`height:${rowHeightPixels}px`);
      }
      if (hiddenRow) {
        rowStyleSegments.push('display:none');
      }
      const rowStyle = rowStyleSegments.length ? ` style="${rowStyleSegments.join(';')};"` : '';
      const cellsHtml: string[] = [`<th class="row-header" scope="row" tabindex="0" data-row="${rowIndex}">${rowNumber}</th>`];

      for (let columnIndex = sheetRange.startColumn; columnIndex <= sheetRange.endColumn; columnIndex += 1) {
        const mergeKey = `${rowIndex}:${columnIndex}`;
        const mergeMeta = mergeMap.get(mergeKey);
        if (mergeMeta?.skip) continue;

        const cellAddress = xlsxModule.utils.encode_cell({ r: rowIndex, c: columnIndex });
        const cellData = worksheet[cellAddress] as Record<string, unknown> | undefined;
        const cellContentHtml = this.renderCellContentHtml(cellData);
        const mergeAttributes = mergeMeta
          ? ` rowspan="${mergeMeta.rowSpan}" colspan="${mergeMeta.colSpan}"`
          : '';
        const cellCssClass = this.resolveCellCssClass(cellData);
        const cellInlineStyle = this.resolveCellInlineStyle(cellData, rowIndex, columnIndex, cellAddress, visualContext);
        const hiddenColumn = this.isColumnHidden(worksheet, columnIndex);
        const cellStyleSegments = [cellInlineStyle];
        if (hiddenColumn) {
          cellStyleSegments.push('display:none');
        }
        const mergedCellStyle = cellStyleSegments.filter((cssRule) => cssRule && cssRule.trim()).join(';');
        const cellStyleAttribute = mergedCellStyle ? ` style="${this.escapeHtmlAttribute(mergedCellStyle)}"` : '';
        const cellFormula = typeof cellData?.['f'] === 'string' ? (cellData['f'] as string).trim() : '';
        const cellFormulaAttribute = cellFormula ? ` data-f="${this.escapeHtmlAttribute(cellFormula)}"` : '';
        cellsHtml.push(
          `<td class="${cellCssClass}" tabindex="0" data-r="${rowIndex}" data-c="${columnIndex}"${cellFormulaAttribute}${mergeAttributes}${cellStyleAttribute}>${cellContentHtml}</td>`,
        );
      }

      rowHtml.push(`<tr${rowStyle}>${cellsHtml.join('')}</tr>`);
    }

    const headerRow = headerColumns
      .map(
        (columnLabel, index) =>
          `<th class="column-header" scope="col" tabindex="0" data-col="${sheetRange.startColumn + index}"${
            this.isColumnHidden(worksheet, sheetRange.startColumn + index) ? ' style="display:none;"' : ''
          }>${columnLabel}</th>`,
      )
      .join('');

    return `<div class="excel-grid-shell">
      <div class="excel-grid-canvas">
      <table class="excel-grid-table">
        <colgroup>
          <col class="row-head-col" />
          ${colStyles.join('')}
        </colgroup>
        <thead>
          <tr>
            <th class="corner-header corner-header--select-all" tabindex="0" data-select-all="1"></th>
            ${headerRow}
          </tr>
        </thead>
        <tbody>
          ${rowHtml.join('')}
        </tbody>
      </table>
      ${(visualContext?.floatingImagesHtml ?? []).join('')}
      </div>
    </div>`;
  }

  // Calculates practical bounds from populated cells and merge definitions.
  private resolveWorksheetBounds(
    worksheet: Record<string, unknown>,
    xlsxModule: typeof import('xlsx'),
  ): WorksheetBounds | null {
    const cellAddressPattern = /^[A-Z]+[1-9]\d*$/;
    let startRow = 0;
    let startColumn = 0;
    let endRow = 0;
    let endColumn = 0;
    let hasCellData = false;
    let referenceStartRow = 0;
    let referenceStartColumn = 0;

    const rawReference = typeof worksheet['!ref'] === 'string' ? (worksheet['!ref'] as string) : '';
    if (rawReference) {
      const decodedRange = xlsxModule.utils.decode_range(rawReference);
      referenceStartRow = decodedRange.s.r;
      referenceStartColumn = decodedRange.s.c;
      endRow = Math.max(endRow, decodedRange.e.r);
      endColumn = Math.max(endColumn, decodedRange.e.c);
      hasCellData = true;
    }

    for (const key of Object.keys(worksheet)) {
      if (!cellAddressPattern.test(key)) continue;
      const { r, c } = xlsxModule.utils.decode_cell(key);
      endRow = Math.max(endRow, r);
      endColumn = Math.max(endColumn, c);
      hasCellData = true;
    }

    const merges = (worksheet['!merges'] as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> | undefined) ?? [];
    for (const mergeRange of merges) {
      endRow = Math.max(endRow, mergeRange.e.r);
      endColumn = Math.max(endColumn, mergeRange.e.c);
      hasCellData = true;
    }

    if (!hasCellData) return null;

    // Always anchor the preview from A1 to keep row and column headers consistent.
    startRow = Math.min(0, referenceStartRow);
    startColumn = Math.min(0, referenceStartColumn);

    const maximumVisibleRows = 500;
    const maximumVisibleColumns = 120;
    endRow = Math.min(endRow, startRow + maximumVisibleRows - 1);
    endColumn = Math.min(endColumn, startColumn + maximumVisibleColumns - 1);

    return { startRow, endRow, startColumn, endColumn };
  }

  // Maps merge starts and covered cells for rendering with rowspan/colspan.
  private buildMergeMap(
    worksheet: Record<string, unknown>,
    bounds: WorksheetBounds,
  ): Map<string, { rowSpan: number; colSpan: number; skip: boolean }> {
    const mergeMap = new Map<string, { rowSpan: number; colSpan: number; skip: boolean }>();
    const merges = (worksheet['!merges'] as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> | undefined) ?? [];

    for (const mergeRange of merges) {
      const startRow = Math.max(bounds.startRow, mergeRange.s.r);
      const startColumn = Math.max(bounds.startColumn, mergeRange.s.c);
      const endRow = Math.min(bounds.endRow, mergeRange.e.r);
      const endColumn = Math.min(bounds.endColumn, mergeRange.e.c);
      if (endRow < startRow || endColumn < startColumn) continue;

      const rowSpan = endRow - startRow + 1;
      const colSpan = endColumn - startColumn + 1;
      mergeMap.set(`${startRow}:${startColumn}`, { rowSpan, colSpan, skip: false });

      for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
        for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
          if (rowIndex === startRow && columnIndex === startColumn) continue;
          mergeMap.set(`${rowIndex}:${columnIndex}`, { rowSpan: 1, colSpan: 1, skip: true });
        }
      }
    }

    return mergeMap;
  }

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

  private resolveColumnWidthPixels(worksheet: Record<string, unknown>, columnIndex: number): number | null {
    const columns = worksheet['!cols'] as Array<Record<string, unknown>> | undefined;
    const columnInfo = columns?.[columnIndex];
    if (!columnInfo) return null;
    if (typeof columnInfo['wpx'] === 'number' && Number.isFinite(columnInfo['wpx'])) {
      return Math.max(0, Math.round(columnInfo['wpx'] as number));
    }
    if (typeof columnInfo['wch'] === 'number' && Number.isFinite(columnInfo['wch'])) {
      return Math.max(0, Math.round((columnInfo['wch'] as number) * 8 + 12));
    }
    return null;
  }

  private resolveRowHeightPixels(worksheet: Record<string, unknown>, rowIndex: number): number | null {
    const rows = worksheet['!rows'] as Array<Record<string, unknown>> | undefined;
    const rowInfo = rows?.[rowIndex];
    if (!rowInfo) return null;
    if (typeof rowInfo['hpx'] === 'number' && Number.isFinite(rowInfo['hpx'])) {
      return Math.max(0, Math.round(rowInfo['hpx'] as number));
    }
    if (typeof rowInfo['hpt'] === 'number' && Number.isFinite(rowInfo['hpt'])) {
      return Math.max(0, Math.round((rowInfo['hpt'] as number) * (96 / 72)));
    }
    return null;
  }

  private isColumnHidden(worksheet: Record<string, unknown>, columnIndex: number): boolean {
    const columns = worksheet['!cols'] as Array<Record<string, unknown>> | undefined;
    const columnInfo = columns?.[columnIndex];
    if (!columnInfo) return false;
    if (columnInfo['hidden'] === true) return true;
    if (typeof columnInfo['wpx'] === 'number' && Number.isFinite(columnInfo['wpx']) && columnInfo['wpx'] <= 0) return true;
    if (typeof columnInfo['wch'] === 'number' && Number.isFinite(columnInfo['wch']) && columnInfo['wch'] <= 0) return true;
    return false;
  }

  private isRowHidden(worksheet: Record<string, unknown>, rowIndex: number): boolean {
    const rows = worksheet['!rows'] as Array<Record<string, unknown>> | undefined;
    const rowInfo = rows?.[rowIndex];
    if (!rowInfo) return false;
    if (rowInfo['hidden'] === true) return true;
    if (typeof rowInfo['hpx'] === 'number' && Number.isFinite(rowInfo['hpx']) && rowInfo['hpx'] <= 0) return true;
    if (typeof rowInfo['hpt'] === 'number' && Number.isFinite(rowInfo['hpt']) && rowInfo['hpt'] <= 0) return true;
    return false;
  }

  // Returns safe cell HTML using rich text when available.
  private renderCellContentHtml(cellData: Record<string, unknown> | undefined): string {
    if (!cellData) return '';

    const richHtml = typeof cellData['h'] === 'string' ? this.sanitizeSheetHtml(cellData['h'] as string).trim() : '';
    const textValue = typeof cellData['w'] === 'string' ? (cellData['w'] as string) : cellData['v'] == null ? '' : String(cellData['v']);
    const fallbackText = this.escapeHtml(textValue);
    const renderedValue = richHtml || fallbackText;
    const hyperlink = cellData['l'] as Record<string, unknown> | undefined;
    const hyperlinkTarget = typeof hyperlink?.['Target'] === 'string' ? this.normalizeLinkTarget(hyperlink['Target'] as string) : '';
    if (!hyperlinkTarget) return renderedValue;

    return `<a href="${this.escapeHtmlAttribute(hyperlinkTarget)}" target="_blank" rel="noopener noreferrer">${renderedValue}</a>`;
  }

  private resolveCellCssClass(cellData: Record<string, unknown> | undefined): string {
    const cellType = typeof cellData?.['t'] === 'string' ? (cellData['t'] as string) : '';
    if (cellType === 'n') return 'excel-cell excel-cell--numeric';
    if (cellType === 'b') return 'excel-cell excel-cell--boolean';
    return 'excel-cell';
  }

  // Converts common XLSX style metadata into inline CSS for each rendered cell.
  private resolveCellInlineStyle(
    cellData: Record<string, unknown> | undefined,
    rowIndex: number,
    columnIndex: number,
    cellAddress: string,
    visualContext: WorkbookVisualContext | null,
  ): string {
    const styleFromXmlIndex = this.resolveStyleCssFromWorkbookContext(
      rowIndex,
      columnIndex,
      cellAddress,
      visualContext,
    );
    const styleInfo = this.asRecord(cellData?.['s']);
    if (!styleInfo) return styleFromXmlIndex;

    const cssRules: string[] = [];
    let resolvedFillColor = '';

    const fillInfo = this.asRecord(styleInfo['fill']);
    const patternType = typeof fillInfo?.['patternType'] === 'string' ? fillInfo['patternType'].toLowerCase() : '';
    if (patternType && patternType !== 'none') {
      const fillColor = this.resolveExcelColor(fillInfo?.['fgColor']) ?? this.resolveExcelColor(fillInfo?.['bgColor']);
      if (fillColor) {
        resolvedFillColor = fillColor;
        cssRules.push(`background-color:${fillColor}`);
      }
    }

    const fontInfo = this.asRecord(styleInfo['font']);
    let hasExplicitFontColor = /(?:^|;)color\s*:/i.test(styleFromXmlIndex);
    if (fontInfo) {
      if (fontInfo['bold'] === true) cssRules.push('font-weight:700');
      if (fontInfo['italic'] === true) cssRules.push('font-style:italic');

      const fontSize = typeof fontInfo['sz'] === 'number' ? fontInfo['sz'] : Number(fontInfo['sz']);
      if (Number.isFinite(fontSize) && fontSize > 0) {
        cssRules.push(`font-size:${fontSize}pt`);
      }

      const fontName = typeof fontInfo['name'] === 'string' ? fontInfo['name'].trim() : '';
      if (fontName) {
        cssRules.push(`font-family:${this.quoteFontFamily(fontName)}`);
      }

      const fontColor = this.resolveExcelColor(fontInfo['color']);
      if (fontColor) {
        hasExplicitFontColor = true;
        cssRules.push(`color:${fontColor}`);
      }

      const textDecorations: string[] = [];
      if (fontInfo['underline'] === true || typeof fontInfo['underline'] === 'string') {
        textDecorations.push('underline');
      }
      if (fontInfo['strike'] === true) {
        textDecorations.push('line-through');
      }
      if (textDecorations.length) {
        cssRules.push(`text-decoration:${textDecorations.join(' ')}`);
      }
    }

    if (!hasExplicitFontColor && resolvedFillColor) {
      const fallbackFontColor = this.resolveReadableTextColorForBackground(resolvedFillColor);
      if (fallbackFontColor) {
        cssRules.push(`color:${fallbackFontColor}`);
      }
    }

    const alignmentInfo = this.asRecord(styleInfo['alignment']);
    if (alignmentInfo) {
      const horizontalAlignment = this.resolveHorizontalAlignment(alignmentInfo['horizontal']);
      if (horizontalAlignment) cssRules.push(`text-align:${horizontalAlignment}`);

      const verticalAlignment = this.resolveVerticalAlignment(alignmentInfo['vertical']);
      if (verticalAlignment) cssRules.push(`vertical-align:${verticalAlignment}`);

      if (alignmentInfo['wrapText'] === true) {
        cssRules.push('white-space:pre-wrap');
      } else if (alignmentInfo['wrapText'] === false) {
        cssRules.push('white-space:normal');
      }
    }

    const borderInfo = this.asRecord(styleInfo['border']);
    if (borderInfo) {
      const topBorder = this.resolveBorderCss(this.asRecord(borderInfo['top']));
      if (topBorder) cssRules.push(`border-top:${topBorder}`);
      const rightBorder = this.resolveBorderCss(this.asRecord(borderInfo['right']));
      if (rightBorder) cssRules.push(`border-right:${rightBorder}`);
      const bottomBorder = this.resolveBorderCss(this.asRecord(borderInfo['bottom']));
      if (bottomBorder) cssRules.push(`border-bottom:${bottomBorder}`);
      const leftBorder = this.resolveBorderCss(this.asRecord(borderInfo['left']));
      if (leftBorder) cssRules.push(`border-left:${leftBorder}`);
    }

    const styleFromCellObject = cssRules.join(';');
    if (styleFromCellObject && styleFromXmlIndex) {
      if (styleFromCellObject === styleFromXmlIndex) {
        return styleFromCellObject;
      }
      return `${styleFromXmlIndex};${styleFromCellObject}`;
    }
    return styleFromCellObject || styleFromXmlIndex;
  }

  private resolveReadableTextColorForBackground(backgroundColor: string): string {
    const rgb = this.hexToRgb(backgroundColor);
    if (!rgb) return '';
    const luminance = 0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue;
    return luminance < 140 ? '#FFFFFF' : '#111827';
  }

  // Resolves style CSS using style indexes parsed from workbook XML parts.
  private resolveStyleCssFromWorkbookContext(
    rowIndex: number,
    columnIndex: number,
    cellAddress: string,
    visualContext: WorkbookVisualContext | null,
  ): string {
    if (!visualContext) return '';

    const styleId = this.resolveWorkbookStyleId(rowIndex, columnIndex, cellAddress, visualContext);
    if (styleId == null) return '';
    return visualContext.styleCssById.get(styleId) ?? '';
  }

  // Applies Excel style precedence: cell > row > column.
  private resolveWorkbookStyleId(
    rowIndex: number,
    columnIndex: number,
    cellAddress: string,
    visualContext: WorkbookVisualContext,
  ): number | null {
    const cellStyleId = visualContext.cellStyleIdByAddress.get(cellAddress);
    if (cellStyleId != null) return cellStyleId;

    const rowStyleId = visualContext.rowStyleIdByRow.get(rowIndex + 1);
    if (rowStyleId != null) return rowStyleId;

    const oneBasedColumnIndex = columnIndex + 1;
    for (const columnStyleRange of visualContext.columnStyleRanges) {
      if (oneBasedColumnIndex >= columnStyleRange.startColumn && oneBasedColumnIndex <= columnStyleRange.endColumn) {
        return columnStyleRange.styleId;
      }
    }

    return null;
  }

  // Builds style and image context directly from workbook ZIP parts for richer rendering.
  private buildWorkbookVisualContext(
    workbook: Record<string, unknown>,
    sheetName: string,
    worksheet: Record<string, unknown>,
    workbookBytes: Uint8Array,
    xlsxModule: typeof import('xlsx'),
  ): WorkbookVisualContext | null {
    const worksheetBounds = this.resolveWorksheetBounds(worksheet, xlsxModule);
    const workbookFiles = this.asRecord(workbook['files']);
    if (!worksheetBounds || !workbookFiles) return null;

    const workbookXmlText = this.readWorkbookZipFileText(workbookFiles, 'xl/workbook.xml');
    const workbookRelsXmlText = this.readWorkbookZipFileText(workbookFiles, 'xl/_rels/workbook.xml.rels');
    if (!workbookXmlText || !workbookRelsXmlText) return null;

    const worksheetXmlPath = this.resolveWorksheetXmlPath(sheetName, workbookXmlText, workbookRelsXmlText);
    if (!worksheetXmlPath) return null;

    const worksheetXmlText = this.readWorkbookZipFileText(workbookFiles, worksheetXmlPath);
    if (!worksheetXmlText) return null;

    const themeXmlText = this.readWorkbookZipFileText(workbookFiles, 'xl/theme/theme1.xml') ?? '';
    const stylesXmlText = this.readWorkbookZipFileText(workbookFiles, 'xl/styles.xml') ?? '';
    const themePalette = this.parseThemeColorPalette(themeXmlText);
    const styleCssById = this.parseWorkbookStyles(stylesXmlText, themePalette);
    const styleBindings = this.parseWorksheetStyleBindings(worksheetXmlText);
    const floatingImagesHtml = this.parseWorksheetFloatingImagesHtml(
      workbookFiles,
      worksheetXmlPath,
      worksheetXmlText,
      worksheetBounds,
      worksheet,
      workbookBytes,
    );

    return {
      cellStyleIdByAddress: styleBindings.cellStyleIdByAddress,
      rowStyleIdByRow: styleBindings.rowStyleIdByRow,
      columnStyleRanges: styleBindings.columnStyleRanges,
      styleCssById,
      floatingImagesHtml,
    };
  }

  // Parses style index bindings declared at cell, row and column levels.
  private parseWorksheetStyleBindings(worksheetXmlText: string): {
    cellStyleIdByAddress: Map<string, number>;
    rowStyleIdByRow: Map<number, number>;
    columnStyleRanges: Array<{ startColumn: number; endColumn: number; styleId: number }>;
  } {
    const cellStyleIdByAddress = new Map<string, number>();
    const rowStyleIdByRow = new Map<number, number>();
    const columnStyleRanges: Array<{ startColumn: number; endColumn: number; styleId: number }> = [];

    const worksheetXml = this.parseXmlDocument(worksheetXmlText);
    if (!worksheetXml) {
      return { cellStyleIdByAddress, rowStyleIdByRow, columnStyleRanges };
    }

    for (const cellElement of this.findElementsByLocalName(worksheetXml, 'c')) {
      const address = (cellElement.getAttribute('r') ?? '').trim().toUpperCase();
      const styleId = this.parseIntegerAttribute(cellElement, 's');
      if (address && styleId != null) {
        cellStyleIdByAddress.set(address, styleId);
      }
    }

    for (const rowElement of this.findElementsByLocalName(worksheetXml, 'row')) {
      const rowNumber = this.parseIntegerAttribute(rowElement, 'r');
      const styleId = this.parseIntegerAttribute(rowElement, 's');
      if (rowNumber != null && styleId != null) {
        rowStyleIdByRow.set(rowNumber, styleId);
      }
    }

    for (const columnElement of this.findElementsByLocalName(worksheetXml, 'col')) {
      const minimum = this.parseIntegerAttribute(columnElement, 'min');
      const maximum = this.parseIntegerAttribute(columnElement, 'max');
      const styleId = this.parseIntegerAttribute(columnElement, 'style');
      if (minimum == null || maximum == null || styleId == null) continue;
      columnStyleRanges.push({ startColumn: minimum, endColumn: maximum, styleId });
    }

    return { cellStyleIdByAddress, rowStyleIdByRow, columnStyleRanges };
  }

  // Parses styles.xml and maps each cellXf index to CSS rules.
  private parseWorkbookStyles(stylesXmlText: string, themePalette: string[]): Map<number, string> {
    const styleCssById = new Map<number, string>();
    if (!stylesXmlText.trim()) return styleCssById;

    const stylesXml = this.parseXmlDocument(stylesXmlText);
    if (!stylesXml) return styleCssById;

    const fontCssById = this.findElementsByLocalName(stylesXml, 'font').map((fontElement) => {
      const cssRules: string[] = [];
      if (this.findFirstElementByLocalName(fontElement, 'b')) cssRules.push('font-weight:700');
      if (this.findFirstElementByLocalName(fontElement, 'i')) cssRules.push('font-style:italic');
      if (this.findFirstElementByLocalName(fontElement, 'u')) cssRules.push('text-decoration:underline');
      if (this.findFirstElementByLocalName(fontElement, 'strike')) cssRules.push('text-decoration:line-through');

      const fontSizeElement = this.findFirstElementByLocalName(fontElement, 'sz');
      const fontSizeValue = fontSizeElement ? Number(fontSizeElement.getAttribute('val')) : Number.NaN;
      if (Number.isFinite(fontSizeValue) && fontSizeValue > 0) {
        cssRules.push(`font-size:${fontSizeValue}pt`);
      }

      const fontNameElement = this.findFirstElementByLocalName(fontElement, 'name');
      const fontNameValue = (fontNameElement?.getAttribute('val') ?? '').trim();
      if (fontNameValue) {
        cssRules.push(`font-family:${this.quoteFontFamily(fontNameValue)}`);
      }

      const fontColorElement = this.findFirstElementByLocalName(fontElement, 'color');
      const fontColor = this.resolveColorElement(fontColorElement, themePalette);
      if (fontColor) {
        cssRules.push(`color:${fontColor}`);
      }

      return cssRules.join(';');
    });

    const fillCssById = this.findElementsByLocalName(stylesXml, 'fill').map((fillElement) => {
      const patternFillElement = this.findFirstElementByLocalName(fillElement, 'patternFill');
      if (!patternFillElement) return '';
      const patternType = (patternFillElement.getAttribute('patternType') ?? '').toLowerCase();
      if (!patternType || patternType === 'none') return '';

      const foregroundColorElement = this.findFirstElementByLocalName(patternFillElement, 'fgColor');
      const backgroundColorElement = this.findFirstElementByLocalName(patternFillElement, 'bgColor');
      const fillColor = this.resolveColorElement(foregroundColorElement, themePalette)
        ?? this.resolveColorElement(backgroundColorElement, themePalette);
      return fillColor ? `background-color:${fillColor}` : '';
    });

    const borderCssById = this.findElementsByLocalName(stylesXml, 'border').map((borderElement) => {
      const cssRules: string[] = [];
      const topCss = this.resolveBorderCss(this.parseBorderSide(borderElement, 'top', themePalette));
      if (topCss) cssRules.push(`border-top:${topCss}`);
      const rightCss = this.resolveBorderCss(this.parseBorderSide(borderElement, 'right', themePalette));
      if (rightCss) cssRules.push(`border-right:${rightCss}`);
      const bottomCss = this.resolveBorderCss(this.parseBorderSide(borderElement, 'bottom', themePalette));
      if (bottomCss) cssRules.push(`border-bottom:${bottomCss}`);
      const leftCss = this.resolveBorderCss(this.parseBorderSide(borderElement, 'left', themePalette));
      if (leftCss) cssRules.push(`border-left:${leftCss}`);
      return cssRules.join(';');
    });

    const cellXfsElement = this.findFirstElementByLocalName(stylesXml, 'cellXfs');
    if (!cellXfsElement) return styleCssById;

    const xfElements = Array.from(cellXfsElement.children).filter((child) => child.localName === 'xf');
    xfElements.forEach((xfElement, styleIndex) => {
      const cssRules: string[] = [];
      const fontId = this.parseIntegerAttribute(xfElement, 'fontId');
      const fillId = this.parseIntegerAttribute(xfElement, 'fillId');
      const borderId = this.parseIntegerAttribute(xfElement, 'borderId');

      if (fontId != null && fontCssById[fontId]) cssRules.push(fontCssById[fontId]);
      if (fillId != null && fillCssById[fillId]) cssRules.push(fillCssById[fillId]);
      if (borderId != null && borderCssById[borderId]) cssRules.push(borderCssById[borderId]);

      const alignmentElement = this.findFirstElementByLocalName(xfElement, 'alignment');
      if (alignmentElement) {
        const horizontalAlignment = this.resolveHorizontalAlignment(alignmentElement.getAttribute('horizontal'));
        if (horizontalAlignment) cssRules.push(`text-align:${horizontalAlignment}`);

        const verticalAlignment = this.resolveVerticalAlignment(alignmentElement.getAttribute('vertical'));
        if (verticalAlignment) cssRules.push(`vertical-align:${verticalAlignment}`);

        const wrapTextAttribute = alignmentElement.getAttribute('wrapText');
        if (wrapTextAttribute === '1' || wrapTextAttribute === 'true') cssRules.push('white-space:pre-wrap');
        if (wrapTextAttribute === '0' || wrapTextAttribute === 'false') cssRules.push('white-space:normal');
      }

      const cssText = cssRules.filter((rule) => rule.trim()).join(';');
      if (cssText) {
        styleCssById.set(styleIndex, cssText);
      }
    });

    return styleCssById;
  }

  // Parses theme color palette for resolving theme-based color references.
  private parseThemeColorPalette(themeXmlText: string): string[] {
    if (!themeXmlText.trim()) return [];
    const themeXml = this.parseXmlDocument(themeXmlText);
    if (!themeXml) return [];

    const colorSchemeElement = this.findFirstElementByLocalName(themeXml, 'clrScheme');
    if (!colorSchemeElement) return [];

    const themeColors: string[] = [];
    for (const colorSlotElement of Array.from(colorSchemeElement.children)) {
      if (!colorSlotElement.localName) continue;
      const rgbColorElement = this.findFirstElementByLocalName(colorSlotElement, 'srgbClr');
      if (rgbColorElement) {
        const rgbValue = (rgbColorElement.getAttribute('val') ?? '').trim();
        if (/^[0-9A-Fa-f]{6}$/.test(rgbValue)) {
          themeColors.push(`#${rgbValue.toUpperCase()}`);
          continue;
        }
      }

      const systemColorElement = this.findFirstElementByLocalName(colorSlotElement, 'sysClr');
      const systemColorValue = (systemColorElement?.getAttribute('lastClr') ?? '').trim();
      if (/^[0-9A-Fa-f]{6}$/.test(systemColorValue)) {
        themeColors.push(`#${systemColorValue.toUpperCase()}`);
      }
    }

    return themeColors;
  }

  // Renders floating worksheet images anchored through drawing relationships.
  private parseWorksheetFloatingImagesHtml(
    workbookFiles: Record<string, unknown>,
    worksheetXmlPath: string,
    worksheetXmlText: string,
    worksheetBounds: WorksheetBounds,
    worksheet: Record<string, unknown>,
    workbookBytes: Uint8Array,
  ): string[] {
    const worksheetXml = this.parseXmlDocument(worksheetXmlText);
    if (!worksheetXml) return [];

    const worksheetRelsPath = this.resolveZipRelativePath(
      worksheetXmlPath,
      `./_rels/${worksheetXmlPath.split('/').pop() ?? 'sheet.xml'}.rels`,
    );
    const worksheetRelsText = this.readWorkbookZipFileText(workbookFiles, worksheetRelsPath);
    if (!worksheetRelsText) return [];

    const worksheetRelsXml = this.parseXmlDocument(worksheetRelsText);
    if (!worksheetRelsXml) return [];

    const worksheetRelationships = new Map<string, string>();
    for (const relationshipElement of this.findElementsByLocalName(worksheetRelsXml, 'Relationship')) {
      const relationshipId = (relationshipElement.getAttribute('Id') ?? '').trim();
      const relationshipTarget = (relationshipElement.getAttribute('Target') ?? '').trim();
      if (relationshipId && relationshipTarget) {
        worksheetRelationships.set(relationshipId, relationshipTarget);
      }
    }

    const htmlImages: string[] = [];
    const drawingElements = this.findElementsByLocalName(worksheetXml, 'drawing');
    for (const drawingElement of drawingElements) {
      const drawingRelationshipId = this.getAttributeValue(drawingElement, ['r:id', 'id']);
      if (!drawingRelationshipId) continue;

      const drawingTarget = worksheetRelationships.get(drawingRelationshipId);
      if (!drawingTarget) continue;

      const drawingPath = this.resolveZipRelativePath(worksheetRelsPath, drawingTarget);
      const drawingXmlText = this.readWorkbookZipFileText(workbookFiles, drawingPath);
      if (!drawingXmlText) continue;

      const drawingRelsPath = this.resolveZipRelativePath(
        drawingPath,
        `./_rels/${drawingPath.split('/').pop() ?? 'drawing.xml'}.rels`,
      );
      const drawingRelsText = this.readWorkbookZipFileText(workbookFiles, drawingRelsPath);
      const drawingRelsXml = drawingRelsText ? this.parseXmlDocument(drawingRelsText) : null;
      const drawingRelationships = new Map<string, string>();
      if (drawingRelsXml) {
        for (const relationshipElement of this.findElementsByLocalName(drawingRelsXml, 'Relationship')) {
          const relationshipId = (relationshipElement.getAttribute('Id') ?? '').trim();
          const relationshipTarget = (relationshipElement.getAttribute('Target') ?? '').trim();
          if (relationshipId && relationshipTarget) {
            drawingRelationships.set(relationshipId, relationshipTarget);
          }
        }
      }

      const drawingXml = this.parseXmlDocument(drawingXmlText);
      if (!drawingXml) continue;

      const anchors = [
        ...this.findElementsByLocalName(drawingXml, 'twoCellAnchor'),
        ...this.findElementsByLocalName(drawingXml, 'oneCellAnchor'),
      ];
      for (const anchorElement of anchors) {
        const blipElement = this.findFirstElementByLocalName(anchorElement, 'blip');
        const embedRelationshipId = this.getAttributeValue(blipElement, ['r:embed', 'embed']);
        if (!embedRelationshipId) continue;

        const imageTarget = drawingRelationships.get(embedRelationshipId);
        if (!imageTarget) continue;

        const imagePath = this.resolveZipRelativePath(drawingRelsPath, imageTarget);
        const imageBytes = this.readWorkbookZipFileBytes(workbookFiles, imagePath);
        if (!imageBytes || !imageBytes.length) continue;

        const fromElement = this.findFirstElementByLocalName(anchorElement, 'from');
        if (!fromElement) continue;

        const fromColumn = Number(this.findFirstElementByLocalName(fromElement, 'col')?.textContent ?? '0');
        const fromRow = Number(this.findFirstElementByLocalName(fromElement, 'row')?.textContent ?? '0');
        const fromColumnOffsetEmu = Number(this.findFirstElementByLocalName(fromElement, 'colOff')?.textContent ?? '0');
        const fromRowOffsetEmu = Number(this.findFirstElementByLocalName(fromElement, 'rowOff')?.textContent ?? '0');

        const leftPx =
          this.calculateOffsetPixelsForColumn(worksheet, worksheetBounds, fromColumn) + fromColumnOffsetEmu / 9525;
        const topPx =
          this.calculateOffsetPixelsForRow(worksheet, worksheetBounds, fromRow) + fromRowOffsetEmu / 9525;

        let widthPx = 120;
        let heightPx = 80;

        const toElement = this.findFirstElementByLocalName(anchorElement, 'to');
        if (toElement) {
          const toColumn = Number(this.findFirstElementByLocalName(toElement, 'col')?.textContent ?? `${fromColumn + 1}`);
          const toRow = Number(this.findFirstElementByLocalName(toElement, 'row')?.textContent ?? `${fromRow + 1}`);
          const toColumnOffsetEmu = Number(this.findFirstElementByLocalName(toElement, 'colOff')?.textContent ?? '0');
          const toRowOffsetEmu = Number(this.findFirstElementByLocalName(toElement, 'rowOff')?.textContent ?? '0');

          const rightPx = this.calculateOffsetPixelsForColumn(worksheet, worksheetBounds, toColumn) + toColumnOffsetEmu / 9525;
          const bottomPx = this.calculateOffsetPixelsForRow(worksheet, worksheetBounds, toRow) + toRowOffsetEmu / 9525;
          widthPx = Math.max(16, rightPx - leftPx);
          heightPx = Math.max(16, bottomPx - topPx);
        } else {
          const extElement = this.findFirstElementByLocalName(anchorElement, 'ext');
          if (extElement) {
            const extWidthEmu = Number(extElement.getAttribute('cx') ?? '0');
            const extHeightEmu = Number(extElement.getAttribute('cy') ?? '0');
            if (extWidthEmu > 0) widthPx = extWidthEmu / 9525;
            if (extHeightEmu > 0) heightPx = extHeightEmu / 9525;
          }
        }

        const extension = imagePath.split('.').pop()?.toLowerCase() ?? '';
        const mimeType = this.resolveImageMimeType(extension);
        const imageBase64 = this.encodeBytesToBase64(imageBytes, workbookBytes);
        if (!imageBase64) continue;

        htmlImages.push(
          `<img class="excel-floating-image" src="data:${mimeType};base64,${imageBase64}" style="left:${leftPx.toFixed(2)}px;top:${topPx.toFixed(2)}px;width:${widthPx.toFixed(2)}px;height:${heightPx.toFixed(2)}px;" alt="" />`,
        );
      }
    }

    return htmlImages;
  }

  // Calculates column offsets in pixels relative to the currently rendered viewport.
  private calculateOffsetPixelsForColumn(
    worksheet: Record<string, unknown>,
    worksheetBounds: WorksheetBounds,
    targetColumn: number,
  ): number {
    let offsetPixels = 0;
    for (let columnIndex = worksheetBounds.startColumn; columnIndex < targetColumn; columnIndex += 1) {
      offsetPixels += this.resolveColumnWidthPixels(worksheet, columnIndex) ?? 80;
    }
    return offsetPixels + 48;
  }

  // Calculates row offsets in pixels relative to the currently rendered viewport.
  private calculateOffsetPixelsForRow(
    worksheet: Record<string, unknown>,
    worksheetBounds: WorksheetBounds,
    targetRow: number,
  ): number {
    let offsetPixels = 0;
    for (let rowIndex = worksheetBounds.startRow; rowIndex < targetRow; rowIndex += 1) {
      offsetPixels += this.resolveRowHeightPixels(worksheet, rowIndex) ?? 22;
    }
    return offsetPixels + 22;
  }

  // Parses a border side element as a style-like record compatible with existing border mapper.
  private parseBorderSide(
    borderElement: Element,
    sideName: string,
    themePalette: string[],
  ): Record<string, unknown> | null {
    const sideElement = this.findFirstElementByLocalName(borderElement, sideName);
    if (!sideElement) return null;

    const styleValue = (sideElement.getAttribute('style') ?? '').trim();
    const colorElement = this.findFirstElementByLocalName(sideElement, 'color');
    const colorValue = this.resolveColorElement(colorElement, themePalette);

    const borderSideRecord: Record<string, unknown> = {};
    if (styleValue) borderSideRecord['style'] = styleValue;
    if (colorValue) borderSideRecord['color'] = { rgb: colorValue.replace('#', '') };
    return Object.keys(borderSideRecord).length ? borderSideRecord : null;
  }

  // Resolves an OOXML color element using RGB, indexed or theme references.
  private resolveColorElement(colorElement: Element | null, themePalette: string[]): string | null {
    if (!colorElement) return null;

    const rgbValue = (colorElement.getAttribute('rgb') ?? '').trim();
    if (/^[0-9A-Fa-f]{8}$/.test(rgbValue)) {
      return `#${rgbValue.slice(2).toUpperCase()}`;
    }
    if (/^[0-9A-Fa-f]{6}$/.test(rgbValue)) {
      return `#${rgbValue.toUpperCase()}`;
    }

    const indexedValue = colorElement.getAttribute('indexed');
    if (indexedValue != null) {
      const indexedColor = this.resolveExcelColor({ indexed: Number(indexedValue) });
      if (indexedColor) return indexedColor;
    }

    const themeIndexRaw = colorElement.getAttribute('theme');
    if (themeIndexRaw != null) {
      const themeIndex = Number(themeIndexRaw);
      if (Number.isInteger(themeIndex) && themeIndex >= 0 && themeIndex < themePalette.length) {
        const baseThemeColor = themePalette[themeIndex];
        const tintValue = Number(colorElement.getAttribute('tint') ?? '0');
        if (Number.isFinite(tintValue) && tintValue !== 0) {
          return this.applyExcelTint(baseThemeColor, tintValue);
        }
        return baseThemeColor;
      }
    }

    return null;
  }

  // Applies Excel tint values to a hex color.
  private applyExcelTint(hexColor: string, tintValue: number): string {
    const rgb = this.hexToRgb(hexColor);
    if (!rgb) return hexColor;

    const transformChannel = (channel: number): number => {
      if (tintValue < 0) return Math.round(channel * (1 + tintValue));
      return Math.round(channel * (1 - tintValue) + 255 * tintValue);
    };

    const tintedRgb = {
      red: this.clamp(transformChannel(rgb.red), 0, 255),
      green: this.clamp(transformChannel(rgb.green), 0, 255),
      blue: this.clamp(transformChannel(rgb.blue), 0, 255),
    };
    return this.rgbToHex(tintedRgb.red, tintedRgb.green, tintedRgb.blue);
  }

  private hexToRgb(hexColor: string): { red: number; green: number; blue: number } | null {
    const normalizedHex = hexColor.replace('#', '').trim();
    if (!/^[0-9A-Fa-f]{6}$/.test(normalizedHex)) return null;
    return {
      red: Number.parseInt(normalizedHex.slice(0, 2), 16),
      green: Number.parseInt(normalizedHex.slice(2, 4), 16),
      blue: Number.parseInt(normalizedHex.slice(4, 6), 16),
    };
  }

  private rgbToHex(red: number, green: number, blue: number): string {
    const toHex = (value: number): string => value.toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  }

  // Parses workbook.xml + workbook rels to resolve sheet name to worksheet XML path.
  private resolveWorksheetXmlPath(sheetName: string, workbookXmlText: string, workbookRelsXmlText: string): string | null {
    const workbookXml = this.parseXmlDocument(workbookXmlText);
    const workbookRelsXml = this.parseXmlDocument(workbookRelsXmlText);
    if (!workbookXml || !workbookRelsXml) return null;

    let targetRelationshipId = '';
    for (const sheetElement of this.findElementsByLocalName(workbookXml, 'sheet')) {
      const candidateName = (sheetElement.getAttribute('name') ?? '').trim();
      if (candidateName !== sheetName) continue;
      targetRelationshipId = this.getAttributeValue(sheetElement, ['r:id', 'id']);
      if (targetRelationshipId) break;
    }
    if (!targetRelationshipId) return null;

    for (const relationshipElement of this.findElementsByLocalName(workbookRelsXml, 'Relationship')) {
      const relationshipId = (relationshipElement.getAttribute('Id') ?? '').trim();
      if (relationshipId !== targetRelationshipId) continue;
      const relationshipTarget = (relationshipElement.getAttribute('Target') ?? '').trim();
      if (!relationshipTarget) continue;
      return this.resolveZipRelativePath('xl/_rels/workbook.xml.rels', relationshipTarget);
    }

    return null;
  }

  // Reads textual workbook ZIP entries as UTF-8 strings.
  private readWorkbookZipFileText(workbookFiles: Record<string, unknown>, filePath: string): string | null {
    const fileBytes = this.readWorkbookZipFileBytes(workbookFiles, filePath);
    if (!fileBytes) return null;
    try {
      return new TextDecoder('utf-8').decode(fileBytes);
    } catch {
      return null;
    }
  }

  // Reads workbook ZIP entries as raw bytes.
  private readWorkbookZipFileBytes(workbookFiles: Record<string, unknown>, filePath: string): Uint8Array | null {
    const normalizedPath = this.normalizeZipPath(filePath);
    const directEntry = workbookFiles[normalizedPath];
    const matchedEntry =
      directEntry
      ?? workbookFiles[Object.keys(workbookFiles).find((key) => this.normalizeZipPath(key) === normalizedPath) ?? ''];
    if (!matchedEntry) return null;

    const unwrapBytes = (value: unknown): Uint8Array | null => {
      if (!value) return null;
      if (value instanceof Uint8Array) return value;
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      if (typeof value === 'string') {
        const bytes = new Uint8Array(value.length);
        for (let index = 0; index < value.length; index += 1) {
          bytes[index] = value.charCodeAt(index) & 0xff;
        }
        return bytes;
      }
      const recordValue = this.asRecord(value);
      if (!recordValue) return null;
      return unwrapBytes(recordValue['content'] ?? recordValue['data']);
    };

    return unwrapBytes(matchedEntry);
  }

  // Resolves relative targets from .rels files to absolute ZIP entry paths.
  private resolveZipRelativePath(basePath: string, targetPath: string): string {
    const normalizedTarget = this.normalizeZipPath(targetPath);
    if (/^[a-z]+:\/\//i.test(normalizedTarget)) return normalizedTarget;

    if (normalizedTarget.startsWith('xl/')) return normalizedTarget;
    if (normalizedTarget.startsWith('/')) return normalizedTarget.slice(1);

    const baseSegments = this.normalizeZipPath(basePath).split('/');
    baseSegments.pop();
    const targetSegments = normalizedTarget.split('/');
    const mergedSegments = [...baseSegments, ...targetSegments];

    const resolvedSegments: string[] = [];
    for (const segment of mergedSegments) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        resolvedSegments.pop();
        continue;
      }
      resolvedSegments.push(segment);
    }

    return resolvedSegments.join('/');
  }

  private normalizeZipPath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  // Provides XML query helpers that ignore namespace prefixes.
  private findFirstElementByLocalName(root: Document | Element, localName: string): Element | null {
    return this.findElementsByLocalName(root, localName)[0] ?? null;
  }

  private findElementsByLocalName(root: Document | Element, localName: string): Element[] {
    const allElements = Array.from(root.getElementsByTagName('*'));
    return allElements.filter((element) => element.localName === localName);
  }

  private getAttributeValue(element: Element | null, attributeNames: string[]): string {
    if (!element) return '';
    for (const attributeName of attributeNames) {
      const value = (element.getAttribute(attributeName) ?? '').trim();
      if (value) return value;
    }
    return '';
  }

  private parseIntegerAttribute(element: Element, attributeName: string): number | null {
    const numericValue = Number.parseInt((element.getAttribute(attributeName) ?? '').trim(), 10);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  private parseXmlDocument(xmlText: string): Document | null {
    const parsedDocument = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parserErrors = parsedDocument.getElementsByTagName('parsererror');
    if (parserErrors.length) return null;
    return parsedDocument;
  }

  private resolveImageMimeType(extension: string): string {
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'gif') return 'image/gif';
    if (extension === 'bmp') return 'image/bmp';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'svg') return 'image/svg+xml';
    return 'image/png';
  }

  private encodeBytesToBase64(imageBytes: Uint8Array, workbookBytes: Uint8Array): string {
    const bufferConstructor = (globalThis as { Buffer?: { from: (input: Uint8Array) => { toString: (encoding: string) => string } } }).Buffer;
    if (bufferConstructor) {
      return bufferConstructor.from(imageBytes).toString('base64');
    }

    const sliceSize = Math.max(512, Math.min(16384, workbookBytes.length || 4096));
    let binaryText = '';
    for (let offset = 0; offset < imageBytes.length; offset += sliceSize) {
      const slice = imageBytes.subarray(offset, Math.min(offset + sliceSize, imageBytes.length));
      binaryText += String.fromCharCode(...slice);
    }

    const btoaFunction = globalThis.btoa;
    if (!btoaFunction) return '';
    return btoaFunction(binaryText);
  }

  // Safely converts unknown values to object-like records.
  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  // Resolves XLSX color objects to CSS hex colors when possible.
  private resolveExcelColor(colorValue: unknown): string | null {
    const colorInfo = this.asRecord(colorValue);
    if (!colorInfo) return null;

    const rgbValue = typeof colorInfo['rgb'] === 'string' ? colorInfo['rgb'].trim() : '';
    if (rgbValue) {
      const normalizedRgb = rgbValue.startsWith('#') ? rgbValue.slice(1) : rgbValue;
      if (/^[0-9a-fA-F]{8}$/.test(normalizedRgb)) {
        return `#${normalizedRgb.slice(2).toUpperCase()}`;
      }
      if (/^[0-9a-fA-F]{6}$/.test(normalizedRgb)) {
        return `#${normalizedRgb.toUpperCase()}`;
      }
    }

    const indexedValue = typeof colorInfo['indexed'] === 'number' ? colorInfo['indexed'] : Number(colorInfo['indexed']);
    if (Number.isInteger(indexedValue)) {
      const indexedPalette = new Map<number, string>([
        [0, '#000000'],
        [1, '#FFFFFF'],
        [2, '#FF0000'],
        [3, '#00FF00'],
        [4, '#0000FF'],
        [5, '#FFFF00'],
        [6, '#FF00FF'],
        [7, '#00FFFF'],
        [8, '#000000'],
        [9, '#FFFFFF'],
        [10, '#FF0000'],
        [11, '#00FF00'],
        [12, '#0000FF'],
        [13, '#FFFF00'],
        [14, '#FF00FF'],
        [15, '#00FFFF'],
        [64, '#000000'],
      ]);
      return indexedPalette.get(indexedValue) ?? null;
    }

    return null;
  }

  // Translates XLSX border style definitions to CSS border expressions.
  private resolveBorderCss(borderSideInfo: Record<string, unknown> | null): string {
    if (!borderSideInfo) return '';
    const borderStyle = typeof borderSideInfo['style'] === 'string' ? borderSideInfo['style'].toLowerCase() : '';
    if (!borderStyle) return '';

    const borderMap = new Map<string, string>([
      ['hair', '1px solid'],
      ['thin', '1px solid'],
      ['medium', '2px solid'],
      ['thick', '3px solid'],
      ['double', '3px double'],
      ['dotted', '1px dotted'],
      ['dashdot', '1px dashed'],
      ['dashdotdot', '1px dashed'],
      ['dashed', '1px dashed'],
      ['mediumdashed', '2px dashed'],
      ['mediumdashdot', '2px dashed'],
      ['mediumdashdotdot', '2px dashed'],
      ['slantdashdot', '1px dashed'],
    ]);

    const mappedStyle = borderMap.get(borderStyle) ?? '1px solid';
    const borderColor = this.resolveExcelColor(borderSideInfo['color']) ?? '#94a3b8';
    return `${mappedStyle} ${borderColor}`;
  }

  // Maps workbook horizontal alignment values to CSS text-align.
  private resolveHorizontalAlignment(horizontalValue: unknown): string {
    if (typeof horizontalValue !== 'string') return '';
    const normalizedValue = horizontalValue.toLowerCase();
    if (normalizedValue === 'center' || normalizedValue === 'centercontinuous') return 'center';
    if (normalizedValue === 'right') return 'right';
    if (normalizedValue === 'justify') return 'justify';
    if (normalizedValue === 'left') return 'left';
    return '';
  }

  // Maps workbook vertical alignment values to CSS vertical-align.
  private resolveVerticalAlignment(verticalValue: unknown): string {
    if (typeof verticalValue !== 'string') return '';
    const normalizedValue = verticalValue.toLowerCase();
    if (normalizedValue === 'top') return 'top';
    if (normalizedValue === 'center') return 'middle';
    if (normalizedValue === 'bottom') return 'bottom';
    return '';
  }

  // Quotes font family names to preserve spaces and avoid malformed CSS.
  private quoteFontFamily(fontFamily: string): string {
    return `"${fontFamily.replace(/"/g, '')}"`;
  }

  private normalizeLinkTarget(url: string): string {
    const trimmedUrl = url.trim();
    if (/^(https?:|mailto:|#)/i.test(trimmedUrl)) return trimmedUrl;
    return '';
  }

  // Rebuilds preview document with the current zoom level.
  private refreshSheetPreviewZoom(): void {
    if (!this.selectedSheetHtml) return;
    this.selectedSheetDocument = this.buildSheetPreviewDocument(this.selectedSheetHtml, this.sheetInteractionToken);
    this.updateSheetPreviewUrl(this.selectedSheetDocument);
    this.armSheetFrameReadyWatchdog();
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeHtmlAttribute(text: string): string {
    return this.escapeHtml(text);
  }

  private escapeJsString(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  // Builds a full HTML document with a restricted CSP for sandboxed iframe rendering.
  private buildSheetPreviewDocument(sheetHtml: string, interactionToken: string): string {
    const interactionScript = this.buildSheetInteractionScript(interactionToken);
    return buildWorkbookPreviewDocument({
      sheetHtml,
      zoomPercent: this.sheetZoomPercent,
      interactionScript,
    });
  }

  // Creates workbook interactions: multi-select and Ctrl+wheel zoom messaging.
  private buildSheetInteractionScript(interactionToken: string): string {
    const escapedToken = this.escapeJsString(interactionToken);
    return `
(() => {
  const token = '${escapedToken}';
  window.parent.postMessage({ type: 'b5d-sheet-ready', token }, '*');
  const table = document.querySelector('.excel-grid-table');
  if (!table) return;

  const allCells = Array.from(table.querySelectorAll('td[data-r][data-c]'));
  if (!allCells.length) return;
  const rowHeaders = Array.from(table.querySelectorAll('th[data-row]'));
  const colHeaders = Array.from(table.querySelectorAll('th[data-col]'));
  const cornerHeader = table.querySelector('th[data-select-all]');
  const gridCanvas = document.querySelector('.excel-grid-canvas');

  let anchor = null;
  let selectedRanges = [];

  const parseIntAttr = (node, name) => Number.parseInt(node.getAttribute(name) || '', 10);
  const minRow = Math.min(...allCells.map((node) => parseIntAttr(node, 'data-r')));
  const maxRow = Math.max(...allCells.map((node) => parseIntAttr(node, 'data-r')));
  const minCol = Math.min(...allCells.map((node) => parseIntAttr(node, 'data-c')));
  const maxCol = Math.max(...allCells.map((node) => parseIntAttr(node, 'data-c')));

  const normalizeRange = (range) => {
    return {
      r1: Math.min(range.r1, range.r2),
      r2: Math.max(range.r1, range.r2),
      c1: Math.min(range.c1, range.c2),
      c2: Math.max(range.c1, range.c2),
    };
  };

  const sameRange = (leftRange, rightRange) => {
    return leftRange.r1 === rightRange.r1 &&
      leftRange.r2 === rightRange.r2 &&
      leftRange.c1 === rightRange.c1 &&
      leftRange.c2 === rightRange.c2;
  };

  const containsCell = (range, row, col) => {
    return row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2;
  };

  const applySelection = () => {
    allCells.forEach((cellNode) => {
      const row = parseIntAttr(cellNode, 'data-r');
      const col = parseIntAttr(cellNode, 'data-c');
      const isSelected = selectedRanges.some((range) => containsCell(range, row, col));
      cellNode.classList.toggle('excel-selection', isSelected);
    });

    rowHeaders.forEach((headerNode) => {
      const row = parseIntAttr(headerNode, 'data-row');
      const isSelected = selectedRanges.some((range) => row >= range.r1 && row <= range.r2 && range.c1 <= minCol && range.c2 >= maxCol);
      headerNode.classList.toggle('excel-selection', isSelected);
    });

    colHeaders.forEach((headerNode) => {
      const col = parseIntAttr(headerNode, 'data-col');
      const isSelected = selectedRanges.some((range) => col >= range.c1 && col <= range.c2 && range.r1 <= minRow && range.r2 >= maxRow);
      headerNode.classList.toggle('excel-selection', isSelected);
    });

    if (cornerHeader) {
      const wholeSheetSelected = selectedRanges.some((range) => range.r1 <= minRow && range.r2 >= maxRow && range.c1 <= minCol && range.c2 >= maxCol);
      cornerHeader.classList.toggle('excel-selection', wholeSheetSelected);
    }
  };

  const updateSelection = (range, mode) => {
    const normalizedRange = normalizeRange(range);
    if (mode === 'replace') {
      selectedRanges = [normalizedRange];
    } else if (mode === 'append') {
      selectedRanges.push(normalizedRange);
    } else if (mode === 'toggle') {
      const index = selectedRanges.findIndex((item) => sameRange(item, normalizedRange));
      if (index >= 0) {
        selectedRanges.splice(index, 1);
      } else {
        selectedRanges.push(normalizedRange);
      }
    }
    applySelection();
  };

  const rangeFromTarget = (targetNode) => {
    if (targetNode.hasAttribute('data-select-all')) {
      return { r1: minRow, r2: maxRow, c1: minCol, c2: maxCol, anchor: { r: minRow, c: minCol } };
    }
    if (targetNode.hasAttribute('data-row')) {
      const row = parseIntAttr(targetNode, 'data-row');
      return { r1: row, r2: row, c1: minCol, c2: maxCol, anchor: { r: row, c: minCol } };
    }
    if (targetNode.hasAttribute('data-col')) {
      const col = parseIntAttr(targetNode, 'data-col');
      return { r1: minRow, r2: maxRow, c1: col, c2: col, anchor: { r: minRow, c: col } };
    }
    const row = parseIntAttr(targetNode, 'data-r');
    const col = parseIntAttr(targetNode, 'data-c');
    return { r1: row, r2: row, c1: col, c2: col, anchor: { r: row, c: col } };
  };

  const toColumnLabel = (columnZeroBased) => {
    let value = columnZeroBased + 1;
    let label = '';
    while (value > 0) {
      const modulo = (value - 1) % 26;
      label = String.fromCharCode(65 + modulo) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  };

  const parseNumericAttr = (node, name, fallback = 0) => {
    const rawValue = node.getAttribute(name);
    if (rawValue == null) return fallback;
    const parsedValue = Number.parseFloat(rawValue);
    return Number.isFinite(parsedValue) ? parsedValue : fallback;
  };

  const findCellFromOneBasedAddress = (rowOneBased, colOneBased) => {
    if (!Number.isFinite(rowOneBased) || !Number.isFinite(colOneBased)) return null;
    const rowZeroBased = Math.max(0, Math.floor(rowOneBased - 1));
    const colZeroBased = Math.max(0, Math.floor(colOneBased - 1));
    return table.querySelector('td[data-r="' + rowZeroBased + '"][data-c="' + colZeroBased + '"]');
  };

  const repositionFloatingImages = () => {
    if (!gridCanvas) return;
    const floatingImages = Array.from(gridCanvas.querySelectorAll('.excel-floating-image[data-from-row][data-from-col]'));
    floatingImages.forEach((imageNode) => {
      const fromRow = parseNumericAttr(imageNode, 'data-from-row', 0);
      const fromCol = parseNumericAttr(imageNode, 'data-from-col', 0);
      const fromRowOffset = parseNumericAttr(imageNode, 'data-from-row-offset', 0);
      const fromColOffset = parseNumericAttr(imageNode, 'data-from-col-offset', 0);
      const fromCell = findCellFromOneBasedAddress(fromRow, fromCol);
      if (!fromCell) return;

      let left = fromCell.offsetLeft + fromColOffset;
      let top = fromCell.offsetTop + fromRowOffset;
      let width = Math.max(16, parseNumericAttr(imageNode, 'data-width-px', 100));
      let height = Math.max(16, parseNumericAttr(imageNode, 'data-height-px', 60));

      const anchorType = (imageNode.getAttribute('data-anchor-type') || '').trim();
      if (anchorType === 'twoCellAnchor') {
        const toRow = parseNumericAttr(imageNode, 'data-to-row', 0);
        const toCol = parseNumericAttr(imageNode, 'data-to-col', 0);
        const toRowOffset = parseNumericAttr(imageNode, 'data-to-row-offset', 0);
        const toColOffset = parseNumericAttr(imageNode, 'data-to-col-offset', 0);
        const toCell = findCellFromOneBasedAddress(toRow, toCol);
        if (toCell) {
          const right = toCell.offsetLeft + toColOffset;
          const bottom = toCell.offsetTop + toRowOffset;
          width = Math.max(16, right - left);
          height = Math.max(16, bottom - top);
        }
      }

      imageNode.style.left = left.toFixed(2) + 'px';
      imageNode.style.top = top.toFixed(2) + 'px';
      imageNode.style.width = width.toFixed(2) + 'px';
      imageNode.style.height = height.toFixed(2) + 'px';
    });
  };

  repositionFloatingImages();
  window.requestAnimationFrame(repositionFloatingImages);
  window.setTimeout(repositionFloatingImages, 80);
  window.setTimeout(repositionFloatingImages, 220);

  table.addEventListener('click', (event) => {
    const targetNode = event.target.closest('td[data-r][data-c], th[data-row], th[data-col], th[data-select-all]');
    if (!targetNode) return;

    const ctrlPressed = event.ctrlKey || event.metaKey;
    const shiftPressed = event.shiftKey;
    const targetRange = rangeFromTarget(targetNode);
    let mode = 'replace';
    let range = targetRange;

    if (shiftPressed && anchor) {
      range = { r1: anchor.r, r2: targetRange.anchor.r, c1: anchor.c, c2: targetRange.anchor.c, anchor: targetRange.anchor };
      mode = ctrlPressed ? 'append' : 'replace';
    } else if (ctrlPressed) {
      mode = 'toggle';
    }

    updateSelection(range, mode);
    anchor = targetRange.anchor;

    if (targetNode.matches('td[data-r][data-c]')) {
      const row = parseIntAttr(targetNode, 'data-r');
      const col = parseIntAttr(targetNode, 'data-c');
      const cellAddress = toColumnLabel(col) + String(row + 1);
      const cellValue = (targetNode.textContent || '').trim();
      const cellFormula = targetNode.getAttribute('data-f') || '';
      const computedStyle = window.getComputedStyle(targetNode);
      window.parent.postMessage({
        type: 'b5d-cell-selected',
        token,
        address: cellAddress,
        value: cellValue,
        formula: cellFormula,
        cellClassName: targetNode.className || '',
        cellInlineStyle: targetNode.getAttribute('style') || '',
        computedBackgroundColor: computedStyle.backgroundColor || '',
        computedColor: computedStyle.color || '',
        computedTextAlign: computedStyle.textAlign || '',
        computedFontWeight: computedStyle.fontWeight || '',
      }, '*');
    }
  });

  window.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 'in' : 'out';
    window.parent.postMessage({ type: 'b5d-sheet-zoom', token, direction }, '*');
  }, { passive: false });

  window.addEventListener('resize', repositionFloatingImages);
})();
`.trim();
  }

  // Tries sandbox mode first and falls back when browser policies block iframe scripts.
  private armSheetFrameReadyWatchdog(): void {
    this.sheetFrameReady = false;
    this.clearSheetFrameReadyTimeout();
    if (!this.selectedSheetDocument.trim()) return;

    this.sheetFrameReadyTimeoutId = setTimeout(() => {
      if (this.sheetFrameReady || this.sheetFrameMode !== 'sandboxed') return;
      this.sheetFrameMode = 'unsandboxed';
      this.changeDetectorRef.detectChanges();
    }, 1200);
  }

  // Clears pending script readiness checks when preview lifecycle changes.
  private clearSheetFrameReadyTimeout(): void {
    if (!this.sheetFrameReadyTimeoutId) return;
    clearTimeout(this.sheetFrameReadyTimeoutId);
    this.sheetFrameReadyTimeoutId = null;
  }

  // Removes active content and dangerous attributes from workbook HTML before iframe injection.
  private sanitizeSheetHtml(sheetHtml: string): string {
    if (!sheetHtml.trim()) return '';
    const documentParser = new DOMParser();
    const parsedDocument = documentParser.parseFromString(sheetHtml, 'text/html');

    parsedDocument.querySelectorAll('script, iframe, object, embed, link[rel="import"]').forEach((node) => {
      node.remove();
    });

    parsedDocument.querySelectorAll('*').forEach((element) => {
      for (const attributeName of element.getAttributeNames()) {
        const attributeValue = element.getAttribute(attributeName) ?? '';
        if (attributeName.toLowerCase().startsWith('on')) {
          element.removeAttribute(attributeName);
          continue;
        }
        if ((attributeName === 'href' || attributeName === 'src') && /^\s*javascript:/i.test(attributeValue)) {
          element.removeAttribute(attributeName);
        }
      }
    });

    return parsedDocument.body.innerHTML;
  }

  // Updates the iframe source using a Blob URL to avoid about:blank/srcdoc script injection noise.
  private updateSheetPreviewUrl(documentHtml: string): void {
    this.releaseSheetBlobUrl();
    if (!documentHtml.trim()) {
      this.sheetPreviewUrl = this.domSanitizer.bypassSecurityTrustResourceUrl(
        'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Cbody%3E%3C/body%3E%3C/html%3E',
      );
      return;
    }

    this.currentSheetBlobUrl = URL.createObjectURL(new Blob([documentHtml], { type: 'text/html' }));
    this.sheetPreviewUrl = this.domSanitizer.bypassSecurityTrustResourceUrl(this.currentSheetBlobUrl);
  }

  // Frees previous Blob URLs to avoid retaining workbook preview documents in memory.
  private releaseSheetBlobUrl(): void {
    if (!this.currentSheetBlobUrl) return;
    URL.revokeObjectURL(this.currentSheetBlobUrl);
    this.currentSheetBlobUrl = null;
  }

  // Supports base64, data URL, JSON byte arrays, and binary strings from backend payloads.
  private decodeWorkbookPayload(payload: string): Uint8Array {
    const cleanedPayload = payload.trim();
    if (!cleanedPayload) {
      throw new Error('Workbook payload is empty.');
    }

    if (cleanedPayload.startsWith('data:')) {
      const commaPosition = cleanedPayload.indexOf(',');
      const contentSection = commaPosition >= 0 ? cleanedPayload.slice(commaPosition + 1) : '';
      return this.decodeBase64(contentSection);
    }

    if (cleanedPayload.startsWith('[') && cleanedPayload.endsWith(']')) {
      const parsedValue = JSON.parse(cleanedPayload);
      if (Array.isArray(parsedValue) && parsedValue.every((value) => Number.isInteger(value))) {
        return Uint8Array.from(parsedValue as number[]);
      }
    }

    if (this.looksLikeBase64(cleanedPayload)) {
      return this.decodeBase64(cleanedPayload);
    }

    const bytes = new Uint8Array(cleanedPayload.length);
    for (let index = 0; index < cleanedPayload.length; index += 1) {
      bytes[index] = cleanedPayload.charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  private decodeBase64(base64Value: string): Uint8Array {
    const atobFunction = globalThis.atob;
    if (!atobFunction) {
      throw new Error('Base64 decoder is not available in this runtime.');
    }
    const normalizedBase64 = base64Value.replace(/\s+/g, '');
    const binaryString = atobFunction(normalizedBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }
    return bytes;
  }

  private looksLikeBase64(value: string): boolean {
    return value.length % 4 === 0 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
  }

  // Parses A1-style addresses into one-based row and column indexes.
  private parseCellAddress(cellAddress: string): { row: number; col: number } | null {
    const match = /^([A-Za-z]+)(\d+)$/.exec((cellAddress || '').trim());
    if (!match) return null;

    const rowNumber = Number.parseInt(match[2], 10);
    if (!Number.isFinite(rowNumber) || rowNumber <= 0) return null;

    let columnNumber = 0;
    for (const char of match[1].toUpperCase()) {
      columnNumber = columnNumber * 26 + (char.charCodeAt(0) - 64);
    }
    if (!Number.isFinite(columnNumber) || columnNumber <= 0) return null;

    return { row: rowNumber, col: columnNumber };
  }

  // Generates a short token to scope iframe interaction messages to the active sheet.
  private generateInteractionToken(): string {
    const cryptoObject = globalThis.crypto;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
      return cryptoObject.randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }

  private clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(maxValue, Math.max(minValue, value));
  }
}
