import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { CatalogMetadataOrm, CatalogoB5DOrm } from '../../types/b5d-orm';
import { BackendProyectosService, type PrevisualizarCostosCatalogoAxaResponse } from '../../services/backend-proyectos.service';
import { I18nService } from '../../utils/i18n/i18n.service';
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
export class CatalogStructureDialog implements OnChanges {
  @Input() visible = false;
  @Input() mode: CatalogStructureMode = 'create';
  @Input() catalog: CatalogoB5DOrm | null = null;
  @Input() catalogs: CatalogoB5DOrm[] = [];
  @Input() projectId: number | null = null;
  @Input() loading = false;
  @Output() saveRequested = new EventEmitter<CatalogStructureDraft>();
  @Output() metadataImportRequested = new EventEmitter<File>();
  @Output() costImportRequested = new EventEmitter<CatalogCostImportDraft>();
  @Output() closeRequested = new EventEmitter<void>();

  readonly i18n = inject(I18nService);
  readonly translations = CATALOG_STRUCTURE_DIALOG_TRANSLATIONS;
  private readonly backendProyectos = inject(BackendProyectosService);

  formDraft: CatalogStructureDraft = this.createEmptyDraft();
  metadataArchivo: File | null = null;
  costArchivo: File | null = null;
  costPreviewRows: CatalogCostPreviewRow[] = [];
  costPreviewMessage = '';
  costValidationMessage = '';
  costPreviewLoading = false;
  validationMessage = '';
  private costPreviewRequestId = 0;
  private selectedCostConceptIds: number[] = [];

  // Refreshes the form draft whenever the dialog context changes.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['catalog'] || changes['mode'] || changes['visible'] || changes['projectId']) {
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
    return this.formDraft.archivo?.name || this.catalog?.catalogo_externo || '';
  }

  get copySourceCatalogs(): CatalogoB5DOrm[] {
    return this.catalogs;
  }

  get catalogMetadata(): CatalogMetadataOrm | null {
    return this.catalog?.catalog_metadata ?? null;
  }

  get selectedMetadataFileName(): string {
    return this.metadataArchivo?.name || '';
  }

  get selectedCostFileName(): string {
    return this.costArchivo?.name || '';
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

  get canImportCosts(): boolean {
    return !!this.projectId && !!this.catalog && !!this.costArchivo && !this.loading && !this.costPreviewLoading && this.hasCostPreview;
  }

  isCostSelected(conceptoId: number | null): boolean {
    return conceptoId != null && this.selectedCostConceptIds.includes(conceptoId);
  }

  // Stores the selected PlanAXA file and clears the validation message.
  handleFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formDraft.archivo = input.files?.[0] ?? null;
    this.validationMessage = '';
    input.value = '';
  }

  // Stores the selected XDB file for metadata-only imports.
  handleMetadataFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.metadataArchivo = input.files?.[0] ?? null;
    this.validationMessage = '';
    input.value = '';
  }

  // Stores the selected XDB file for cost imports and refreshes the preview.
  handleCostFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.costArchivo = input.files?.[0] ?? null;
    this.costPreviewRequestId += 1;
    this.costPreviewRows = [];
    this.costPreviewMessage = '';
    this.costValidationMessage = '';
    this.selectedCostConceptIds = [];
    input.value = '';

    if (this.costArchivo) {
      void this.refreshCostPreview();
    }
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

  // Emits a metadata import request when the user selected a source XDB.
  submitMetadataImport(): void {
    if (!this.metadataArchivo) {
      this.validationMessage = this.i18n.translateForComponent(this.translations, 'catalogDialog.requiredMetadataFile');
      return;
    }

    this.metadataImportRequested.emit(this.metadataArchivo);
  }

  // Emits the cost import request with the rows the user approved in the preview.
  submitCostImport(): void {
    if (!this.costArchivo) {
      this.costValidationMessage = this.i18n.translateForComponent(this.translations, 'catalogDialog.requiredCostFile');
      return;
    }

    if (!this.selectedCostConceptIds.length) {
      this.costValidationMessage = this.i18n.translateForComponent(this.translations, 'catalogDialog.requiredCostSelection');
      return;
    }

    this.costImportRequested.emit({
      archivo: this.costArchivo,
      conceptos_seleccionados: [...this.selectedCostConceptIds],
    });
  }

  formatCostValue(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return '-';
    return value.toFixed(4).replace(/\.?0+$/, '');
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
    if (this.mode === 'info' && this.catalog) {
      this.formDraft = {
        nombre: this.catalog.nombre ?? '',
        descripcion: this.catalog.descripcion ?? '',
        propiedad_tipo_bim: this.catalog.propiedad_tipo_bim ?? 'Name',
        grupo_cantidades_bim: this.catalog.grupo_cantidades_bim ?? '',
        archivo: null,
        copiar_vinculos: false,
        copiar_vinculos_desde_catalogo_id: null,
      };
      this.metadataArchivo = null;
      this.costArchivo = null;
      this.costPreviewRows = [];
      this.costPreviewMessage = '';
      this.costValidationMessage = '';
      this.costPreviewLoading = false;
      this.selectedCostConceptIds = [];
      this.costPreviewRequestId += 1;
    } else if (this.mode === 'create') {
      this.formDraft = this.createEmptyDraft();
      this.metadataArchivo = null;
      this.costArchivo = null;
      this.costPreviewRows = [];
      this.costPreviewMessage = '';
      this.costValidationMessage = '';
      this.costPreviewLoading = false;
      this.selectedCostConceptIds = [];
      this.costPreviewRequestId += 1;
    }
    this.validationMessage = '';
  }

  // Loads the preview rows for the currently selected cost XDB.
  private async refreshCostPreview(): Promise<void> {
    if (this.mode !== 'info' || !this.visible || !this.projectId || !this.catalog || !this.costArchivo) return;

    const requestId = ++this.costPreviewRequestId;
    this.costPreviewLoading = true;
    this.costPreviewMessage = this.i18n.translateForComponent(this.translations, 'catalogDialog.costPreviewLoading');
    this.costValidationMessage = '';

    try {
      const response = await firstValueFrom(
        this.backendProyectos.previsualizarCostosCatalogoAxa(this.projectId, this.catalog.id, {
          archivo: this.costArchivo,
        }),
      );
      if (requestId !== this.costPreviewRequestId) return;

      this.costPreviewRows = response.preview.resultados;
      this.selectedCostConceptIds = this.costPreviewRows
        .filter((row) => row.puede_importarse && row.catalogo_concepto_id != null)
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
}
