import { Component, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';
import type { SafeResourceUrl } from '@angular/platform-browser';
import type { WorkbookCellOrm, WorkbookImageOrm, WorkbookLayersOrm, WorkbookStyleOrm } from '../../types/b5d-orm';
import { WorkbookPreviewCacheService } from '../../services/workbook-preview-cache.service';
import { buildWorkbookPreviewDocument, sanitizeWorkbookPreviewHtml } from '../../services/workbook-preview-document.util';

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
  selector: 'app-workbook-preview',
  imports: [],
  templateUrl: './workbook-preview.html',
  styleUrl: './workbook-preview.scss',
})
export class WorkbookPreview implements OnChanges, OnDestroy {
  @Input() previewUrl: SafeResourceUrl | null = null;
  @Input() srcDoc: string | null = null;
  @Input() frameMode: 'sandboxed' | 'unsandboxed' = 'sandboxed';
  @Input() title = 'Vista previa';
  @Input() loading = false;
  @Input() error = '';
  @Input() emptyMessage = 'Selecciona una hoja para previsualizar.';
  @Input() projectId: number | null = null;
  @Input() quantificationId: number | null = null;
  @Input() sheetIndex: number | null = null;
  @Input() loadFromLayers = false;
  @Input() zoomPercent = 100;

  renderedSrcDoc: string | null = null;
  internalLoading = false;
  internalError = '';

