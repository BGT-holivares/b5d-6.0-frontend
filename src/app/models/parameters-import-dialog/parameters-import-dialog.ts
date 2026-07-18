import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BackendProyectosService, type CrearParametroPayload } from '../../services/backend-proyectos.service';
import { LoadingPanelService } from '../../services/loading-panel.service';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';
import type { ParametroB5DOrm, ProyectoTrabajoOrm, TipoComparacionParametroOrm, TipoParametroOrm } from '../../types/b5d-orm';
import { PARAMETERS_IMPORT_DIALOG_TRANSLATIONS } from './parameters-import-dialog.translations';
import { createParameterImportPlan } from '../../utils/loading-panel/loading-plans';

type ParameterImportField =
  | 'activo'
  | 'clave'
  | 'descripcion'
  | 'tipo_comparacion'
  | 'tipo_parametro'
  | 'tipo_edificacion'
  | 'unidad'
  | 'minimo'
  | 'maximo'
  | 'promedio';

type ParameterImportFieldDefinition = {
  key: ParameterImportField;
  labelKey: string;
  required: boolean;
  defaultValue: string;
};

type WorkbookRow = {
  rowNumber: number;
  values: unknown[];
};

type WorkbookHeaderCandidate = {
  rowNumber: number;
  score: number;
  headers: string[];
};

type WorkbookColumnOption = {
  index: number;
  letter: string;
  header: string;
  sample: string;
  suggestedField: ParameterImportField | null;
};

type PreviewCellState = {
  value: string;
  usesDefaultValue: boolean;
};

type WorkbookSheetState = {
  index: number;
  name: string;
  rows: WorkbookRow[];
  headerCandidates: WorkbookHeaderCandidate[];
  selectedHeaderRowNumber: number | null;
  columns: WorkbookColumnOption[];
};

type ParameterImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  messages: string[];
};

type ImportedParameterRow = {
  rowNumber: number;
  payload: CrearParametroPayload;
  existingMatch: ParametroB5DOrm | null;
  isNoChange: boolean;
};

const PARAMETER_IMPORT_FIELDS: ParameterImportFieldDefinition[] = [
  { key: 'activo', labelKey: 'parametersImport.field.active', required: false, defaultValue: '1' },
  { key: 'clave', labelKey: 'parametersImport.field.key', required: true, defaultValue: '' },
  { key: 'descripcion', labelKey: 'parametersImport.field.description', required: false, defaultValue: '' },
  { key: 'tipo_comparacion', labelKey: 'parametersImport.field.comparisonType', required: false, defaultValue: 'clave_exacta' },
  { key: 'tipo_parametro', labelKey: 'parametersImport.field.parameterType', required: false, defaultValue: 'cantidad' },
  { key: 'tipo_edificacion', labelKey: 'parametersImport.field.buildingType', required: false, defaultValue: '' },
  { key: 'unidad', labelKey: 'parametersImport.field.unit', required: false, defaultValue: '' },
  { key: 'minimo', labelKey: 'parametersImport.field.minimum', required: false, defaultValue: '' },
  { key: 'maximo', labelKey: 'parametersImport.field.maximum', required: false, defaultValue: '' },
  { key: 'promedio', labelKey: 'parametersImport.field.average', required: false, defaultValue: '' },
];

const FIELD_HEADER_ALIASES: Record<ParameterImportField, string[]> = {
  activo: ['activo', 'activa', 'active', 'enabled', 'habilitado'],
  clave: ['clave', 'codigo', 'código', 'code', 'id', 'parameter code', 'parametro', 'parámetro'],
  descripcion: ['descripcion', 'descripción', 'description', 'desc'],
  tipo_comparacion: ['tipo comparacion', 'tipo de comparacion', 'comparison', 'comparison type', 'comparacion'],
  tipo_parametro: ['tipo parametro', 'tipo de parametro', 'parameter type', 'type', 'parameter'],
  tipo_edificacion: ['tipo edificacion', 'tipo de edificacion', 'building type', 'edificacion'],
  unidad: ['unidad', 'unit'],
  minimo: ['minimo', 'mínimo', 'minimum', 'min'],
  maximo: ['maximo', 'máximo', 'maximum', 'max'],
  promedio: ['promedio', 'average', 'mean'],
};

