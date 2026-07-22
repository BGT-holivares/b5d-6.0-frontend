import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BackendProyectosService, type PrevisualizarParametrosXdbResponse } from '../../services/backend-proyectos.service';
import { LoadingPanelService } from '../../services/loading-panel.service';
import { createParameterImportPlan } from '../../utils/loading-panel/loading-plans';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';
import { PARAMETERS_XDB_IMPORT_DIALOG_TRANSLATIONS } from './parameters-xdb-import-dialog.translations';

type XdbImportCandidate = {
  file: File;
  relativePath: string;
  enabled: boolean;
};

type XdbPreviewRow = PrevisualizarParametrosXdbResponse['preview']['resultados'][number];
type XdbGroupingMode = 'hojas' | 'agrupadores';
type XdbParameterType = 'costo' | 'costo_porcentaje';

export type XdbParameterImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  count: number;
  tipo_parametro: string;
};

@Component({
  selector: 'app-parameters-xdb-import-dialog',
  imports: [CommonModule, FormsModule],
  templateUrl: './parameters-xdb-import-dialog.html',
  styleUrl: './parameters-xdb-import-dialog.scss',
})
export class ParametersXdbImportDialog implements OnChanges, OnDestroy {
  @Input() visible = false;
  @Input() loading = false;
  @Input() activeProjectId: number | null = null;
  @Output() closeRequested = new EventEmitter<void>();
  @Output() importCompleted = new EventEmitter<XdbParameterImportSummary>();

  readonly i18n = inject(I18nService);
  readonly globalTranslations = GLOBAL_TRANSLATIONS;
  readonly translations = PARAMETERS_XDB_IMPORT_DIALOG_TRANSLATIONS;