  private readonly workbookCache = inject(WorkbookPreviewCacheService);
  private loadToken = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['srcDoc'] ||
      changes['previewUrl'] ||
      changes['loadFromLayers'] ||
      changes['projectId'] ||
      changes['quantificationId'] ||
      changes['sheetIndex'] ||
      changes['zoomPercent']
    ) {
      void this.refreshPreview();
    }
  }

  ngOnDestroy(): void {
    this.loadToken += 1;
  }

  get effectiveLoading(): boolean {
    return this.loading || this.internalLoading;
  }

  get effectiveError(): string {
    return this.error || this.internalError;
  }

  private async refreshPreview(): Promise<void> {
    this.internalError = '';

    if (this.srcDoc && this.srcDoc.trim()) {
      this.renderedSrcDoc = this.srcDoc;
      this.internalLoading = false;
      return;
    }

    if (this.previewUrl) {
      this.renderedSrcDoc = null;
      this.internalLoading = false;
      return;
    }

    if (!this.loadFromLayers) {
      this.renderedSrcDoc = null;
      this.internalLoading = false;
      return;
    }

    const projectId = this.projectId;
    const quantificationId = this.quantificationId;
    const sheetIndex = this.sheetIndex;
    if (!projectId || !quantificationId || sheetIndex == null) {
      this.renderedSrcDoc = null;
      this.internalLoading = false;
      return;
    }

    const currentToken = ++this.loadToken;
    this.internalLoading = true;

    try {
      const cachedDocument = this.workbookCache.getSheetDocument(projectId, quantificationId, sheetIndex);
      if (cachedDocument) {
        this.renderedSrcDoc = this.applyZoomToDocument(cachedDocument, this.zoomPercent);
        return;
      }

      const layers = await this.workbookCache.getWorkbookSheetLayers(projectId, quantificationId, sheetIndex);
      if (currentToken !== this.loadToken) return;

      const worksheet = this.buildWorksheetFromWorkbookLayers(layers);
      if (!worksheet) {
        this.renderedSrcDoc = null;
        return;
      }

      const cellStyleIdByAddress = new Map<string, number>();
      for (const cellData of layers.cells) {
        if (!cellData.address || cellData.styleId == null) continue;
        cellStyleIdByAddress.set(cellData.address, cellData.styleId);
      }

      const rowStyleIdByRow = new Map<number, number>();
      for (const rowLayout of layers.layout.rows) {
        if (rowLayout.styleId == null) continue;
        rowStyleIdByRow.set(rowLayout.row, rowLayout.styleId);
      }

      const columnStyleRanges: Array<{ startColumn: number; endColumn: number; styleId: number }> = [];
      for (const columnLayout of layers.layout.columns) {
        if (columnLayout.styleId == null) continue;
        columnStyleRanges.push({
          startColumn: columnLayout.min,
          endColumn: columnLayout.max,
          styleId: columnLayout.styleId,
        });
      }

      const imageDataUriById = await this.loadImageDataUris(projectId, quantificationId, sheetIndex, layers.images);
      if (currentToken !== this.loadToken) return;

      const visualContext: WorkbookVisualContext = {
        cellStyleIdByAddress,
        rowStyleIdByRow,
        columnStyleRanges,
        styleCssById: this.buildStyleCssByIdFromLayerStyles(layers.styles),
        floatingImagesHtml: this.buildFloatingImagesHtmlFromLayers(
          layers.images,
          layers.layout,
          projectId,
          quantificationId,
          sheetIndex,
          imageDataUriById,
        ),
      };

      const gridHtml = this.renderWorksheetGridHtml(worksheet, visualContext);
      const baseDocument = this.buildSheetPreviewDocument(gridHtml, 100);
      this.workbookCache.setSheetDocument(projectId, quantificationId, sheetIndex, baseDocument);
      this.renderedSrcDoc = this.applyZoomToDocument(baseDocument, this.zoomPercent);
    } catch {
      if (currentToken !== this.loadToken) return;
      this.internalError = 'No fue posible cargar la vista previa del libro Excel.';
      this.renderedSrcDoc = null;
    } finally {
      if (currentToken === this.loadToken) {
        this.internalLoading = false;
      }
    }
  }

  private applyZoomToDocument(documentHtml: string, zoomPercent: number): string {
    if (!documentHtml.trim()) return documentHtml;
    const documentParser = new DOMParser();
    const parsedDocument = documentParser.parseFromString(documentHtml, 'text/html');
    const gridShell = parsedDocument.querySelector('.excel-grid-shell') as HTMLElement | null;
    if (!gridShell) return documentHtml;

    const safeZoom = this.clamp(Number.isFinite(zoomPercent) ? zoomPercent : 100, 20, 300);
    gridShell.style.zoom = (safeZoom / 100).toFixed(2);
    return parsedDocument.documentElement.outerHTML;
  }

  private buildWorksheetFromWorkbookLayers(sheetLayers: WorkbookLayersOrm): Record<string, unknown> | null {
    const maxRow = sheetLayers.layout.maxRow || 1;
    const maxCol = sheetLayers.layout.maxCol || 1;
    if (maxRow <= 0 || maxCol <= 0) return null;

    const worksheet: Record<string, unknown> = {};
    worksheet['!ref'] = `A1:${this.columnLabelFromIndex(maxCol - 1)}${maxRow}`;

    const colLayout: Array<Record<string, unknown>> = Array.from({ length: maxCol }, () => ({}));
    for (const columnRange of sheetLayers.layout.columns) {
      for (let columnNumber = columnRange.min; columnNumber <= columnRange.max; columnNumber += 1) {
        const columnIndex = columnNumber - 1;
        if (columnIndex < 0 || columnIndex >= colLayout.length) continue;
        const columnDefinition = colLayout[columnIndex] as Record<string, unknown>;
        if (columnRange.hidden) columnDefinition['hidden'] = true;
        const widthPixels = columnRange.widthPx ?? sheetLayers.layout.defaultColumnWidthPx ?? null;
        if (widthPixels != null) {
          columnDefinition['wpx'] = widthPixels;
        } else if (columnRange.hidden) {
          columnDefinition['wpx'] = 0;
        }
      }
    }
    worksheet['!cols'] = colLayout;

    const rowLayout: Array<Record<string, unknown>> = Array.from({ length: maxRow }, () => ({}));
    for (const rowDef of sheetLayers.layout.rows) {
      const rowIndex = rowDef.row - 1;
      if (rowIndex < 0 || rowIndex >= rowLayout.length) continue;
      const rowDefinition = rowLayout[rowIndex] as Record<string, unknown>;
      if (rowDef.hidden) rowDefinition['hidden'] = true;
      const heightPixels = rowDef.heightPx ?? sheetLayers.layout.defaultRowHeightPx ?? null;
      if (heightPixels != null) {
        rowDefinition['hpx'] = heightPixels;
      } else if (rowDef.hidden) {
        rowDefinition['hpx'] = 0;
      }
    }
    worksheet['!rows'] = rowLayout;

    const styleById = new Map<number, WorkbookStyleOrm>();
    for (const [styleIdRaw, styleDefinition] of Object.entries(sheetLayers.styles)) {
      const styleId = Number.parseInt(styleIdRaw, 10);
      if (!Number.isFinite(styleId)) continue;
      styleById.set(styleId, styleDefinition);
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

    if (cellData.formattedValue != null) worksheetCell['w'] = cellData.formattedValue;
    if (cellData.formula) worksheetCell['f'] = cellData.formula;
    if (cellData.styleId != null) {
      worksheetCell['s'] = this.convertWorkbookStyleToCellStyleObject(styleById.get(cellData.styleId) ?? null);
    }
    return worksheetCell;
  }

  private convertWorkbookStyleToCellStyleObject(workbookStyle: WorkbookStyleOrm | null): Record<string, unknown> | null {
    if (!workbookStyle) return null;
    const cellStyle: Record<string, unknown> = {};
    if (workbookStyle.fill) {
      cellStyle['fill'] = {
        patternType: workbookStyle.fill.type ?? 'solid',
        fgColor: workbookStyle.fill.color ? { rgb: workbookStyle.fill.color.replace('#', '') } : undefined,
        bgColor: workbookStyle.fill.backgroundColor ? { rgb: workbookStyle.fill.backgroundColor.replace('#', '') } : undefined,
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
      const borderDef: Record<string, unknown> = {};
      for (const sideName of ['top', 'right', 'bottom', 'left'] as const) {
        const sideDef = workbookStyle.border[sideName];
        if (!sideDef) continue;
        borderDef[sideName] = {
          style: sideDef.style ?? undefined,
          color: sideDef.color ? { rgb: sideDef.color.replace('#', '') } : undefined,
        };
      }
      cellStyle['border'] = borderDef;
    }
    return cellStyle;
  }

  private buildStyleCssByIdFromLayerStyles(stylesById: Record<string, WorkbookStyleOrm>): Map<number, string> {
    const styleCssById = new Map<number, string>();
    for (const [styleIdRaw, workbookStyle] of Object.entries(stylesById)) {
      const styleId = Number.parseInt(styleIdRaw, 10);
      if (!Number.isFinite(styleId)) continue;
      const cellStyleObject = this.convertWorkbookStyleToCellStyleObject(workbookStyle ?? null);
      if (!cellStyleObject) continue;
      const inlineCss = this.resolveCellInlineStyle({ s: cellStyleObject }, 0, 0, '', null);
      if (!inlineCss) continue;
      styleCssById.set(styleId, inlineCss);
    }
    return styleCssById;
  }

  private async loadImageDataUris(
    projectId: number,
    quantificationId: number,
    sheetIndex: number,
    images: WorkbookImageOrm[],
  ): Promise<Map<string, string>> {
    const imageDataUriById = new Map<string, string>();
    await Promise.all(
      images.map(async (imageData) => {
        try {
          const dataUri = await this.workbookCache.getWorkbookImageDataUri(
            projectId,
            quantificationId,
            sheetIndex,
            imageData.id,
          );
          if (dataUri) imageDataUriById.set(imageData.id, dataUri);
        } catch {
          // Keeps rendering even when some images fail to load.
        }
      }),
    );
    return imageDataUriById;
  }

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
        const rowDef = layout.rows.find((rowData) => rowData.row === currentRow);
        positionTopPx += rowDef?.heightPx ?? layout.defaultRowHeightPx ?? 22;
      }
      return positionTopPx;
    };

    return images.map((imageData) => {
      const fromAnchor = imageData.anchor.from;
      const leftPx = resolveColumnLeftPx(fromAnchor.col) + (fromAnchor.colOffsetPx ?? 0);
      const topPx = resolveRowTopPx(fromAnchor.row) + (fromAnchor.rowOffsetPx ?? 0);
      const imageSource =
        imageDataUriById.get(imageData.id) ??
        `/api/proyectos/${projectId}/cuantificaciones/${quantificationId}/libro-excel/hojas/${sheetIndex}/imagenes/${imageData.id}/`;

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

  private renderWorksheetGridHtml(worksheet: Record<string, unknown>, visualContext: WorkbookVisualContext | null): string {
    const bounds = this.resolveWorksheetBounds(worksheet);
    if (!bounds) return '';

    const mergeMap = this.buildMergeMap(worksheet, bounds);
    const headerColumns: string[] = [];
    const colStyles: string[] = [];

    for (let colIndex = bounds.startColumn; colIndex <= bounds.endColumn; colIndex += 1) {
      headerColumns.push(this.columnLabelFromIndex(colIndex));
      const hiddenColumn = this.isColumnHidden(worksheet, colIndex);
      const widthPixels = this.resolveColumnWidthPixels(worksheet, colIndex);
      const colStyleSegments: string[] = [];
      if (widthPixels != null) {
        colStyleSegments.push(`width:${widthPixels}px`);
        colStyleSegments.push(`min-width:${widthPixels}px`);
      }
      if (hiddenColumn) colStyleSegments.push('display:none');
      const colStyle = colStyleSegments.length ? ` style="${colStyleSegments.join(';')};"` : '';
      colStyles.push(`<col${colStyle} />`);
    }

    const rowHtml: string[] = [];
    for (let rowIndex = bounds.startRow; rowIndex <= bounds.endRow; rowIndex += 1) {
      const rowNumber = rowIndex + 1;
      const hiddenRow = this.isRowHidden(worksheet, rowIndex);
      const rowHeightPixels = this.resolveRowHeightPixels(worksheet, rowIndex);
      const rowStyleSegments: string[] = [];
      if (rowHeightPixels != null) rowStyleSegments.push(`height:${rowHeightPixels}px`);
      if (hiddenRow) rowStyleSegments.push('display:none');
      const rowStyle = rowStyleSegments.length ? ` style="${rowStyleSegments.join(';')};"` : '';
      const cellsHtml: string[] = [`<th class="row-header" scope="row" data-row="${rowIndex}">${rowNumber}</th>`];

      for (let colIndex = bounds.startColumn; colIndex <= bounds.endColumn; colIndex += 1) {
        const mergeKey = `${rowIndex}:${colIndex}`;
        const mergeMeta = mergeMap.get(mergeKey);
        if (mergeMeta?.skip) continue;

        const cellAddress = this.encodeCellAddress(rowIndex, colIndex);
        const cellData = worksheet[cellAddress] as Record<string, unknown> | undefined;
        const cellContentHtml = this.renderCellContentHtml(cellData);
        const mergeAttrs = mergeMeta ? ` rowspan="${mergeMeta.rowSpan}" colspan="${mergeMeta.colSpan}"` : '';
        const cellCssClass = this.resolveCellCssClass(cellData);
        const cellInlineStyle = this.resolveCellInlineStyle(cellData, rowIndex, colIndex, cellAddress, visualContext);
        const hiddenColumn = this.isColumnHidden(worksheet, colIndex);
        const cellStyleSegments = [cellInlineStyle];
        if (hiddenColumn) cellStyleSegments.push('display:none');
        const mergedCellStyle = cellStyleSegments.filter((item) => !!item).join(';');
        const cellStyleAttr = mergedCellStyle ? ` style="${this.escapeHtmlAttribute(mergedCellStyle)}"` : '';
        cellsHtml.push(
          `<td class="${cellCssClass}" data-r="${rowIndex}" data-c="${colIndex}"${mergeAttrs}${cellStyleAttr}>${cellContentHtml}</td>`,
        );
      }

      rowHtml.push(`<tr${rowStyle}>${cellsHtml.join('')}</tr>`);
    }

    const headerRow = headerColumns
      .map(
        (label, idx) =>
          `<th class="column-header" scope="col" data-col="${bounds.startColumn + idx}"${
            this.isColumnHidden(worksheet, bounds.startColumn + idx) ? ' style="display:none;"' : ''
          }>${label}</th>`,
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
            <th class="corner-header corner-header--select-all"></th>
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

  private resolveWorksheetBounds(worksheet: Record<string, unknown>): WorksheetBounds | null {
    const cellAddressPattern = /^[A-Z]+[1-9]\d*$/;
    let startRow = 0;
    let startCol = 0;
    let endRow = 0;
    let endCol = 0;
    let hasCellData = false;

    const rawRef = typeof worksheet['!ref'] === 'string' ? (worksheet['!ref'] as string) : '';
    if (rawRef) {
      const [startAddress, endAddress] = rawRef.split(':');
      const startDecoded = this.decodeCellAddress(startAddress);
      const endDecoded = this.decodeCellAddress(endAddress ?? startAddress);
      if (startDecoded && endDecoded) {
        startRow = Math.min(startDecoded.row, endDecoded.row);
        startCol = Math.min(startDecoded.col, endDecoded.col);
        endRow = Math.max(startDecoded.row, endDecoded.row);
        endCol = Math.max(startDecoded.col, endDecoded.col);
        hasCellData = true;
      }
    }

    for (const key of Object.keys(worksheet)) {
      if (!cellAddressPattern.test(key)) continue;
      const cellAddress = this.decodeCellAddress(key);
      if (!cellAddress) continue;
      endRow = Math.max(endRow, cellAddress.row);
      endCol = Math.max(endCol, cellAddress.col);
      hasCellData = true;
    }

    const merges = (worksheet['!merges'] as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> | undefined) ?? [];
    for (const mergeRange of merges) {
      endRow = Math.max(endRow, mergeRange.e.r);
      endCol = Math.max(endCol, mergeRange.e.c);
      hasCellData = true;
    }

    if (!hasCellData) return null;

    const maxRows = 500;
    const maxCols = 120;
    return {
      startRow,
      startColumn: startCol,
      endRow: Math.min(endRow, startRow + maxRows - 1),
      endColumn: Math.min(endCol, startCol + maxCols - 1),
    };
  }

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

      for (let row = startRow; row <= endRow; row += 1) {
        for (let col = startColumn; col <= endColumn; col += 1) {
          if (row === startRow && col === startColumn) continue;
          mergeMap.set(`${row}:${col}`, { rowSpan: 1, colSpan: 1, skip: true });
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

  private encodeCellAddress(rowIndex: number, columnIndex: number): string {
    return `${this.columnLabelFromIndex(columnIndex)}${rowIndex + 1}`;
  }

  private decodeCellAddress(address: string): { row: number; col: number } | null {
    const match = /^([A-Z]+)(\d+)$/.exec((address || '').trim().toUpperCase());
    if (!match) return null;
    let column = 0;
    for (const char of match[1]) {
      column = column * 26 + (char.charCodeAt(0) - 65 + 1);
    }
    const row = Number.parseInt(match[2], 10);
    if (!Number.isFinite(row) || row <= 0 || column <= 0) return null;
    return { row: row - 1, col: column - 1 };
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
    if (typeof columnInfo['wpx'] === 'number' && Number.isFinite(columnInfo['wpx']) && (columnInfo['wpx'] as number) <= 0) {
      return true;
    }
    if (typeof columnInfo['wch'] === 'number' && Number.isFinite(columnInfo['wch']) && (columnInfo['wch'] as number) <= 0) {
      return true;
    }
    return false;
  }

  private isRowHidden(worksheet: Record<string, unknown>, rowIndex: number): boolean {
    const rows = worksheet['!rows'] as Array<Record<string, unknown>> | undefined;
    const rowInfo = rows?.[rowIndex];
    if (!rowInfo) return false;
    if (rowInfo['hidden'] === true) return true;
    if (typeof rowInfo['hpx'] === 'number' && Number.isFinite(rowInfo['hpx']) && (rowInfo['hpx'] as number) <= 0) return true;
    if (typeof rowInfo['hpt'] === 'number' && Number.isFinite(rowInfo['hpt']) && (rowInfo['hpt'] as number) <= 0) return true;
    return false;
  }

  private renderCellContentHtml(cellData: Record<string, unknown> | undefined): string {
    if (!cellData) return '';

    const richHtml = typeof cellData['h'] === 'string' ? this.sanitizeSheetHtml(cellData['h'] as string).trim() : '';
    const textValue =
      typeof cellData['w'] === 'string' ? (cellData['w'] as string) : cellData['v'] == null ? '' : String(cellData['v']);
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

  private resolveCellInlineStyle(
    cellData: Record<string, unknown> | undefined,
    rowIndex: number,
    columnIndex: number,
    cellAddress: string,
    visualContext: WorkbookVisualContext | null,
  ): string {
    const styleFromXmlIndex = this.resolveStyleCssFromWorkbookContext(rowIndex, columnIndex, cellAddress, visualContext);
    const styleInfo = this.asRecord(cellData?.['s']);
    if (!styleInfo) return styleFromXmlIndex;

    const cssRules: string[] = [];
    let resolvedFillColor = '';

    const fillInfo = this.asRecord(styleInfo['fill']);
    const patternType = typeof fillInfo?.['patternType'] === 'string' ? (fillInfo['patternType'] as string).toLowerCase() : '';
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

      const fontName = typeof fontInfo['name'] === 'string' ? (fontInfo['name'] as string).trim() : '';
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
      if (styleFromCellObject === styleFromXmlIndex) return styleFromCellObject;
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

    const oneBasedColumn = columnIndex + 1;
    for (const columnRange of visualContext.columnStyleRanges) {
      if (oneBasedColumn >= columnRange.startColumn && oneBasedColumn <= columnRange.endColumn) {
        return columnRange.styleId;
      }
    }
    return null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private resolveExcelColor(colorValue: unknown): string | null {
    const colorInfo = this.asRecord(colorValue);
    if (!colorInfo) return null;

    const rgbValue = typeof colorInfo['rgb'] === 'string' ? (colorInfo['rgb'] as string).trim() : '';
    if (rgbValue) {
      const normalizedRgb = rgbValue.startsWith('#') ? rgbValue.slice(1) : rgbValue;
      if (/^[0-9a-fA-F]{8}$/.test(normalizedRgb)) return `#${normalizedRgb.slice(2).toUpperCase()}`;
      if (/^[0-9a-fA-F]{6}$/.test(normalizedRgb)) return `#${normalizedRgb.toUpperCase()}`;
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

  private resolveBorderCss(borderSideInfo: Record<string, unknown> | null): string {
    if (!borderSideInfo) return '';
    const borderStyle = typeof borderSideInfo['style'] === 'string' ? (borderSideInfo['style'] as string).toLowerCase() : '';
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

  private resolveHorizontalAlignment(horizontalValue: unknown): string {
    if (typeof horizontalValue !== 'string') return '';
    const normalizedValue = horizontalValue.toLowerCase();
    if (normalizedValue === 'center' || normalizedValue === 'centercontinuous') return 'center';
    if (normalizedValue === 'right') return 'right';
    if (normalizedValue === 'justify') return 'justify';
    if (normalizedValue === 'left') return 'left';
    return '';
  }

  private resolveVerticalAlignment(verticalValue: unknown): string {
    if (typeof verticalValue !== 'string') return '';
    const normalizedValue = verticalValue.toLowerCase();
    if (normalizedValue === 'top') return 'top';
    if (normalizedValue === 'center') return 'middle';
    if (normalizedValue === 'bottom') return 'bottom';
    return '';
  }

  private quoteFontFamily(fontFamily: string): string {
    return `"${fontFamily.replace(/"/g, '')}"`;
  }

  private normalizeLinkTarget(url: string): string {
    const trimmedUrl = url.trim();
    if (/^(https?:|mailto:|#)/i.test(trimmedUrl)) return trimmedUrl;
    return '';
  }

  private hexToRgb(hexColor: string): { red: number; green: number; blue: number } | null {
    const normalizedColor = (hexColor || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalizedColor)) return null;
    const red = Number.parseInt(normalizedColor.slice(0, 2), 16);
    const green = Number.parseInt(normalizedColor.slice(2, 4), 16);
    const blue = Number.parseInt(normalizedColor.slice(4, 6), 16);
    if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) return null;
    return { red, green, blue };
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

  private sanitizeSheetHtml(sheetHtml: string): string {
    return sanitizeWorkbookPreviewHtml(sheetHtml);
  }

  private buildSheetPreviewDocument(sheetHtml: string, zoomPercent: number): string {
    return buildWorkbookPreviewDocument({
      sheetHtml,
      zoomPercent,
    });
  }

  private clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(maxValue, Math.max(minValue, value));
  }
}
