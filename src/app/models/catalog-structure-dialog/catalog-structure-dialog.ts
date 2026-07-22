import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { CatalogMetadataOrm, CatalogoB5DOrm } from '../../types/b5d-orm';
import { BackendProyectosService, type PrevisualizarCostosCatalogoAxaResponse } from '../../services/backend-proyectos.service';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';
import { CATALOG_STRUCTURE_DIALOG_TRANSLATIONS } from './catalog-structure-dialog.translations';

type CatalogStructureMode = 'create' | 'info';

export type CatalogStructureDraft = {
  nombre: string;
  descripcion: string;
  propiedad_tipo_bim: string;
  grupo_cantidades_bim: string;
  archivo: File | null;
  copiar_vinculos: boolean;
  copiar_vinculos_desde_catalogo_id: number | null;
};

export type CatalogCostImportDraft = {
  archivo: File;
  conceptos_seleccionados: number[];
};

type CatalogCostPreviewRow = PrevisualizarCostosCatalogoAxaResponse['preview']['resultados'][number];

@Component({
  selector: 'app-catalog-structure-dialog',
  imports: [CommonModule, FormsModule],
  templateUrl: './catalog-structure-dialog.html',
  styleUrl: './catalog-structure-dialog.scss',
})
export class CatalogStructureDialog implements OnChanges, OnDestroy {
  @Input() visible = false;
  @Input() mode: CatalogStructureMode = 'create';
  @Input() catalog: CatalogoB5DOrm | null = null;
  @Input() catalogs: CatalogoB5DOrm[] = [];
  @Input() projectId: number | null = null;
  @Input() loading = false;
  @Output() saveRequested = new EventEmitter<CatalogStructureDraft>();
  @Output() importRequested = new EventEmitter<CatalogCostImportDraft>();
  @Output() closeRequested = new EventEmitter<void>();

  readonly i18n = inject(I18nService);
  readonly globalTranslations = GLOBAL_TRANSLATIONS;
  readonly translations = CATALOG_STRUCTURE_DIALOG_TRANSLATIONS;
  private readonly backendProyectos = inject(BackendProyectosService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  formDraft: CatalogStructureDraft = this.createEmptyDraft();
  costPreviewRows: CatalogCostPreviewRow[] = [];
  costPreviewMessage = '';
  costValidationMessage = '';
  costPreviewLoading = false;
  costPreviewProgress = 0;
  validationMessage = '';
  private costPreviewRequestId = 0;
  private costPreviewProgressTimer: ReturnType<typeof setInterval> | null = null;
  private selectedCostConceptIds: number[] = [];
  private lastCatalogId: number | null = null;

  // Refreshes the form draft whenever the dialog context changes.
  ngOnChanges(changes: SimpleChanges): void {
    const nextCatalogId = this.catalog?.id ?? null;
    const catalogChanged =
      changes['catalog'] &&
      (changes['catalog'].firstChange || this.lastCatalogId !== nextCatalogId);
    if (catalogChanged || changes['mode'] || changes['visible'] || changes['projectId']) {
      this.resetDraft();
    }
  }

  get titleKey(): string {
    return this.mode === 'info' ? 'catalogDialog.infoTitle' : 'catalogDialog.createTitle';
  }

  get isReadOnly(): boolean {
    return this.mode === 'info';
  }

  get selectedFileName(): string {
    if (this.mode === 'create') {
      return this.formDraft.archivo?.name || this.catalog?.catalogo_externo || '';
    }
    return this.formDraft.archivo?.name || '';
  }

  get copySourceCatalogs(): CatalogoB5DOrm[] {
    return this.catalogs;
  }

  get catalogMetadata(): CatalogMetadataOrm | null {
    return this.catalog?.catalog_metadata ?? null;
  }

  get canCopyLinks(): boolean {
    return this.copySourceCatalogs.length > 0;
  }

  get selectedCostCount(): number {
    return this.selectedCostConceptIds.length;
  }

  get totalCostCount(): number {
    return this.costPreviewRows.length;
  }

  get importableCostCount(): number {
    return this.costPreviewRows.filter((row) => row.puede_importarse && row.catalogo_concepto_id != null).length;
  }

  get hasCostPreview(): boolean {
    return this.costPreviewRows.length > 0;
  }

  get canImport(): boolean {
    return !!this.projectId && !!this.catalog && !!this.formDraft.archivo && !this.costPreviewLoading && this.hasCostPreview && this.selectedCostCount > 0;
  }

  private toNumericValue(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const numericValue = Number(value.trim());
      return Number.isFinite(numericValue) ? numericValue : null;
    }
    return null;
  }

