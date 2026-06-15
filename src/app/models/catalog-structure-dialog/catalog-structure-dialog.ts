import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CatalogoB5DOrm } from '../../types/b5d-orm';
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
  @Input() loading = false;
  @Output() saveRequested = new EventEmitter<CatalogStructureDraft>();
  @Output() closeRequested = new EventEmitter<void>();

  readonly i18n = inject(I18nService);
  readonly translations = CATALOG_STRUCTURE_DIALOG_TRANSLATIONS;

  formDraft: CatalogStructureDraft = this.createEmptyDraft();
  validationMessage = '';

  // Refreshes the form draft whenever the dialog context changes.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['catalog'] || changes['mode'] || changes['visible']) {
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

  get canCopyLinks(): boolean {
    return this.copySourceCatalogs.length > 0;
  }

  // Stores the selected PlanAXA file and clears the validation message.
  handleFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formDraft.archivo = input.files?.[0] ?? null;
    this.validationMessage = '';
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
    } else if (this.mode === 'create') {
      this.formDraft = this.createEmptyDraft();
    }
    this.validationMessage = '';
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
