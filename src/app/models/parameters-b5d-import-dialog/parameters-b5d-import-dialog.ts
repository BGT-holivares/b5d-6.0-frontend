import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BackendProyectosService, type B5dImportTiming } from '../../services/backend-proyectos.service';
import { LoadingPanelService } from '../../services/loading-panel.service';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';
import type { ProyectoTrabajoOrm } from '../../types/b5d-orm';
import { createParameterImportPlan } from '../../utils/loading-panel/loading-plans';
import { buildParameterImportPreviewRows, type ParameterImportPreviewRow } from '../../utils/parameters/parameter-preview-grouping';
import { PARAMETERS_B5D_IMPORT_DIALOG_TRANSLATIONS } from './parameters-b5d-import-dialog.translations';

type B5dImportCandidate = {
  file: File;
  relativePath: string;
  enabled: boolean;
  size: string;
};

type B5dPreviewRow = ParameterImportPreviewRow;

export type B5dParameterImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  count: number;
  tipo_parametro: string;
};

@Component({
  selector: 'app-parameters-b5d-import-dialog',
  imports: [CommonModule, FormsModule],
  templateUrl: './parameters-b5d-import-dialog.html',
  styleUrl: '../parameters-xdb-import-dialog/parameters-xdb-import-dialog.scss',
})
export class ParametersB5dImportDialog implements OnChanges, OnDestroy {
  private readonly maxUploadSizeBytes = 5 * 1024 * 1024 * 1024;
  @Input() visible = false;
  @Input() loading = false;
  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Output() closeRequested = new EventEmitter<void>();
  @Output() importCompleted = new EventEmitter<B5dParameterImportSummary>();

  @ViewChild('dialogPanel') private readonly dialogPanel?: ElementRef<HTMLElement>;

  readonly i18n = inject(I18nService);
  readonly globalTranslations = GLOBAL_TRANSLATIONS;
  readonly translations = PARAMETERS_B5D_IMPORT_DIALOG_TRANSLATIONS;

  folderName = '';
  candidates: B5dImportCandidate[] = [];
  tipoEdificacionValue = '';
  tipoObraValue = '';
  zonaValue = '';
  previewRows: B5dPreviewRow[] = [];
  validationMessage = '';
  previewMessage = '';
  processingMessage = '';
  importMessage = '';
  previewLoading = false;
  previewDirty = false;
  previewProgress = 0;
  isImporting = false;