  folderName = '';
  candidates: XdbImportCandidate[] = [];
  tipoParametro: XdbParameterType = 'costo_porcentaje';
  modoAgrupacion: XdbGroupingMode = 'hojas';
  tipoEdificacionValue = '';
  tipoObraValue = '';
  zonaValue = '';
  previewRows: XdbPreviewRow[] = [];
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
    this.stopImportProgress();
  }

  get selectedCandidates(): XdbImportCandidate[] {
    return this.candidates.filter((candidate) => candidate.enabled);
  }

  get selectedCount(): number {
    return this.selectedCandidates.length;
  }

  get totalCount(): number {
    return this.candidates.length;
  }

  get canImport(): boolean {
    return !!this.activeProjectId && !this.isImporting && !this.loading && this.selectedCount > 0;
  }

  get canGeneratePreview(): boolean {
    return !!this.activeProjectId && !this.isImporting && !this.loading && this.selectedCount > 0;
  }

  get isGroupingMode(): boolean {
    return this.modoAgrupacion === 'agrupadores';
  }

  get previewTitleKey(): string {
    return this.isGroupingMode
      ? 'parametersXdbImport.previewTitleGrouping'
      : 'parametersXdbImport.previewTitle';
  }

  get previewHintKey(): string {
    return this.isGroupingMode
      ? 'parametersXdbImport.previewHintGrouping'
      : 'parametersXdbImport.previewHint';
  }

  get selectedParameterTypeHintKey(): string {
    return this.tipoParametro === 'costo'
      ? 'parametersXdbImport.parameterTypeHintCost'
      : 'parametersXdbImport.parameterTypeHintCostPercent';
  }

  get sourceLabelValue(): string {
    return this.folderName || this.i18n.translateForComponent(this.translations, 'parametersXdbImport.noFolder');
  }

  setGroupingMode(mode: XdbGroupingMode): void {
    if (this.modoAgrupacion === mode) return;
    this.modoAgrupacion = mode;
    this.markPreviewStale();
  }

  setParameterType(tipoParametro: XdbParameterType): void {
    if (this.tipoParametro === tipoParametro) return;
    this.tipoParametro = tipoParametro;
    this.markPreviewStale();
  }

  handleFolderChange(event: Event): void {
    this.handleFilesSelection(event, true);
  }

  handleFilesChange(event: Event): void {
    this.handleFilesSelection(event, false);
  }

  toggleCandidate(relativePath: string, enabled: boolean): void {
    this.candidates = this.candidates.map((candidate) =>
      candidate.relativePath === relativePath ? { ...candidate, enabled } : candidate,
    );
    this.markPreviewStale();
  }

  setAllCandidates(enabled: boolean): void {
    this.candidates = this.candidates.map((candidate) => ({ ...candidate, enabled }));
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
    if (!this.activeProjectId || this.isImporting) return;

    const selectedFiles = this.selectedCandidates.map((candidate) => candidate.file);
    if (!selectedFiles.length) {
      this.validationMessage = 'Selecciona al menos un archivo XDB.';
      return;
    }

    const loadingSessionId = this.loadingPanel.start(
      createParameterImportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.importParameters')),
    );
    this.startImportProgress(loadingSessionId);
    this.isImporting = true;
    this.validationMessage = '';
    this.importMessage = '';
    this.processingMessage = 'Importando parámetros desde XDB...';

    try {
      const response = await firstValueFrom(
        this.backendProyectos.importarParametrosDesdeXdb(this.activeProjectId, {
          archivos: selectedFiles,
          tipo_parametro: this.tipoParametro,
          modo_agrupacion: this.modoAgrupacion,
          tipo_edificacion: this.tipoEdificacionValue.trim() || null,
          tipo_obra: this.tipoObraValue.trim() || null,
          zona: this.zonaValue.trim() || null,
        }),
      );
      this.loadingPanel.completeStep(loadingSessionId, 'importing', 'Parámetros generados.');
      this.importMessage = `Importación terminada: ${response.summary.created} creados, ${response.summary.updated} actualizados, ${response.summary.skipped} omitidos, ${response.summary.failed} fallidos.`;
      this.importCompleted.emit(response.summary);
      this.closeRequested.emit();
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.stopImportProgress();
      this.validationMessage = this.resolveErrorMessage(error, 'No se pudieron importar los parámetros desde XDB.');
    } finally {
      this.isImporting = false;
      this.processingMessage = '';
      this.stopImportProgress();
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, 'Importación terminada.');
      }
    }
  }

  get hasPreview(): boolean {
    return this.previewRows.length > 0;
  }

  formatPercentage(value: number | string | null | undefined): string {
    const numericValue = this.toNumericValue(value);
    if (numericValue == null) return '-';
    return `${numericValue.toFixed(2)}%`;
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
    this.stopPreviewStatusPolling();
    this.stopImportProgress();
    this.folderName = '';
    this.candidates = [];
    this.previewRows = [];
    this.tipoEdificacionValue = '';
    this.tipoObraValue = '';
    this.zonaValue = '';
    this.validationMessage = '';
    this.previewMessage = '';
    this.processingMessage = '';
    this.importMessage = '';
    this.previewLoading = false;
    this.previewDirty = false;
    this.previewProgress = 0;
    this.isImporting = false;
    this.tipoParametro = 'costo_porcentaje';
    this.modoAgrupacion = 'hojas';
    this.previewRequestId += 1;
  }

  private async refreshPreview(): Promise<void> {
    if (!this.visible || !this.activeProjectId || this.isImporting) return;

    const requestId = ++this.previewRequestId;
    const selectedFiles = this.selectedCandidates.map((candidate) => candidate.file);
    if (!selectedFiles.length) {
      this.clearPreviewState('parametersXdbImport.previewEmpty', false);
      return;
    }

    this.startPreviewProgress();
    this.startPreviewStatusPolling(requestId);
    this.previewLoading = true;
    this.previewMessage = this.i18n.translateForComponent(this.translations, 'parametersXdbImport.previewLoading');

    try {
      const response = await firstValueFrom(
        this.backendProyectos.previsualizarParametrosDesdeXdb(this.activeProjectId, {
          archivos: selectedFiles,
          tipo_parametro: this.tipoParametro,
          modo_agrupacion: this.modoAgrupacion,
          tipo_edificacion: this.tipoEdificacionValue.trim() || null,
          tipo_obra: this.tipoObraValue.trim() || null,
          zona: this.zonaValue.trim() || null,
        }),
      );
      if (requestId !== this.previewRequestId) return;
      this.previewRows = response.preview.resultados;
      this.previewDirty = false;
      this.previewMessage = this.previewRows.length
        ? this.i18n.translateForComponent(
            this.translations,
            'parametersXdbImport.previewReady',
          )
        : this.i18n.translateForComponent(this.translations, 'parametersXdbImport.previewEmpty');
    } catch (error) {
      if (requestId !== this.previewRequestId) return;
      this.previewRows = [];
      this.previewDirty = false;
      this.previewMessage = this.resolveErrorMessage(error, this.i18n.translateForComponent(this.translations, 'parametersXdbImport.previewError'));
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
    this.previewMessage = this.i18n.translateForComponent(this.translations, 'parametersXdbImport.previewPending');
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
    if (!this.activeProjectId) return;

    this.previewStatusTimer = setInterval(() => {
      if (
        this.previewStatusPollingInFlight ||
        !this.previewLoading ||
        requestId !== this.previewRequestId ||
        !this.visible ||
        !this.activeProjectId
      ) {
        return;
      }

      this.previewStatusPollingInFlight = true;
      void firstValueFrom(this.backendProyectos.consultarEstadoProyecto(this.activeProjectId))
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
  }

  private startImportProgress(sessionId: number): void {
    this.stopImportProgress();
    this.loadingPanel.setStepProgress(
      sessionId,
      'loading',
      100,
      this.i18n.translateForComponent(this.globalTranslations, 'common.loading.xdbPreparing'),
    );
    this.importProgressTimeout = setTimeout(() => {
      if (!this.loadingPanel.state().visible) return;
      this.loadingPanel.setStepProgress(
        sessionId,
        'analyzing',
        100,
        this.i18n.translateForComponent(this.globalTranslations, 'common.loading.xdbAnalyzing'),
      );

      const startedAt = Date.now();
      this.loadingPanel.setStepProgress(
        sessionId,
        'importing',
        10,
        this.i18n.translateForComponent(this.globalTranslations, 'common.loading.xdbImporting'),
      );
      this.importProgressInterval = setInterval(() => {
        if (!this.loadingPanel.state().visible) return;
        const elapsed = Date.now() - startedAt;
        const nextProgress = Math.min(95, 10 + elapsed / 140);
        this.loadingPanel.setStepProgress(
          sessionId,
          'importing',
          nextProgress,
          this.i18n.translateForComponent(this.globalTranslations, 'common.loading.xdbImporting'),
        );
      }, 180);
    }, 350);
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

  private handleFilesSelection(event: Event, isFolderSelection: boolean): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.validationMessage = '';
    this.importMessage = '';
    this.processingMessage = '';

    const xdbFiles = files
      .filter((file) => file.name.toLowerCase().endsWith('.xdb'))
      .map((file) => ({
        file,
        relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        enabled: true,
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'es'));

    this.candidates = xdbFiles;
    if (isFolderSelection) {
      this.folderName = xdbFiles[0]?.relativePath.split('/')[0] ?? '';
    } else {
      this.folderName = xdbFiles.length
        ? `${xdbFiles.length} ${this.i18n.translateForComponent(this.translations, 'parametersXdbImport.filesSelected')}`
        : '';
    }

    if (!this.candidates.length) {
      this.validationMessage = this.i18n.translateForComponent(this.translations, 'parametersXdbImport.noFilesFound');
      this.clearPreviewState('parametersXdbImport.noFilesFound', false);
      return;
    }

    this.markPreviewStale();
  }
}