  isCostSelected(conceptoId: number | null): boolean {
    return conceptoId != null && this.selectedCostConceptIds.includes(conceptoId);
  }

  // Stores the selected XDB file and clears the validation message.
  handleFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formDraft.archivo = input.files?.[0] ?? null;
    this.validationMessage = '';
    this.costValidationMessage = '';
    if (this.mode === 'info') {
      this.costPreviewRequestId += 1;
      this.stopCostPreviewProgress();
      this.costPreviewRows = [];
      this.costPreviewMessage = '';
      this.selectedCostConceptIds = [];
      this.costPreviewProgress = 0;
      if (this.formDraft.archivo) {
        void this.refreshCostPreview();
      }
    }
    input.value = '';
  }

  // Enables or disables the link-copy option and keeps the source selection valid.
  handleCopyLinksToggle(enabled: boolean): void {
    this.formDraft.copiar_vinculos = enabled;
    if (!enabled) {
      this.formDraft.copiar_vinculos_desde_catalogo_id = null;
      this.validationMessage = '';
      return;
    }

    if (this.formDraft.copiar_vinculos_desde_catalogo_id == null) {
      this.formDraft.copiar_vinculos_desde_catalogo_id = this.copySourceCatalogs[0]?.id ?? null;
    }
    this.validationMessage = '';
  }

  // Emits the close request so the host can hide the dialog.
  closeDialog(): void {
    if (this.loading) return;
    this.closeRequested.emit();
  }

  // Validates the form and emits the import request when the data is ready.
  submitForm(): void {
    if (this.isReadOnly) return;

    const nombre = this.formDraft.nombre.trim();
    if (!nombre) {
      this.validationMessage = 'El nombre de la estructura es obligatorio.';
      return;
    }

    if (this.formDraft.copiar_vinculos && this.formDraft.copiar_vinculos_desde_catalogo_id == null) {
      this.validationMessage = this.i18n.translateForComponent(this.translations, 'catalogDialog.requiredCopySource');
      return;
    }

    this.saveRequested.emit({
      nombre,
      descripcion: this.formDraft.descripcion.trim(),
      propiedad_tipo_bim: this.formDraft.propiedad_tipo_bim.trim() || 'Name',
      grupo_cantidades_bim: this.formDraft.grupo_cantidades_bim.trim(),
      archivo: this.formDraft.archivo,
      copiar_vinculos: this.formDraft.copiar_vinculos,
      copiar_vinculos_desde_catalogo_id: this.formDraft.copiar_vinculos_desde_catalogo_id,
    });
  }

  // Emits the combined metadata and cost import request when the data is ready.
  submitImport(): void {
    if (!this.formDraft.archivo || !this.selectedCostConceptIds.length) {
      this.costValidationMessage = this.i18n.translateForComponent(this.translations, 'catalogDialog.requiredCostSelection');
      return;
    }

    this.importRequested.emit({
      archivo: this.formDraft.archivo,
      conceptos_seleccionados: [...this.selectedCostConceptIds],
    });
  }

  formatCostValue(value: number | string | null | undefined): string {
    const numericValue = this.toNumericValue(value);
    if (numericValue == null) return '-';
    return numericValue.toFixed(4).replace(/\.?0+$/, '');
  }

  // Enables or disables one cost row in the selection list.
  toggleCostSelection(conceptoId: number | null, enabled: boolean): void {
    if (conceptoId == null) return;

    const nextSelection = new Set(this.selectedCostConceptIds);
    if (enabled) {
      nextSelection.add(conceptoId);
    } else {
      nextSelection.delete(conceptoId);
    }
    this.selectedCostConceptIds = [...nextSelection];
    this.costValidationMessage = '';
  }

  // Enables or disables all importable cost rows at once.
  setAllCostSelections(enabled: boolean): void {
    if (!enabled) {
      this.selectedCostConceptIds = [];
      this.costValidationMessage = '';
      return;
    }

    this.selectedCostConceptIds = this.costPreviewRows
      .filter((row) => row.puede_importarse && row.catalogo_concepto_id != null)
      .map((row) => row.catalogo_concepto_id as number);
    this.costValidationMessage = '';
  }

  // Resets the dialog form to the selected catalog or to an empty draft.
  private resetDraft(): void {
    this.stopCostPreviewProgress();
    if (this.mode === 'info' && this.catalog) {
      this.lastCatalogId = this.catalog.id;
      this.formDraft = {
        nombre: this.catalog.nombre ?? '',
        descripcion: this.catalog.descripcion ?? '',
        propiedad_tipo_bim: this.catalog.propiedad_tipo_bim ?? 'Name',
        grupo_cantidades_bim: this.catalog.grupo_cantidades_bim ?? '',
        archivo: null,
        copiar_vinculos: false,
        copiar_vinculos_desde_catalogo_id: null,
      };
      this.costPreviewRows = [];
      this.costPreviewMessage = '';
      this.costValidationMessage = '';
      this.costPreviewLoading = false;
      this.costPreviewProgress = 0;
      this.selectedCostConceptIds = [];
      this.costPreviewRequestId += 1;
    } else if (this.mode === 'create') {
      this.lastCatalogId = null;
      this.formDraft = this.createEmptyDraft();
      this.costPreviewRows = [];
      this.costPreviewMessage = '';
      this.costValidationMessage = '';
      this.costPreviewLoading = false;
      this.costPreviewProgress = 0;
      this.selectedCostConceptIds = [];
      this.costPreviewRequestId += 1;
    }
    this.validationMessage = '';
  }

  // Loads the preview rows for the currently selected cost XDB.
  private async refreshCostPreview(): Promise<void> {
    if (this.mode !== 'info' || !this.visible || !this.projectId || !this.catalog || !this.formDraft.archivo) return;

    const requestId = ++this.costPreviewRequestId;
    this.startCostPreviewProgress();
    this.costPreviewLoading = true;
    this.costPreviewMessage = this.i18n.translateForComponent(this.translations, 'catalogDialog.costPreviewLoading');
    this.costValidationMessage = '';

    try {
      const response = await firstValueFrom(
        this.backendProyectos.previsualizarCostosCatalogoAxa(this.projectId, this.catalog.id, {
          archivo: this.formDraft.archivo,
        }),
      );
      if (requestId !== this.costPreviewRequestId) return;

      this.costPreviewRows = response.preview.resultados;
      this.selectedCostConceptIds = this.costPreviewRows
        .filter((row) => row.seleccionado && row.catalogo_concepto_id != null)
        .map((row) => row.catalogo_concepto_id as number);
      this.costPreviewMessage = this.costPreviewRows.length
        ? this.i18n.translateForComponent(this.translations, 'catalogDialog.costPreviewReady')
        : this.i18n.translateForComponent(this.translations, 'catalogDialog.costPreviewEmpty');
    } catch (error) {
      if (requestId !== this.costPreviewRequestId) return;
      this.costPreviewRows = [];
      this.selectedCostConceptIds = [];
      const fallbackMessage = this.i18n.translateForComponent(this.translations, 'catalogDialog.costPreviewError');
      this.costPreviewMessage = this.resolveErrorMessage(error, fallbackMessage);
      this.costValidationMessage = '';
    } finally {
      if (requestId !== this.costPreviewRequestId) return;
      this.costPreviewLoading = false;
      this.costPreviewProgress = 100;
      this.stopCostPreviewProgress();
      this.changeDetectorRef.detectChanges();
    }
  }

  private startCostPreviewProgress(): void {
    this.stopCostPreviewProgress();
    this.costPreviewProgress = 10;
    this.changeDetectorRef.detectChanges();
    const startedAt = Date.now();
    this.costPreviewProgressTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      let nextProgress = 10;
      if (elapsed < 1200) {
        nextProgress = 10 + elapsed / 40;
      } else if (elapsed < 4200) {
        nextProgress = 40 + (elapsed - 1200) / 65;
      } else {
        const tailElapsed = elapsed - 4200;
        nextProgress = 86 + 13 * (1 - Math.exp(-tailElapsed / 180000));
      }
      this.costPreviewProgress = Math.min(99.5, nextProgress);
      this.changeDetectorRef.detectChanges();
    }, 150);
  }

  private stopCostPreviewProgress(): void {
    if (this.costPreviewProgressTimer) {
      clearInterval(this.costPreviewProgressTimer);
      this.costPreviewProgressTimer = null;
    }
  }

  private resolveErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const httpError = error as { error?: { error?: string } };
      const message = httpError.error?.error;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }

  // Creates an empty draft used by the concept-structure import flow.
  private createEmptyDraft(): CatalogStructureDraft {
    return {
      nombre: '',
      descripcion: '',
      propiedad_tipo_bim: 'Name',
      grupo_cantidades_bim: '',
      archivo: null,
      copiar_vinculos: false,
      copiar_vinculos_desde_catalogo_id: null,
    };
  }

  ngOnDestroy(): void {
    this.stopCostPreviewProgress();
  }
}
