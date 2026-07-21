import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BackendProyectosService, type ImportarParametrosB5dResponse, type PrevisualizarParametrosB5dResponse } from '../../services/backend-proyectos.service';
import { LoadingPanelService } from '../../services/loading-panel.service';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';
import type { ProyectoTrabajoOrm } from '../../types/b5d-orm';
import { createParameterImportPlan } from '../../utils/loading-panel/loading-plans';
import { isB5dDebugEnabled, logB5dDebug } from '../../utils/debug/b5d-debug';
import { PARAMETERS_B5D_IMPORT_DIALOG_TRANSLATIONS } from './parameters-b5d-import-dialog.translations';

type B5dImportCandidate = {
  file: File;
  relativePath: string;
  enabled: boolean;
};

type B5dPreviewRow = PrevisualizarParametrosB5dResponse['preview']['resultados'][number];

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
  previewRows: B5dPreviewRow[] = [];
  validationMessage = '';
  previewMessage = '';
  previewDebugMessage = '';
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
  private importProgressTimeout: ReturnType<typeof setTimeout> | null = null;
  private importProgressInterval: ReturnType<typeof setInterval> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && !this.visible) {
      this.resetState();
    }
  }

  ngOnDestroy(): void {
    this.stopPreviewProgress();
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

  get canImport(): boolean {
    return !!this.activeProject && !this.isImporting && !this.loading && this.selectedCount > 0;
  }

  get canGeneratePreview(): boolean {
    return !!this.activeProject && !this.isImporting && !this.loading && this.selectedCount > 0;
  }

  get isDebugEnabled(): boolean {
    return isB5dDebugEnabled();
  }

  t(key: string): string {
    return this.i18n.translateForComponent(this.translations, key);
  }

  handleFolderChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.validationMessage = '';
    this.importMessage = '';
    this.processingMessage = '';
    this.previewDebugMessage = '';

    const b5dFiles = files
      .filter((file) => file.name.toLowerCase().endsWith('.b5d'))
      .map((file) => ({
        file,
        relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        enabled: true,
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'es'));

    this.candidates = b5dFiles;
    this.folderName = b5dFiles[0]?.relativePath.split('/')[0] ?? '';

    if (!this.candidates.length) {
      this.validationMessage = this.i18n.translateForComponent(this.translations, 'parametersB5dImport.noFilesFound');
      this.clearPreviewState('parametersB5dImport.noFilesFound', false);
      this.previewRequestId += 1;
      return;
    }

    this.markPreviewStale();
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
    if (!this.activeProject || this.isImporting) return;

    const selectedFiles = this.selectedCandidates.map((candidate) => candidate.file);
    if (!selectedFiles.length) {
      this.validationMessage = 'Selecciona al menos un archivo B5D.';
      return;
    }

    const loadingSessionId = this.loadingPanel.start(
      createParameterImportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.importParameters')),
    );
    this.startImportProgress(loadingSessionId);
    this.isImporting = true;
    this.validationMessage = '';
    this.importMessage = '';
    this.processingMessage = 'Importando parámetros desde B5D...';

    try {
      const response = await firstValueFrom(
        this.backendProyectos.importarParametrosDesdeB5d(this.activeProject.id, {
          archivos: selectedFiles,
        }),
      );
      this.loadingPanel.completeStep(loadingSessionId, 'importing', 'Parámetros generados.');
      this.importMessage = `Importación terminada: ${response.summary.created} creados, ${response.summary.updated} actualizados, ${response.summary.skipped} omitidos, ${response.summary.failed} fallidos.`;
      this.importCompleted.emit(response.summary);
      this.closeRequested.emit();
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.stopImportProgress();
      this.validationMessage = this.resolveErrorMessage(error, 'No se pudieron importar los parámetros desde B5D.');
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
    this.previewRows = [];
    this.validationMessage = '';
    this.previewMessage = '';
    this.processingMessage = '';
    this.importMessage = '';
    this.previewDirty = false;
    this.previewLoading = false;
    this.previewProgress = 0;
    this.isImporting = false;
    this.previewDebugMessage = '';
    this.previewRequestId += 1;
  }

  private async refreshPreview(): Promise<void> {
    if (!this.visible || !this.activeProject || this.isImporting) return;

    const requestId = ++this.previewRequestId;
    const selectedFiles = this.selectedCandidates.map((candidate) => candidate.file);
    if (!selectedFiles.length) {
      this.clearPreviewState('parametersB5dImport.previewEmpty', false);
      return;
    }

    this.startPreviewProgress();
    this.previewLoading = true;
    this.previewMessage = this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewLoading');

    try {
      const response = await firstValueFrom(
        this.backendProyectos.previsualizarParametrosDesdeB5d(this.activeProject.id, {
          archivos: selectedFiles,
        }),
      );
      if (requestId !== this.previewRequestId) return;
      this.previewRows = response.preview.resultados;
      this.previewDirty = false;
      this.previewMessage = this.previewRows.length
        ? this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewReady')
        : this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewEmpty');
      logB5dDebug('parameters-b5d-import-dialog: preview received', {
        projectId: this.activeProject?.id,
        summary: response.summary,
        previewCount: this.previewRows.length,
        sample: this.previewRows.slice(0, 3).map((row) => ({
          firma: row.firma,
          clave: row.clave,
          cantidad_conceptos: row.cantidad_conceptos,
          cantidad_origenes: row.cantidad_origenes,
          minimo: row.minimo,
          maximo: row.maximo,
          promedio: row.promedio,
        })),
      });
      this.previewDebugMessage = isB5dDebugEnabled() ? this.buildPreviewDebugMessage(response) : '';
    } catch (error) {
      if (requestId !== this.previewRequestId) return;
      this.previewRows = [];
      this.previewDirty = false;
      this.previewMessage = this.resolveErrorMessage(error, this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewError'));
      this.previewDebugMessage = isB5dDebugEnabled()
        ? this.resolveErrorMessage(error, 'Error al cargar la vista previa de parámetros B5D.')
        : '';
      logB5dDebug('parameters-b5d-import-dialog: preview error', error);
    } finally {
      if (requestId !== this.previewRequestId) return;
      this.previewLoading = false;
      this.stopPreviewProgress();
      this.changeDetectorRef.detectChanges();
    }
  }

  private markPreviewStale(): void {
    this.stopPreviewProgress();
    this.previewDirty = true;
    this.previewRows = [];
    this.previewMessage = this.i18n.translateForComponent(this.translations, 'parametersB5dImport.previewPending');
    this.previewDebugMessage = '';
    this.previewLoading = false;
    this.previewProgress = 0;
    this.previewRequestId += 1;
  }

  private clearPreviewState(messageKey: string, dirty: boolean): void {
    this.stopPreviewProgress();
    this.previewDirty = dirty;
    this.previewRows = [];
    this.previewMessage = this.i18n.translateForComponent(this.translations, messageKey);
    this.previewDebugMessage = '';
    this.previewLoading = false;
    this.previewProgress = 0;
    this.previewRequestId += 1;
  }

  private buildPreviewDebugMessage(response: PrevisualizarParametrosB5dResponse): string {
    const preview = response.preview.resultados;
    const sample = preview.slice(0, 3).map((row, index) => {
      const parts = [
        `${index + 1}. firma=${row.firma || '-'}`,
        `clave=${row.clave || '-'}`,
        `conceptos=${row.cantidad_conceptos}`,
        `origenes=${row.cantidad_origenes}`,
        `min=${this.formatValue(row.minimo)}`,
        `max=${this.formatValue(row.maximo)}`,
        `prom=${this.formatValue(row.promedio)}`,
      ];
      return parts.join(' | ');
    });
    return [
      `summary.count=${response.summary.count} tipo_parametro=${response.summary.tipo_parametro}`,
      `preview.length=${preview.length} selectedFiles=${this.selectedCount} totalFiles=${this.totalCount}`,
      ...sample,
    ].join('\n');
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