@Component({
  selector: 'app-parameters-import-dialog',
  imports: [CommonModule, FormsModule],
  templateUrl: './parameters-import-dialog.html',
  styleUrl: './parameters-import-dialog.scss',
})
export class ParametersImportDialog implements OnChanges {
  readonly i18n = inject(I18nService);
  readonly globalTranslations = GLOBAL_TRANSLATIONS;
  readonly parametersImportDialogTranslations = PARAMETERS_IMPORT_DIALOG_TRANSLATIONS;

  @Input() visible = false;
  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Input() existingParameters: ParametroB5DOrm[] = [];
  @Input() loading = false;
  @Output() closeRequested = new EventEmitter<void>();
  @Output() importCompleted = new EventEmitter<ParameterImportSummary>();

  @ViewChild('dialogPanel') private readonly dialogPanel?: ElementRef<HTMLElement>;

  workbookFileName = '';
  workbookError = '';
  validationMessage = '';
  importMessage = '';
  processingMessage = '';
  isWorkbookProcessing = false;
  importInProgress = false;
  selectedSheetIndex = 0;
  selectedHeaderCandidateRowNumber: number | null = null;
  sheetStates: WorkbookSheetState[] = [];
  fieldMappings: Record<ParameterImportField, number | null> = this.createEmptyFieldMappings();

  readonly fieldDefinitions = PARAMETER_IMPORT_FIELDS;

