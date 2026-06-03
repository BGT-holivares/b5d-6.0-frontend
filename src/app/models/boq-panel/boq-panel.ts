import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BackendProyectosService } from '../../services/backend-proyectos.service';
import { WorkbookPreviewCacheService } from '../../services/workbook-preview-cache.service';
import { ResizableTableDirective } from '../../directives/resizable-table/resizable-table.directive';
import { XlsxPreview } from '../xlsx-preview/xlsx-preview';
import type {
  CuantificacionB5DOrm,
  ProyectoTrabajoOrm,
  WorkbookCellChangeOrm,
} from '../../types/b5d-orm';

type QuantificationGroupRow = {
  groupName: string;
  items: CuantificacionB5DOrm[];
};


@Component({
  selector: 'app-boq-panel',
  imports: [ResizableTableDirective, XlsxPreview],
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

  // Keeps the quantification list in sync after upload/save operations.
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

  // Recomputes the preview view after zoom controls change the scale.
  private refreshSheetPreviewZoom(): void {
    this.changeDetectorRef.detectChanges();
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

    try {
      const projectId = this.activeProject?.id ?? null;
      if (!projectId) return;
      const workbookSummary = await this.workbookPreviewCache.getWorkbookSummary(projectId, selection.id);
      if (localToken !== this.workbookLoadToken) return;
      if (!workbookSummary.sheets.length) {
        this.workbookError = 'El libro Excel no contiene hojas visibles para mostrar.';
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
        this.workbookError = 'No se pudo leer el contenido Excel de esta cuantificacion.';
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