  private readonly backendProyectos = inject(BackendProyectosService);
  private readonly loadingPanel = inject(LoadingPanelService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private previewRequestId = 0;
  private previewProgressTimer: ReturnType<typeof setInterval> | null = null;
  private previewStatusTimer: ReturnType<typeof setInterval> | null = null;
  private previewStatusPollingInFlight = false;
  private importStatusTimer: ReturnType<typeof setInterval> | null = null;
  private importStatusPollingInFlight = false;
  private importProgressTimeout: ReturnType<typeof setTimeout> | null = null;
  private importProgressInterval: ReturnType<typeof setInterval> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && !this.visible) {
      this.resetState();
    }
  }

  ngOnDestroy(): void {
    this.stopPreviewProgress();
    this.stopPreviewStatusPolling();
    this.stopImportStatusPolling();
    this.stopImportProgress();
  }

  get selectedCandidates(): B5dImportCandidate[] {
    return this.candidates.filter((candidate) => candidate.enabled);
  }

  get selectedCount(): number {
    return this.selectedCandidates.length;
  }

  get totalCount(): number {
    return this.candidates.length;
  }

  get hasSelectedFiles(): boolean {
    return this.totalCount > 0;
  }

  get hasRequiredMetadata(): boolean {
    return !!this.tipoEdificacionValue.trim() && !!this.tipoObraValue.trim() && !!this.zonaValue.trim();
  }

  get hasOversizedSelectedFiles(): boolean {
    return this.selectedCandidates.some((candidate) => candidate.file.size > this.maxUploadSizeBytes);
  }

  get hasValidSelectedFileSizes(): boolean {
    return this.selectedCandidates.every((candidate) => this.parseCandidateSize(candidate.size) != null);
  }

  get canImport(): boolean {
    return (
      !!this.activeProject &&
      !this.isImporting &&
      !this.loading &&
      this.hasPreview &&
      !this.previewLoading &&
      !this.previewDirty &&
      !this.hasOversizedSelectedFiles &&
      this.hasValidSelectedFileSizes
    );
  }

  get canGeneratePreview(): boolean {
    return (
      !!this.activeProject &&
      !this.isImporting &&
      !this.loading &&
      this.selectedCount > 0 &&
      this.hasRequiredMetadata &&
      !this.hasOversizedSelectedFiles &&
      this.hasValidSelectedFileSizes
    );
  }

  get sourceLabelValue(): string {
    return this.folderName || this.i18n.translateForComponent(this.translations, 'parametersB5dImport.noFiles');
  }

  t(key: string): string {
    return this.i18n.translateForComponent(this.translations, key);
  }

  handleFilesChange(event: Event): void {
    this.handleFilesSelection(event);
  }

  onMetadataChange(): void {
    if (!this.hasSelectedFiles) return;
    this.markPreviewStale();
  }

  private handleFilesSelection(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.validationMessage = '';
    this.importMessage = '';
    this.processingMessage = '';

    const b5dFiles = files
      .filter((file) => file.name.toLowerCase().endsWith('.b5d'))
      .map((file) => ({
        file,
        relativePath: file.name,
        enabled: true,
        size: '',
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'es'));

    this.candidates = b5dFiles;
    this.folderName = b5dFiles.length === 1
      ? b5dFiles[0]?.relativePath ?? ''
      : b5dFiles.length
        ? `${b5dFiles.length} ${this.i18n.translateForComponent(this.translations, 'parametersB5dImport.filesSelected')}`
        : '';

    if (!this.candidates.length) {
      this.validationMessage = this.i18n.translateForComponent(this.translations, 'parametersB5dImport.noFilesFound');
      this.clearPreviewState('parametersB5dImport.noFilesFound', false);
      this.previewRequestId += 1;
      return;
    }

    this.syncOversizedFileWarning();
    if (this.hasOversizedSelectedFiles) {
      this.clearPreviewState('parametersB5dImport.fileTooLarge', true);
      return;
    }

    this.markPreviewStale();
  }

  toggleCandidate(relativePath: string, enabled: boolean): void {
    this.candidates = this.candidates.map((candidate) =>
      candidate.relativePath === relativePath ? { ...candidate, enabled } : candidate,
    );
    this.syncOversizedFileWarning();
    this.markPreviewStale();
  }

  setAllCandidates(enabled: boolean): void {
    this.candidates = this.candidates.map((candidate) => ({ ...candidate, enabled }));
    this.syncOversizedFileWarning();
    this.markPreviewStale();
  }

  onCandidateSizeChange(): void {
    this.markPreviewStale();
  }

  generatePreview(): void {
    void this.refreshPreview();
  }

  closeDialog(): void {
    if (this.isImporting) return;
    this.closeRequested.emit();
  }

  async importParameters(): Promise<void> {
    if (!this.activeProject || this.isImporting) return;

    const selectedFiles = this.selectedCandidates.map((candidate) => candidate.file);
    const selectedSizes = this.getSelectedFileSizes();
    if (!selectedFiles.length) {
      this.validationMessage = 'Selecciona al menos un archivo B5D.';
      return;
    }
    if (!this.hasRequiredMetadata) {
      this.validationMessage = 'Completa Tipo de edificación, Tipo de obra y Zona antes de importar.';
      return;
    }
    if (!this.hasPreview || this.previewDirty || this.previewLoading) {
      this.validationMessage = 'Genera la vista previa antes de importar.';
      return;
    }
    if (!this.hasValidSelectedFileSizes) {
      this.validationMessage = this.i18n.translateForComponent(this.translations, 'parametersB5dImport.sizeRequired');
      return;
    }
    this.syncOversizedFileWarning();
    if (this.hasOversizedSelectedFiles) {
      return;
    }

    const loadingSessionId = this.loadingPanel.start(
      createParameterImportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.importParameters')),
    );
    this.startImportProgress(loadingSessionId);
    this.startImportStatusPolling(loadingSessionId);
    this.isImporting = true;
    this.validationMessage = '';
    this.importMessage = '';
    this.processingMessage = 'Importando parámetros desde B5D...';

    try {
      const response = await firstValueFrom(
        this.backendProyectos.importarParametrosDesdeB5d(this.activeProject.id, {
          archivos: selectedFiles,
          sizes: selectedSizes,
          preview_rows: this.getPreviewSelections(),
          tipo_edificacion: this.tipoEdificacionValue.trim() || null,
          tipo_obra: this.tipoObraValue.trim() || null,
          zona: this.zonaValue.trim() || null,
        }),
      );
      this.logB5dTiming('import', response.timing);
      this.loadingPanel.completeStep(loadingSessionId, 'importing', 'Parámetros generados.');
      this.importMessage = `Importación terminada: ${response.summary.created} creados, ${response.summary.updated} actualizados, ${response.summary.skipped} omitidos, ${response.summary.failed} fallidos.`;
      this.importCompleted.emit(response.summary);
      this.closeRequested.emit();
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.stopImportStatusPolling();
      this.stopImportProgress();
      this.validationMessage = this.resolveErrorMessage(error, 'No se pudieron importar los parámetros desde B5D.');
    } finally {
      this.isImporting = false;
      this.processingMessage = '';
      this.stopImportStatusPolling();
      this.stopImportProgress();
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, 'Importación terminada.');
      }
    }
  }

  get hasPreview(): boolean {
    return this.previewRows.length > 0;
  }

  formatValue(value: number | string | null | undefined): string {
    const numericValue = this.toNumericValue(value);
    if (numericValue == null) return '-';
    const rounded = Number(numericValue.toFixed(4));
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
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

  private resetState(): void {
    this.stopPreviewProgress();
    this.stopImportProgress();
    this.folderName = '';
    this.candidates = [];
    this.tipoEdificacionValue = '';
    this.tipoObraValue = '';
    this.zonaValue = '';
    this.previewRows = [];
    this.validationMessage = '';
    this.previewMessage = '';
    this.processingMessage = '';
    this.importMessage = '';
    this.previewDirty = false;
    this.previewLoading = false;
    this.previewProgress = 0;
    this.isImporting = false;
    this.previewRequestId += 1;
  }

  private async refreshPreview(): Promise<void> {
    if (!this.visible || !this.activeProject || this.isImporting) return;

    const requestId = ++this.previewRequestId;
    const selectedFiles = this.selectedCandidates.map((candidate) => candidate.file);
    const selectedSizes = this.getSelectedFileSizes();
    if (!selectedFiles.length) {
      this.clearPreviewState('parametersB5dImport.previewEmpty', false);
      return;
    }
    if (!this.hasValidSelectedFileSizes) {
      this.clearPreviewState('parametersB5dImport.sizeRequired', true);
      return;
    }
    this.syncOversizedFileWarning();
    if (this.hasOversizedSelectedFiles) {
      this.clearPreviewState('parametersB5dImport.fileTooLarge', true);
      return;
    }
    if (!this.hasRequiredMetadata) {
      this.clearPreviewState('parametersB5dImport.previewPending', true);
      return;
    }

    this.startPreviewProgress();
    this.startPreviewStatusPolling(requestId);
    this.previewLoading = true;
    this.previewMessage = this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewLoading');

    try {
      const response = await firstValueFrom(
        this.backendProyectos.previsualizarParametrosDesdeB5d(this.activeProject.id, {
          archivos: selectedFiles,
          sizes: selectedSizes,
          tipo_edificacion: this.tipoEdificacionValue.trim() || null,
          tipo_obra: this.tipoObraValue.trim() || null,
          zona: this.zonaValue.trim() || null,
        }),
      );
      if (requestId !== this.previewRequestId) return;
      this.logB5dTiming('preview', response.timing);
      this.previewRows = buildParameterImportPreviewRows(response.preview.resultados);
      this.previewDirty = false;
      this.previewMessage = this.previewRows.length
        ? this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewReady')
        : this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewEmpty');
    } catch (error) {
      if (requestId !== this.previewRequestId) return;
      this.previewRows = [];
      this.previewDirty = false;
      this.previewMessage = this.resolveErrorMessage(error, this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewError'));
    } finally {
      if (requestId !== this.previewRequestId) return;
      this.previewLoading = false;
      this.stopPreviewProgress();
      this.stopPreviewStatusPolling();
      this.changeDetectorRef.detectChanges();
    }
  }

  private markPreviewStale(): void {
    this.stopPreviewProgress();
    this.stopPreviewStatusPolling();
    this.previewDirty = true;
    this.previewRows = [];
    this.previewMessage = this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewPending');
    this.previewLoading = false;
    this.previewProgress = 0;
    this.previewRequestId += 1;
  }

  private clearPreviewState(messageKey: string, dirty: boolean): void {
    this.stopPreviewProgress();
    this.stopPreviewStatusPolling();
    this.previewDirty = dirty;
    this.previewRows = [];
    this.previewMessage = this.i18n.translateForComponent(this.translations, messageKey);
    this.previewLoading = false;
    this.previewProgress = 0;
    this.previewRequestId += 1;
  }

  private getSelectedFileSizes(): number[] {
    return this.selectedCandidates
      .map((candidate) => this.parseCandidateSize(candidate.size))
      .filter((value): value is number => value != null);
  }

  private getPreviewSelections(): Array<{ groupKey: string; descripcion: string | null; unidad: string | null }> {
    return this.previewRows.map((row) => ({
      groupKey: row.groupKey,
      descripcion: row.descripcion || null,
      unidad: row.unidad || null,
    }));
  }

  private parseCandidateSize(value: string | null | undefined): number | null {
    if (value == null) return null;
    const normalizedValue = value.toString().trim().replace(',', '.');
    if (!normalizedValue) return null;
    const numericValue = Number(normalizedValue);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
  }

  private syncOversizedFileWarning(): void {
    const fileTooLargeMessage = this.i18n.translateForComponent(this.translations, 'parametersB5dImport.fileTooLarge');
    if (this.hasOversizedSelectedFiles) {
      this.validationMessage = fileTooLargeMessage;
      return;
    }

    if (this.validationMessage === fileTooLargeMessage) {
      this.validationMessage = '';
    }
  }

  private startPreviewProgress(): void {
    this.stopPreviewProgress();
    this.previewProgress = 8;
    this.changeDetectorRef.detectChanges();
    const startedAt = Date.now();
    this.previewProgressTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      let nextProgress = 8;
      if (elapsed < 1500) {
        nextProgress = 8 + elapsed / 40;
      } else if (elapsed < 5000) {
        nextProgress = 45 + (elapsed - 1500) / 70;
      } else {
        const tailElapsed = elapsed - 5000;
        nextProgress = 88 + 11 * (1 - Math.exp(-tailElapsed / 180000));
      }
      this.previewProgress = Math.min(99.5, nextProgress);
      this.changeDetectorRef.detectChanges();
    }, 150);
  }

  private stopPreviewProgress(): void {
    if (this.previewProgressTimer) {
      clearInterval(this.previewProgressTimer);
      this.previewProgressTimer = null;
    }
    this.previewProgress = 0;
  }

  private startPreviewStatusPolling(requestId: number): void {
    this.stopPreviewStatusPolling();
    if (!this.activeProject) return;

    this.previewStatusTimer = setInterval(() => {
      if (
        this.previewStatusPollingInFlight ||
        !this.previewLoading ||
        requestId !== this.previewRequestId ||
        !this.visible ||
        !this.activeProject
      ) {
        return;
      }

      this.previewStatusPollingInFlight = true;
      void firstValueFrom(this.backendProyectos.consultarEstadoProyecto(this.activeProject.id))
        .then((proyecto) => {
          if (requestId !== this.previewRequestId || !this.previewLoading) return;

          const mensajeProgreso = proyecto.mensaje_progreso?.trim();
          const progresoBackend = Math.max(0, Math.min(95, proyecto.progreso_porcentaje ?? 0));
          if (mensajeProgreso) {
            this.previewMessage = mensajeProgreso;
          }
          if (progresoBackend > 0) {
            this.previewProgress = Math.max(this.previewProgress, progresoBackend);
          }
          this.changeDetectorRef.detectChanges();
        })
        .catch(() => {
          // Si el backend no responde a tiempo, seguimos con la barra local.
        })
        .finally(() => {
          this.previewStatusPollingInFlight = false;
        });
    }, 1200);
  }

  private stopPreviewStatusPolling(): void {
    if (this.previewStatusTimer) {
      clearInterval(this.previewStatusTimer);
      this.previewStatusTimer = null;
    }
    this.previewStatusPollingInFlight = false;
  }

  private logB5dTiming(context: 'preview' | 'import', timing?: B5dImportTiming | null): void {
    if (!timing) return;

    const stageRows = [
      { etapa: 'extraccion_total', ms: timing.extraccion_total_ms ?? null },
      { etapa: 'agrupacion_total', ms: timing.agrupacion_total_ms ?? null },
      { etapa: 'agrupacion_importacion_total', ms: timing.agrupacion_importacion_total_ms ?? null },
      { etapa: 'guardado_total', ms: timing.guardado_total_ms ?? null },
      { etapa: 'total', ms: timing.total_ms ?? null },
    ].filter((row) => row.ms != null);

    console.groupCollapsed(`[B5D timing] ${context}`);
    if (stageRows.length) {
      console.table(stageRows);
    }
    if (timing.archivos.length) {
      console.table(
        timing.archivos.map((archivo) => ({
          archivo: archivo.archivo,
          indice: archivo.indice,
          total: archivo.total,
          validacion_ms: archivo.validacion_ms ?? null,
          copia_ms: archivo.copia_ms ?? null,
          apertura_ms: archivo.apertura_ms ?? null,
          cursor_ms: archivo.cursor_ms ?? null,
          lectura_ms: archivo.lectura_ms ?? null,
          cierre_ms: archivo.cierre_ms ?? null,
          total_ms: archivo.total_ms ?? null,
        })),
      );
    }
    console.groupEnd();
  }

  private startImportProgress(sessionId: number): void {
    this.stopImportProgress();
    this.loadingPanel.setStepProgress(
      sessionId,
      'loading',
      100,
      this.i18n.translateForComponent(this.globalTranslations, 'common.loading.b5dPreparing'),
    );
    this.importProgressTimeout = setTimeout(() => {
      if (!this.loadingPanel.state().visible) return;
      this.loadingPanel.setStepProgress(
        sessionId,
        'analyzing',
        100,
        this.i18n.translateForComponent(this.globalTranslations, 'common.loading.b5dAnalyzing'),
      );

      const startedAt = Date.now();
      this.loadingPanel.setStepProgress(
        sessionId,
        'importing',
        10,
        this.i18n.translateForComponent(this.globalTranslations, 'common.loading.b5dImporting'),
      );
      this.importProgressInterval = setInterval(() => {
        if (!this.loadingPanel.state().visible) return;
        const elapsed = Date.now() - startedAt;
        const nextProgress = Math.min(95, 10 + elapsed / 140);
        this.loadingPanel.setStepProgress(
          sessionId,
          'importing',
          nextProgress,
          this.i18n.translateForComponent(this.globalTranslations, 'common.loading.b5dImporting'),
        );
      }, 180);
    }, 350);
  }

  private startImportStatusPolling(sessionId: number): void {
    this.stopImportStatusPolling();
    if (!this.activeProject) return;

    this.importStatusTimer = setInterval(() => {
      if (this.importStatusPollingInFlight || !this.isImporting || !this.activeProject) {
        return;
      }

      this.importStatusPollingInFlight = true;
      void firstValueFrom(this.backendProyectos.consultarEstadoProyecto(this.activeProject.id))
        .then((proyecto) => {
          if (!this.isImporting) return;

          const mensajeProgreso = proyecto.mensaje_progreso?.trim();
          const progresoBackend = Math.max(0, Math.min(95, proyecto.progreso_porcentaje ?? 0));
          if (mensajeProgreso) {
            this.processingMessage = mensajeProgreso;
          }
          if (progresoBackend > 0) {
            this.loadingPanel.setStepProgress(
              sessionId,
              'importing',
              progresoBackend,
              mensajeProgreso || this.processingMessage || 'Importando parámetros desde B5D...',
            );
          }
          this.changeDetectorRef.detectChanges();
        })
        .catch(() => {
          // Si el backend no responde a tiempo, dejamos avanzar la barra local.
        })
        .finally(() => {
          this.importStatusPollingInFlight = false;
        });
    }, 1000);
  }

  private stopImportStatusPolling(): void {
    if (this.importStatusTimer) {
      clearInterval(this.importStatusTimer);
      this.importStatusTimer = null;
    }
    this.importStatusPollingInFlight = false;
  }

  private stopImportProgress(): void {
    if (this.importProgressTimeout) {
      clearTimeout(this.importProgressTimeout);
      this.importProgressTimeout = null;
    }
    if (this.importProgressInterval) {
      clearInterval(this.importProgressInterval);
      this.importProgressInterval = null;
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
}