  private readonly backendProyectos = inject(BackendProyectosService);
  private readonly loadingPanel = inject(LoadingPanelService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly closeDialogThreshold = 24;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && !this.visible) {
      this.resetState();
    }
  }

  get canImport(): boolean {
    return (
      !!this.activeProject &&
      !!this.currentSheet &&
      !this.importInProgress &&
      !this.isWorkbookProcessing &&
      !this.loading &&
      this.fieldMappings.clave != null
    );
  }

  t(key: string): string {
    return this.i18n.translateForComponent(this.parametersImportDialogTranslations, key);
  }

  get currentSheet(): WorkbookSheetState | null {
    return this.sheetStates[this.selectedSheetIndex] ?? null;
  }

  get previewRows(): Array<{ rowNumber: number; values: Record<ParameterImportField, PreviewCellState> }> {
    const sheet = this.currentSheet;
    if (!sheet) return [];

    const headerRowNumber = sheet.selectedHeaderRowNumber;
    if (headerRowNumber == null) return [];

    const dataRows = sheet.rows.filter((row) => row.rowNumber > headerRowNumber && this.rowHasData(row));
    return dataRows.slice(0, 12).map((row) => ({
      rowNumber: row.rowNumber,
      values: this.fieldDefinitions.reduce((acc, fieldDefinition) => {
        acc[fieldDefinition.key] = this.getPreviewCellState(row, fieldDefinition.key);
        return acc;
      }, {} as Record<ParameterImportField, PreviewCellState>),
    }));
  }

  get selectedSheetLabel(): string {
    return this.currentSheet?.name ?? this.t('parametersImport.noSheet');
  }

  get selectedHeaderLabel(): string {
    const sheet = this.currentSheet;
    if (!sheet || sheet.selectedHeaderRowNumber == null) return this.t('parametersImport.noHeaderDefined');
    const candidate = sheet.headerCandidates.find((item) => item.rowNumber === sheet.selectedHeaderRowNumber);
    if (!candidate) return `${this.t('parametersImport.rowLabel')} ${sheet.selectedHeaderRowNumber}`;
    const sample = this.getHeaderCandidateSnippet(candidate);
    return sample ? `${this.t('parametersImport.rowLabel')} ${candidate.rowNumber}: ${sample}` : `${this.t('parametersImport.rowLabel')} ${candidate.rowNumber}`;
  }

  get selectedHeaderCandidates(): WorkbookHeaderCandidate[] {
    return this.currentSheet?.headerCandidates ?? [];
  }

  get selectedColumns(): WorkbookColumnOption[] {
    return this.currentSheet?.columns ?? [];
  }

  getFieldDefinitionLabel(fieldKey: ParameterImportField | null | undefined): string {
    if (!fieldKey) return '-';
    const fieldDefinition = PARAMETER_IMPORT_FIELDS.find((definition) => definition.key === fieldKey);
    return fieldDefinition ? this.t(fieldDefinition.labelKey) : '-';
  }

  getHeaderCandidateSnippet(candidate: WorkbookHeaderCandidate): string {
    return candidate.headers.filter((item) => item.trim()).slice(0, 4).join(' | ');
  }

  get mappingSummary(): string {
    const mappedFields = this.fieldDefinitions.filter((fieldDefinition) => this.fieldMappings[fieldDefinition.key] != null).length;
    return `${mappedFields} ${this.t('parametersImport.of')} ${this.fieldDefinitions.length} ${this.t('parametersImport.mappedColumns')}`;
  }

  handleFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.workbookError = '';
    this.validationMessage = '';
    this.importMessage = '';
    this.processingMessage = '';

    if (!file) {
      this.resetWorkbookState();
      return;
    }

    this.isWorkbookProcessing = true;
    this.processingMessage = this.t('parametersImport.preparingWorkbook');
    this.changeDetectorRef.detectChanges();
    void this.loadWorkbook(file);
  }

  selectSheet(index: number): void {
    this.selectedSheetIndex = index;
    const sheet = this.currentSheet;
    if (!sheet) return;
    this.selectedHeaderCandidateRowNumber = sheet.selectedHeaderRowNumber;
    this.applyColumnSuggestions(sheet);
    this.validationMessage = '';
    this.importMessage = '';
  }

  selectHeaderCandidate(rowNumber: number | null): void {
    const sheet = this.currentSheet;
    if (!sheet) return;

    sheet.selectedHeaderRowNumber = rowNumber;
    this.selectedHeaderCandidateRowNumber = rowNumber;
    this.buildSheetColumns(sheet);
    this.applyColumnSuggestions(sheet);
    this.validationMessage = '';
    this.importMessage = '';
  }

  setFieldMapping(fieldKey: ParameterImportField, columnIndex: number | null): void {
    this.fieldMappings = {
      ...this.fieldMappings,
      [fieldKey]: columnIndex,
    };
    this.validationMessage = '';
    this.importMessage = '';
  }

  getFieldMappingLabel(fieldKey: ParameterImportField): string {
    const mappedColumnIndex = this.fieldMappings[fieldKey];
    if (mappedColumnIndex == null) return this.t('parametersImport.ignoreFieldShort');
    const column = this.selectedColumns.find((item) => item.index === mappedColumnIndex);
    return column ? `${column.letter} - ${column.header || this.t('parametersImport.noHeader')}` : this.t('parametersImport.ignoreFieldShort');
  }

  getFieldMappingSample(fieldKey: ParameterImportField): string {
    const mappedColumnIndex = this.fieldMappings[fieldKey];
    if (mappedColumnIndex == null) return '-';
    const sheet = this.currentSheet;
    if (!sheet) return '-';
    const headerRowNumber = sheet.selectedHeaderRowNumber;
    if (headerRowNumber == null) return '-';

    const row = sheet.rows.find((item) => item.rowNumber > headerRowNumber && this.rowHasData(item));
    if (!row) return '-';
    return this.getCellText(row.values[mappedColumnIndex]) || '-';
  }

  // Closes the dialog when the import flow is not running.
  closeDialog(): void {
    if (this.importInProgress) return;
    this.closeRequested.emit();
  }

  // Imports the selected workbook rows and closes the dialog after a clean import.
  async importParameters(): Promise<void> {
    const project = this.activeProject;
    const sheet = this.currentSheet;
    if (!project || !sheet || this.importInProgress) return;

    if (sheet.selectedHeaderRowNumber == null) {
      this.validationMessage = this.t('parametersImport.selectHeaderRow');
      return;
    }

    if (this.fieldMappings.clave == null) {
      this.validationMessage = this.t('parametersImport.assignKeyColumn');
      return;
    }

    const loadingSessionId = this.loadingPanel.start(
      createParameterImportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.importParameters')),
    );
    this.importInProgress = true;
    this.validationMessage = '';
    this.importMessage = '';
    this.processingMessage = this.t('parametersImport.importing');
    this.changeDetectorRef.detectChanges();

    const summary: ParameterImportSummary = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      messages: [],
    };

    try {
      const rowsToImport = this.buildImportRows(sheet);
      for (let index = 0; index < rowsToImport.length; index += 1) {
        const importedRow = rowsToImport[index];
        try {
          if (!importedRow.payload.clave && !importedRow.payload.descripcion) {
            summary.skipped += 1;
            this.loadingPanel.setStepProgress(
              loadingSessionId,
              'importing',
              ((index + 1) / Math.max(rowsToImport.length, 1)) * 100,
              this.t('parametersImport.importingRows'),
            );
            continue;
          }

          if (importedRow.existingMatch && importedRow.isNoChange) {
            summary.skipped += 1;
            this.loadingPanel.setStepProgress(
              loadingSessionId,
              'importing',
              ((index + 1) / Math.max(rowsToImport.length, 1)) * 100,
              this.t('parametersImport.importingRows'),
            );
            continue;
          }

          if (importedRow.existingMatch) {
            await firstValueFrom(
              this.backendProyectos.actualizarParametro(project.id, importedRow.existingMatch.id, importedRow.payload),
            );
            summary.updated += 1;
          } else {
            await firstValueFrom(this.backendProyectos.crearParametro(project.id, importedRow.payload));
            summary.created += 1;
          }
          this.loadingPanel.setStepProgress(
            loadingSessionId,
            'importing',
            ((index + 1) / Math.max(rowsToImport.length, 1)) * 100,
            this.t('parametersImport.importingRows'),
          );
        } catch (error) {
          summary.failed += 1;
          summary.messages.push(`${this.t('parametersImport.rowLabel')} ${importedRow.rowNumber}: ${this.resolveErrorMessage(error, this.t('parametersImport.saveParameterError'))}`);
          this.loadingPanel.setStepProgress(
            loadingSessionId,
            'importing',
            ((index + 1) / Math.max(rowsToImport.length, 1)) * 100,
            this.t('parametersImport.importingRows'),
          );
        }
      }

      this.loadingPanel.completeStep(loadingSessionId, 'importing', this.t('parametersImport.importComplete'));
      this.importMessage = `${this.t('parametersImport.importComplete')}: ${summary.created} ${this.t('parametersImport.created')}, ${summary.updated} ${this.t('parametersImport.updated')}, ${summary.skipped} ${this.t('parametersImport.skipped')}, ${summary.failed} ${this.t('parametersImport.failed')}.`;
      this.importCompleted.emit(summary);
      if (summary.failed === 0) {
        this.closeRequested.emit();
      }
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.validationMessage = this.resolveErrorMessage(error, this.t('parametersImport.readWorkbookError'));
    } finally {
      this.importInProgress = false;
      this.processingMessage = '';
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, this.t('parametersImport.importComplete'));
      }
      this.changeDetectorRef.detectChanges();
    }
  }

  // Loads and parses the workbook while giving the UI time to repaint status updates.
  private async loadWorkbook(file: File): Promise<void> {
    this.resetWorkbookState();
    this.workbookFileName = file.name;
    const loadingSessionId = this.loadingPanel.start(
      createParameterImportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.importParameters')),
    );

    try {
      this.processingMessage = this.t('parametersImport.loadingXlsxModule');
      this.loadingPanel.setStepProgress(loadingSessionId, 'loading', 35, this.t('parametersImport.loadingXlsxModule'));
      this.changeDetectorRef.detectChanges();
      await this.yieldToUi();

      const xlsxModule = await import('xlsx');
      this.processingMessage = this.t('parametersImport.readingWorkbook');
      this.loadingPanel.completeStep(loadingSessionId, 'loading', this.t('parametersImport.xlsxModuleReady'));
      this.loadingPanel.setStepProgress(loadingSessionId, 'analyzing', 20, this.t('parametersImport.readingWorkbook'));
      this.changeDetectorRef.detectChanges();
      const workbookArrayBuffer = await file.arrayBuffer();
      this.processingMessage = this.t('parametersImport.analyzingSheets');
      this.loadingPanel.setStepProgress(loadingSessionId, 'analyzing', 60, this.t('parametersImport.analyzingSheets'));
      this.changeDetectorRef.detectChanges();
      await this.yieldToUi();
      const workbook = xlsxModule.read(workbookArrayBuffer, {
        type: 'array',
        cellDates: true,
      });

      this.processingMessage = this.t('parametersImport.detectingHeaders');
      this.loadingPanel.completeStep(loadingSessionId, 'analyzing', this.t('parametersImport.previewReady'));
      this.changeDetectorRef.detectChanges();
      this.sheetStates = workbook.SheetNames.map((sheetName: string, index: number) =>
        this.buildSheetState(xlsxModule, workbook.Sheets[sheetName], sheetName, index),
      );

      if (!this.sheetStates.length) {
        this.workbookError = this.t('parametersImport.noVisibleSheets');
        return;
      }

      this.selectedSheetIndex = this.resolveInitialSheetIndex();
      const sheet = this.currentSheet;
      if (!sheet) return;
      if (sheet.selectedHeaderRowNumber == null && sheet.headerCandidates.length) {
        sheet.selectedHeaderRowNumber = sheet.headerCandidates[0].rowNumber;
      }
      this.selectedHeaderCandidateRowNumber = sheet.selectedHeaderRowNumber;
      this.buildSheetColumns(sheet);
      this.applyColumnSuggestions(sheet);
      this.processingMessage = this.t('parametersImport.readyToReview');
      this.loadingPanel.complete(loadingSessionId, this.t('parametersImport.readyToReview'));
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.workbookError = this.resolveErrorMessage(error, this.t('parametersImport.readWorkbookError'));
    } finally {
      this.isWorkbookProcessing = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private buildSheetState(xlsxModule: typeof import('xlsx'), sheet: Record<string, unknown>, name: string, index: number): WorkbookSheetState {
    const rows = this.extractSheetRows(xlsxModule, sheet);
    const headerCandidates = this.detectHeaderCandidates(rows);
    const selectedHeaderRowNumber = headerCandidates[0]?.rowNumber ?? this.findFirstMeaningfulRow(rows)?.rowNumber ?? null;
    return {
      index,
      name,
      rows,
      headerCandidates,
      selectedHeaderRowNumber,
      columns: [],
    };
  }

  private buildSheetColumns(sheet: WorkbookSheetState): void {
    const headerRowNumber = sheet.selectedHeaderRowNumber;
    if (headerRowNumber == null) {
      sheet.columns = [];
      return;
    }

    const headerRow = sheet.rows.find((row) => row.rowNumber === headerRowNumber);
    if (!headerRow) {
      sheet.columns = [];
      return;
    }

    const maxColumns = this.resolveLastRelevantColumnIndex(sheet.rows, headerRow.values);
    const columns: WorkbookColumnOption[] = [];
    for (let index = 0; index <= maxColumns; index += 1) {
      const header = this.getCellText(headerRow.values[index]);
      const sample = this.findColumnSample(sheet.rows, headerRowNumber, index);
      columns.push({
        index,
        letter: this.columnLabelFromIndex(index),
        header,
        sample,
        suggestedField: this.guessFieldFromHeader(header),
      });
    }

    sheet.columns = columns;
  }

  private applyColumnSuggestions(sheet: WorkbookSheetState): void {
    const nextMappings = this.createEmptyFieldMappings();
    for (const column of sheet.columns) {
      if (!column.suggestedField) continue;
      if (nextMappings[column.suggestedField] == null) {
        nextMappings[column.suggestedField] = column.index;
      }
    }

    this.fieldMappings = nextMappings;
  }

  private buildImportRows(sheet: WorkbookSheetState): ImportedParameterRow[] {
    const headerRowNumber = sheet.selectedHeaderRowNumber;
    if (headerRowNumber == null) return [];

    const dataRows = sheet.rows.filter((row) => row.rowNumber > headerRowNumber && this.rowHasData(row));
    return dataRows.map((row) => {
      const payload = this.buildPayloadFromRow(row);
      const existingMatch = this.findExistingMatch(payload);
      const isNoChange = existingMatch ? this.isSameParameter(existingMatch, payload) : false;
      return {
        rowNumber: row.rowNumber,
        payload,
        existingMatch,
        isNoChange,
      };
    });
  }

  private buildPayloadFromRow(row: WorkbookRow): CrearParametroPayload {
    const clave = this.getMappedCellValue(row, 'clave');
    const descripcion = this.getMappedCellValue(row, 'descripcion');
    const tipoComparacionValue = this.getMappedCellValue(row, 'tipo_comparacion');
    const tipoParametroValue = this.getMappedCellValue(row, 'tipo_parametro');
    const tipoEdificacion = this.getMappedCellValue(row, 'tipo_edificacion');
    const unidad = this.getMappedCellValue(row, 'unidad');

    return {
      clave: clave || null,
      descripcion: descripcion || null,
      tipo_comparacion: this.parseComparisonType(tipoComparacionValue) ?? 'clave_exacta',
      tipo_parametro: this.parseTipoParametro(tipoParametroValue) ?? 'cantidad',
      tipo_edificacion: tipoEdificacion || null,
      unidad: unidad || null,
      minimo: this.parseNumberLike(this.getMappedCellValue(row, 'minimo')),
      maximo: this.parseNumberLike(this.getMappedCellValue(row, 'maximo')),
      promedio: this.parseNumberLike(this.getMappedCellValue(row, 'promedio')),
      activo: this.parseBooleanLike(this.getMappedCellValue(row, 'activo'), true),
    };
  }

  private findExistingMatch(payload: CrearParametroPayload): ParametroB5DOrm | null {
    const clave = this.normalizeText(payload.clave ?? '');
    if (!clave) return null;
    const tipoParametro = payload.tipo_parametro ?? 'cantidad';
    const tipoEdificacion = this.normalizeText(payload.tipo_edificacion ?? '');

    const exactMatch = this.existingParameters.find((parameter) => {
      const parameterClave = this.normalizeText(parameter.clave ?? '');
      const parameterTipo = parameter.tipo_parametro ?? 'cantidad';
      const parameterEdificacion = this.normalizeText(parameter.tipo_edificacion ?? '');
      return parameterClave === clave && parameterTipo === tipoParametro && parameterEdificacion === tipoEdificacion;
    });
    if (exactMatch) return exactMatch;

    const typeMatch = this.existingParameters.find((parameter) => {
      const parameterClave = this.normalizeText(parameter.clave ?? '');
      const parameterTipo = parameter.tipo_parametro ?? 'cantidad';
      return parameterClave === clave && parameterTipo === tipoParametro;
    });
    if (typeMatch) return typeMatch;

    return this.existingParameters.find((parameter) => this.normalizeText(parameter.clave ?? '') === clave) ?? null;
  }

  private isSameParameter(existing: ParametroB5DOrm, payload: CrearParametroPayload): boolean {
    return (
      this.normalizeText(existing.clave ?? '') === this.normalizeText(payload.clave ?? '') &&
      this.normalizeText(existing.descripcion ?? '') === this.normalizeText(payload.descripcion ?? '') &&
      (existing.tipo_comparacion ?? 'clave_exacta') === (payload.tipo_comparacion ?? 'clave_exacta') &&
      (existing.tipo_parametro ?? 'cantidad') === (payload.tipo_parametro ?? 'cantidad') &&
      this.normalizeText(existing.tipo_edificacion ?? '') === this.normalizeText(payload.tipo_edificacion ?? '') &&
      this.normalizeText(existing.unidad ?? '') === this.normalizeText(payload.unidad ?? '') &&
      this.parseNumberLike(existing.minimo) === (payload.minimo ?? null) &&
      this.parseNumberLike(existing.maximo) === (payload.maximo ?? null) &&
      this.parseNumberLike(existing.promedio) === (payload.promedio ?? null) &&
      !!existing.activo === !!payload.activo
    );
  }

  private extractSheetRows(xlsxModule: typeof import('xlsx'), sheet: Record<string, unknown>): WorkbookRow[] {
    const rangeRef = (sheet['!ref'] as string | undefined) ?? 'A1:A1';
    const range = xlsxModule.utils.decode_range(rangeRef);
    const rows: WorkbookRow[] = [];

    for (let rowNumber = range.s.r + 1; rowNumber <= range.e.r + 1; rowNumber += 1) {
      const values: unknown[] = [];
      for (let columnNumber = range.s.c; columnNumber <= range.e.c; columnNumber += 1) {
        const address = xlsxModule.utils.encode_cell({ r: rowNumber - 1, c: columnNumber });
        const cell = sheet[address] as { v?: unknown; w?: unknown } | undefined;
        values.push(cell?.v ?? cell?.w ?? '');
      }
      rows.push({ rowNumber, values });
    }

    return rows;
  }

  private detectHeaderCandidates(rows: WorkbookRow[]): WorkbookHeaderCandidate[] {
    return rows
      .slice(0, 40)
      .map((row) => ({
        rowNumber: row.rowNumber,
        score: this.scoreHeaderRow(row.values),
        headers: row.values.map((value) => this.getCellText(value)),
      }))
      .filter((candidate) => candidate.score >= 2)
      .sort((left, right) => right.score - left.score || left.rowNumber - right.rowNumber)
      .slice(0, 8);
  }

  private scoreHeaderRow(values: unknown[]): number {
    let score = 0;
    for (const value of values) {
      const normalized = this.normalizeText(this.getCellText(value));
      if (!normalized) continue;
      if (this.guessFieldFromHeader(normalized)) score += 2;
      else if (normalized.length > 2) score += 1;
    }
    return score;
  }

  private resolveInitialSheetIndex(): number {
    if (!this.sheetStates.length) return 0;
    const bestCandidate = this.sheetStates
      .map((sheet) => ({
        index: sheet.index,
        score: sheet.headerCandidates[0]?.score ?? 0,
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0];
    return bestCandidate?.index ?? 0;
  }

  private resolveLastRelevantColumnIndex(rows: WorkbookRow[], headerValues: unknown[]): number {
    let lastIndex = headerValues.length - 1;
    for (let index = headerValues.length - 1; index >= 0; index -= 1) {
      if (this.getCellText(headerValues[index])) {
        lastIndex = index;
        break;
      }
    }

    for (const row of rows) {
      for (let index = row.values.length - 1; index >= 0; index -= 1) {
        if (this.getCellText(row.values[index])) {
          lastIndex = Math.max(lastIndex, index);
          break;
        }
      }
    }

    return Math.max(lastIndex, 0);
  }

  private findColumnSample(rows: WorkbookRow[], headerRowNumber: number, columnIndex: number): string {
    const row = rows.find((candidate) => candidate.rowNumber > headerRowNumber && this.getCellText(candidate.values[columnIndex]));
    return row ? this.getCellText(row.values[columnIndex]) : '';
  }

  private findFirstMeaningfulRow(rows: WorkbookRow[]): WorkbookRow | null {
    return rows.find((row) => this.rowHasData(row)) ?? null;
  }

  private rowHasData(row: WorkbookRow): boolean {
    return row.values.some((value) => this.getCellText(value).trim().length > 0);
  }

  private getMappedCellValue(row: WorkbookRow, field: ParameterImportField): string {
    const columnIndex = this.fieldMappings[field];
    if (columnIndex == null) return '';
    return this.getCellText(row.values[columnIndex]);
  }

  private getFieldValueFromRow(row: WorkbookRow, field: ParameterImportField): string {
    return this.getMappedCellValue(row, field) || this.fieldDefinitions.find((item) => item.key === field)?.defaultValue || '';
  }

  // Returns the preview value and marks whether it comes from a default.
  private getPreviewCellState(row: WorkbookRow, field: ParameterImportField): PreviewCellState {
    const mappedValue = this.getMappedCellValue(row, field);
    if (mappedValue) {
      return {
        value: mappedValue,
        usesDefaultValue: false,
      };
    }

    const defaultValue = this.fieldDefinitions.find((item) => item.key === field)?.defaultValue ?? '';
    return {
      value: defaultValue || '-',
      usesDefaultValue: !!defaultValue,
    };
  }

  private guessFieldFromHeader(header: string): ParameterImportField | null {
    const normalizedHeader = this.normalizeText(header);
    if (!normalizedHeader) return null;
    if (normalizedHeader === 'parameter') return 'clave';

    for (const fieldDefinition of this.fieldDefinitions) {
      const aliases = FIELD_HEADER_ALIASES[fieldDefinition.key];
      if (aliases.some((alias) => normalizedHeader === this.normalizeText(alias) || normalizedHeader.includes(this.normalizeText(alias)))) {
        return fieldDefinition.key;
      }
    }

    return null;
  }

  private parseComparisonType(value: string): TipoComparacionParametroOrm | null {
    const normalized = this.normalizeText(value);
    if (!normalized) return null;
    if (normalized.includes('descripcion')) return 'descripcion_parcial';
    if (normalized.includes('parcial')) return 'clave_parcial';
    if (normalized.includes('exact')) return 'clave_exacta';
    return null;
  }

  private parseTipoParametro(value: string): TipoParametroOrm | null {
    const normalized = this.normalizeText(value);
    if (!normalized) return null;
    if (normalized.includes('costo') && normalized.includes('%')) return 'costo_porcentaje';
    if (normalized.includes('costo') && normalized.includes('porcentaje')) return 'costo_porcentaje';
    if (normalized.includes('costo')) return 'costo';
    if (normalized.includes('cantidad') || normalized.includes('quantity') || normalized.includes('qty')) return 'cantidad';
    return null;
  }

  private parseBooleanLike(value: string, fallback = false): boolean {
    const normalized = this.normalizeText(value);
    if (!normalized) return fallback;
    if (['1', 'true', 'si', 'sí', 'yes', 'y', 'x', 'activo', 'enabled', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off', 'inactive', 'inactivo'].includes(normalized)) return false;
    return fallback;
  }

  private parseNumberLike(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    let sanitized = normalized.replace(/[^\d.,-]/g, '');
    if (sanitized.includes(',') && sanitized.includes('.')) {
      if (sanitized.lastIndexOf(',') > sanitized.lastIndexOf('.')) {
        sanitized = sanitized.replace(/\./g, '').replace(',', '.');
      } else {
        sanitized = sanitized.replace(/,/g, '');
      }
    } else if (sanitized.includes(',')) {
      sanitized = sanitized.replace(',', '.');
    }
    const numericValue = Number(sanitized);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  private getCellText(value: unknown): string {
    if (value == null) return '';
    return String(value).trim();
  }

  private normalizeText(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Gives the browser a chance to repaint before long synchronous work starts.
  private async yieldToUi(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  // Handles backdrop clicks with a safer margin around the panel border.
  handleBackdropClick(event: MouseEvent): void {
    if (this.importInProgress) return;

    const dialogPanel = this.dialogPanel?.nativeElement;
    if (!dialogPanel) {
      this.closeDialog();
      return;
    }

    const boundary = dialogPanel.getBoundingClientRect();
    const pointerInsideSafeArea =
      event.clientX >= boundary.left - this.closeDialogThreshold &&
      event.clientX <= boundary.right + this.closeDialogThreshold &&
      event.clientY >= boundary.top - this.closeDialogThreshold &&
      event.clientY <= boundary.bottom + this.closeDialogThreshold;

    if (!pointerInsideSafeArea) {
      this.closeDialog();
    }
  }

  private columnLabelFromIndex(index: number): string {
    let label = '';
    let current = index + 1;
    while (current > 0) {
      const remainder = (current - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      current = Math.floor((current - 1) / 26);
    }
    return label;
  }

  private createEmptyFieldMappings(): Record<ParameterImportField, number | null> {
    return {
      activo: null,
      clave: null,
      descripcion: null,
      tipo_comparacion: null,
      tipo_parametro: null,
      tipo_edificacion: null,
      unidad: null,
      minimo: null,
      maximo: null,
      promedio: null,
    };
  }

  private resetWorkbookState(): void {
    this.workbookFileName = '';
    this.workbookError = '';
    this.validationMessage = '';
    this.importMessage = '';
    this.processingMessage = '';
    this.sheetStates = [];
    this.selectedSheetIndex = 0;
    this.selectedHeaderCandidateRowNumber = null;
    this.fieldMappings = this.createEmptyFieldMappings();
  }

  private resetState(): void {
    this.resetWorkbookState();
    this.importInProgress = false;
    this.isWorkbookProcessing = false;
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
