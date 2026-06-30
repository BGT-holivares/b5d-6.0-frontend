import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkbookPreviewCacheService } from '../../services/workbook-preview-cache.service';
import type {
  CatalogoB5DOrm,
  ConceptoB5DOrm,
  CuantificacionB5DOrm,
  ParametroB5DOrm,
  ProyectoTrabajoOrm,
  WorkbookSummarySheetOrm,
} from '../../types/b5d-orm';
import {
  buildParametersReportData,
  extractBoqRows,
  type BoqExtractedRow,
  type ParametersReportData,
} from '../../utils/parameters/parameters-report-analysis';

@Component({
  selector: 'app-parameters-report-panel',
  imports: [CommonModule, FormsModule],
  templateUrl: './parameters-report-panel.html',
  styleUrl: './parameters-report-panel.scss',
})
export class ParametersReportPanel implements OnChanges {
  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Input() parameters: ParametroB5DOrm[] = [];
  @Input() concepts: ConceptoB5DOrm[] = [];
  @Input() catalogs: CatalogoB5DOrm[] = [];
  @Input() activeCatalogId: number | null = null;
  @Input() b5dLoading = false;
  @Input() quantifications: CuantificacionB5DOrm[] = [];
  @Input() conceptKeys: string[] = [];
  @Output() conceptSelectionRequested = new EventEmitter<string>();

  workQuantifications: CuantificacionB5DOrm[] = [];
  selectedQuantificationId: number | null = null;
  selectedSheetIndex = 0;
  selectedCatalogId: number | null = null;
  boqSheets: WorkbookSummarySheetOrm[] = [];
  boqRows: BoqExtractedRow[] = [];
  reportData: ParametersReportData = this.createEmptyReportData();
  loading = false;
  error = '';
  reportRefreshToken = 0;

  private readonly workbookPreviewCache = inject(WorkbookPreviewCacheService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private loadToken = 0;

  ngOnChanges(changes: SimpleChanges): void {
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
      void this.loadReportWorkbook();
    }

    if (changes['activeProject']) {
      void this.loadReportWorkbook();
    }

    if (changes['parameters'] || changes['concepts'] || changes['catalogs'] || changes['activeCatalogId']) {
      this.syncSelectedCatalog();
      this.rebuildReportData();
    }
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
        nombre: `Catalogo ${catalogId}`,
        descripcion: null,
        grupo_cantidades_bim: null,
        propiedad_tipo_bim: null,
        catalogo_externo: null,
      });
    }
    return fallbackCatalogs;
  }

  get selectedCatalogLabel(): string {
    const selectedCatalog = this.availableCostCatalogs.find((catalog) => catalog.id === this.selectedCatalogId);
    return selectedCatalog?.nombre ?? selectedCatalog?.descripcion ?? 'Catalogo de costos';
  }

  get hasReportData(): boolean {
    return !!this.boqRows.length || !!this.reportData.quantityRows.length || !!this.reportData.costRows.length || !!this.reportData.unassignedRows.length;
  }

  selectQuantification(value: number | null): void {
    this.selectedQuantificationId = value;
    this.selectedSheetIndex = 0;
    void this.loadReportWorkbook();
  }

  selectSheet(value: number | null): void {
    if (value == null || value === this.selectedSheetIndex) return;
    this.selectedSheetIndex = value;
    void this.loadReportWorkbook();
  }

  selectCatalog(value: number | null): void {
    this.selectedCatalogId = value;
    this.rebuildReportData();
  }

  requestConceptSelection(conceptKey: string | null | undefined): void {
    const normalizedKey = (conceptKey ?? '').trim();
    if (!normalizedKey || !this.isKnownConceptKey(normalizedKey)) return;
    this.conceptSelectionRequested.emit(normalizedKey);
  }

  resetView(): void {
    const preferredQuantification = this.quantificationsWithWorkbook.find((row) => row.id === this.selectedQuantificationId)
      ?? this.quantificationsWithWorkbook[0]
      ?? null;
    this.selectedQuantificationId = preferredQuantification?.id ?? null;
    this.selectedSheetIndex = 0;
    this.syncSelectedCatalog();
    this.reportRefreshToken += 1;
    void this.loadReportWorkbook();
  }

  formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  trackByRow(_index: number, row: BoqExtractedRow): string {
    return `${row.row}-${row.clave}-${row.descripcion}`;
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

    if (!projectId || quantificationId == null) {
      this.loading = false;
      this.rebuildReportData();
      return;
    }

    try {
      const summary = await this.workbookPreviewCache.getWorkbookSummary(projectId, quantificationId);
      if (localToken !== this.loadToken) return;
      this.boqSheets = summary.sheets ?? [];
      if (!this.boqSheets.length) {
        this.error = 'La cuantificacion seleccionada no contiene hojas de Excel visibles.';
        return;
      }

      if (!this.boqSheets.some((sheet) => sheet.index === this.selectedSheetIndex)) {
        this.selectedSheetIndex = this.boqSheets[0]?.index ?? 0;
      }

      const layers = await this.workbookPreviewCache.getWorkbookSheetLayers(projectId, quantificationId, this.selectedSheetIndex);
      if (localToken !== this.loadToken) return;
      this.boqRows = extractBoqRows(layers.cells);
      this.rebuildReportData();
    } catch {
      if (localToken === this.loadToken) {
        this.error = 'No se pudo leer el libro Excel de la cuantificacion seleccionada.';
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
    );
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
      quantityRows: [],
      costRows: [],
      unassignedRows: [],
    };
  }

  private isKnownConceptKey(conceptKey: string): boolean {
    const normalizedConceptKey = conceptKey.trim().toLowerCase();
    if (!normalizedConceptKey) return false;
    return this.conceptKeys.some((candidateKey) => candidateKey.trim().toLowerCase() === normalizedConceptKey);
  }
}
