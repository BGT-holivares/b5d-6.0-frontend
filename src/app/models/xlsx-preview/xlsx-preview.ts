import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import type {
  WorkbookCellOrm,
  WorkbookImageOrm,
  WorkbookLayersOrm,
  WorkbookStyleOrm,
} from '../../types/b5d-orm';
import { WorkbookPreviewCacheService } from '../../services/workbook-preview-cache.service';
import { handlePanelZoomWheel } from '../../utils/panel-interactions/panel-interactions';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';

type XlsxPreviewRenderedColumn = {
  columnNumber: number;
  label: string;
  widthPx: number | null;
};

type XlsxPreviewRenderedCell = {
  address: string;
  row: number;
  col: number;
  text: string;
  formula: string;
  className: string;
  inlineStyle: string;
  rowSpan: number;
  colSpan: number;
  skip: boolean;
};

type XlsxPreviewRenderedRow = {
  rowNumber: number;
  heightPx: number | null;
  hidden: boolean;
  cells: XlsxPreviewRenderedCell[];
};

type XlsxPreviewRenderedImage = {
  id: string;
  src: string;
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
};

type XlsxPreviewRenderedSheet = {
  sheetName: string;
  columns: XlsxPreviewRenderedColumn[];
  rows: XlsxPreviewRenderedRow[];
  images: XlsxPreviewRenderedImage[];
  canvasWidthPx: number;
  canvasHeightPx: number;
};

type XlsxPreviewVisualContext = {
  cellStyleIdByAddress: Map<string, number>;
  rowStyleIdByRow: Map<number, number>;
  columnStyleRanges: Array<{ startColumn: number; endColumn: number; styleId: number }>;
  styleCssById: Map<number, string>;
};

@Component({
  selector: 'app-xlsx-preview',
  standalone: true,
  imports: [],
  templateUrl: './xlsx-preview.html',
  styleUrl: './xlsx-preview.scss',
})
export class XlsxPreview implements OnChanges, OnDestroy {
  // Manual attention needed: remaining preview copy.
  @Input() loading = false;
  @Input() error = '';
  @Input() emptyMessage = '';
  @Input() projectId: number | null = null;
  @Input() quantificationId: number | null = null;
  @Input() sheetIndex: number | null = null;
  @Input() zoomPercent = 100;
  @Input() interactive = false;
  @Input() loadFromLayers = true;

  @Output() cellSelected = new EventEmitter<{
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
  }>();
  @Output() zoomRequested = new EventEmitter<'in' | 'out'>();

  renderedSheet: XlsxPreviewRenderedSheet | null = null;
  internalLoading = false;
  internalError = '';

  readonly i18n = inject(I18nService);
  readonly globalTranslations = GLOBAL_TRANSLATIONS;
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  private readonly workbookPreviewCache = inject(WorkbookPreviewCacheService);
  private loadToken = 0;
  private selectedCellAddresses = new Set<string>();
  private selectionAnchorAddress: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['projectId'] ||
      changes['quantificationId'] ||
      changes['sheetIndex'] ||
      changes['loadFromLayers']
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

  get zoomFactor(): number {
    const safeZoom = this.clamp(Number.isFinite(this.zoomPercent) ? this.zoomPercent : 100, 20, 300);
    return safeZoom / 100;
  }

  onSurfaceWheel(event: WheelEvent): void {
    handlePanelZoomWheel(
      event,
      () => this.zoomRequested.emit('in'),
      () => this.zoomRequested.emit('out'),
    );
  }

  onCellClick(cell: XlsxPreviewRenderedCell, event: MouseEvent): void {
    const address = cell.address.toUpperCase();
    if (event.shiftKey && this.selectionAnchorAddress) {
      const anchorAddress = this.selectionAnchorAddress;
      this.selectRange(anchorAddress, address);
    } else if (event.ctrlKey || event.metaKey) {
      if (this.selectedCellAddresses.has(address)) {
        this.selectedCellAddresses.delete(address);
      } else {
        this.selectedCellAddresses.add(address);
      }
      this.selectionAnchorAddress = address;
    } else {
      this.selectedCellAddresses = new Set([address]);
      this.selectionAnchorAddress = address;
    }

    this.emitSelectedCell(cell, event.currentTarget as HTMLElement | null);
  }

  isCellSelected(address: string): boolean {
    return this.selectedCellAddresses.has(address.toUpperCase());
  }

  trackByColumn = (_index: number, item: XlsxPreviewRenderedColumn): string => item.label;
  trackByRow = (_index: number, item: XlsxPreviewRenderedRow): number => item.rowNumber;
  trackByCell = (_index: number, item: XlsxPreviewRenderedCell): string => item.address;
  trackByImage = (_index: number, item: XlsxPreviewRenderedImage): string => item.id;

  private async refreshPreview(): Promise<void> {
    this.internalError = '';
    this.renderedSheet = null;
    this.selectedCellAddresses = new Set();
    this.selectionAnchorAddress = null;

    const projectId = this.projectId;
    const quantificationId = this.quantificationId;
    const sheetIndex = this.sheetIndex;
    if (!projectId || !quantificationId || sheetIndex == null) {
      this.internalLoading = false;
      return;
    }

    const currentToken = ++this.loadToken;
    this.internalLoading = true;

    try {
      const workbookSummary = await this.workbookPreviewCache.getWorkbookSummary(projectId, quantificationId);
      if (currentToken !== this.loadToken) return;
      if (!workbookSummary.sheets.length) {
        this.internalError = 'El libro Excel no contiene hojas visibles para mostrar.';
        return;
      }

      if (!this.loadFromLayers) {
        this.internalError = 'No fue posible cargar la vista previa del libro Excel.';
        return;
      }

      const layers = await this.workbookPreviewCache.getWorkbookSheetLayers(projectId, quantificationId, sheetIndex);
      if (currentToken !== this.loadToken) return;

      const imageDataUriById = await this.loadImageDataUris(projectId, quantificationId, sheetIndex, layers.images);
      if (currentToken !== this.loadToken) return;

      this.renderedSheet = this.buildRenderedSheet(projectId, quantificationId, sheetIndex, layers, imageDataUriById);
    } catch {
      if (currentToken !== this.loadToken) return;
      this.internalError = 'No fue posible cargar la vista previa del libro Excel.';
    } finally {
      if (currentToken === this.loadToken) {
        this.internalLoading = false;
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  private buildRenderedSheet(
    projectId: number,
    quantificationId: number,
    sheetIndex: number,
    layers: WorkbookLayersOrm,
    imageDataUriById: Map<string, string>,
  ): XlsxPreviewRenderedSheet {
    const maxRow = Math.max(1, layers.layout.maxRow || 1);
    const maxCol = Math.max(1, layers.layout.maxCol || 1);
    const visualContext = this.buildVisualContext(layers);
    const cellByAddress = new Map<string, WorkbookCellOrm>();
    for (const cell of layers.cells) {
      if (cell.address) cellByAddress.set(cell.address.toUpperCase(), cell);
    }

    const mergeMap = this.buildMergeMap(layers);
    const columns: XlsxPreviewRenderedColumn[] = [];
    const columnWidths: number[] = [];
    for (let columnNumber = 1; columnNumber <= maxCol; columnNumber += 1) {
      const widthPx = this.resolveColumnWidthPx(layers.layout, columnNumber);
      const hidden = this.isColumnHidden(layers.layout, columnNumber);
      if (hidden) continue;
      columns.push({
        columnNumber,
        label: this.columnLabelFromIndex(columnNumber - 1),
        widthPx,
      });
      columnWidths.push(widthPx ?? layers.layout.defaultColumnWidthPx ?? 80);
    }

    const rows: XlsxPreviewRenderedRow[] = [];
    const rowHeights: number[] = [];
    for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
      const hidden = this.isRowHidden(layers.layout, rowNumber);
      const heightPx = this.resolveRowHeightPx(layers.layout, rowNumber);
      rows.push({
        rowNumber,
        heightPx,
        hidden,
        cells: [],
      });
      rowHeights.push(hidden ? 0 : heightPx ?? layers.layout.defaultRowHeightPx ?? 22);
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const rowNumber = rowIndex + 1;
      const row = rows[rowIndex];
      for (let visibleColumnIndex = 0; visibleColumnIndex < columns.length; visibleColumnIndex += 1) {
        const column = columns[visibleColumnIndex];
        const colNumber = column.columnNumber;
        const address = `${this.columnLabelFromIndex(colNumber - 1)}${rowNumber}`;
        const mergeMeta = mergeMap.get(address) ?? { rowSpan: 1, colSpan: 1, skip: false };
        if (mergeMeta.skip) {
          continue;
        }

        const cellData = cellByAddress.get(address) ?? null;
        row.cells.push({
          address,
          row: rowNumber,
          col: colNumber,
          text: this.renderCellText(cellData),
          formula: cellData?.formula ?? '',
          className: this.resolveCellCssClass(cellData),
          inlineStyle: this.resolveCellInlineStyle(cellData, rowIndex, colNumber - 1, address, visualContext),
          rowSpan: mergeMeta.rowSpan,
          colSpan: mergeMeta.colSpan,
          skip: false,
        });
      }
    }

    const canvasWidthPx = Math.max(48 + columnWidths.reduce((total, width) => total + width, 0), 48 + 80 * Math.min(columns.length, 6));
    const canvasHeightPx = Math.max(
      22 + rowHeights.reduce((total, height) => total + height, 0),
      22 + 22 * Math.min(maxRow, 12),
    );

    const images = this.buildFloatingImagesFromLayers(
      projectId,
      quantificationId,
      sheetIndex,
      layers.images,
      layers.layout,
      imageDataUriById,
    );
    let imageExtentRight = canvasWidthPx;
    let imageExtentBottom = canvasHeightPx;
    for (const image of images) {
      imageExtentRight = Math.max(imageExtentRight, image.leftPx + image.widthPx + 16);
      imageExtentBottom = Math.max(imageExtentBottom, image.topPx + image.heightPx + 16);
    }

    return {
      sheetName: layers.sheet.name,
      columns,
      rows,
      images,
      canvasWidthPx: imageExtentRight,
      canvasHeightPx: imageExtentBottom,
    };
  }

  private buildVisualContext(layers: WorkbookLayersOrm): XlsxPreviewVisualContext {
    const cellStyleIdByAddress = new Map<string, number>();
    for (const cell of layers.cells) {
      if (!cell.address || cell.styleId == null) continue;
      cellStyleIdByAddress.set(cell.address.toUpperCase(), cell.styleId);
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

    return {
      cellStyleIdByAddress,
      rowStyleIdByRow,
      columnStyleRanges,
      styleCssById: this.buildStyleCssByIdFromLayerStyles(layers.styles),
    };
  }

  private buildMergeMap(layers: WorkbookLayersOrm): Map<string, { rowSpan: number; colSpan: number; skip: boolean }> {
    const mergeMap = new Map<string, { rowSpan: number; colSpan: number; skip: boolean }>();
    for (const merge of layers.merges) {
      const rowSpan = Math.max(1, merge.rowSpan);
      const colSpan = Math.max(1, this.countVisibleColumnsInRange(layers.layout, merge.startCol, merge.endCol));
      const startAddress = merge.startAddress?.toUpperCase() || `${this.columnLabelFromIndex(merge.startCol - 1)}${merge.startRow}`;
      mergeMap.set(startAddress, { rowSpan, colSpan, skip: false });

      for (let row = merge.startRow; row <= merge.endRow; row += 1) {
        for (let col = merge.startCol; col <= merge.endCol; col += 1) {
          const address = `${this.columnLabelFromIndex(col - 1)}${row}`;
          if (row === merge.startRow && col === merge.startCol) continue;
          mergeMap.set(address, { rowSpan: 1, colSpan: 1, skip: true });
        }
      }
    }
    return mergeMap;
  }

  private countVisibleColumnsInRange(layout: WorkbookLayersOrm['layout'], startCol: number, endCol: number): number {
    let count = 0;
    for (let columnNumber = startCol; columnNumber <= endCol; columnNumber += 1) {
      if (!this.isColumnHidden(layout, columnNumber)) count += 1;
    }
    return count;
  }

  private buildFloatingImagesFromLayers(
    projectId: number,
    quantificationId: number,
    sheetIndex: number,
    images: WorkbookImageOrm[],
    layout: WorkbookLayersOrm['layout'],
    imageDataUriById: Map<string, string>,
  ): XlsxPreviewRenderedImage[] {
    return images.map((imageData) => {
      const fromAnchor = imageData.anchor.from;
      const leftPx = this.resolveColumnLeftPx(layout, fromAnchor.col) + (fromAnchor.colOffsetPx ?? 0);
      const topPx = this.resolveRowTopPx(layout, fromAnchor.row) + (fromAnchor.rowOffsetPx ?? 0);
      const imageSource =
        imageDataUriById.get(imageData.id) ||
        `/api/proyectos/${projectId}/cuantificaciones/${quantificationId}/libro-excel/hojas/${sheetIndex}/imagenes/${imageData.id}/`;

      let widthPx = imageData.widthPx ?? 100;
      let heightPx = imageData.heightPx ?? 60;
      if (imageData.anchor.to) {
        const toAnchor = imageData.anchor.to;
        const rightPx = this.resolveColumnLeftPx(layout, toAnchor.col) + (toAnchor.colOffsetPx ?? 0);
        const bottomPx = this.resolveRowTopPx(layout, toAnchor.row) + (toAnchor.rowOffsetPx ?? 0);
        widthPx = Math.max(16, rightPx - leftPx);
        heightPx = Math.max(16, bottomPx - topPx);
      }

      return {
        id: imageData.id,
        src: imageSource,
        leftPx,
        topPx,
        widthPx,
        heightPx,
      };
    });
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
          const dataUri = await this.workbookPreviewCache.getWorkbookImageDataUri(
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

  private resolveCellText(cellData: WorkbookCellOrm | null): string {
    if (!cellData) return '';
    if (cellData.formattedValue != null) return String(cellData.formattedValue);
    if (cellData.value == null) return '';
    return String(cellData.value);
  }

  private renderCellText(cellData: WorkbookCellOrm | null): string {
    return this.resolveCellText(cellData);
  }

  private resolveCellCssClass(cellData: WorkbookCellOrm | null): string {
    const cellType = typeof cellData?.type === 'string' ? cellData.type.toLowerCase() : '';
    if (cellType === 'n') return 'b5d-xlsx-preview__cell b5d-xlsx-preview__cell--numeric';
    if (cellType === 'b') return 'b5d-xlsx-preview__cell b5d-xlsx-preview__cell--boolean';
    return 'b5d-xlsx-preview__cell';
  }

  private resolveCellInlineStyle(
    cellData: WorkbookCellOrm | null,
    rowIndex: number,
    columnIndex: number,
    cellAddress: string,
    visualContext: XlsxPreviewVisualContext,
  ): string {
    const styleId = this.resolveWorkbookStyleId(rowIndex, columnIndex, cellAddress, visualContext, cellData?.styleId ?? null);
    if (styleId == null) return '';
    return visualContext.styleCssById.get(styleId) ?? '';
  }

  private resolveWorkbookStyleId(
    rowIndex: number,
    columnIndex: number,
    cellAddress: string,
    visualContext: XlsxPreviewVisualContext,
    cellStyleId: number | null,
  ): number | null {
    if (cellStyleId != null) return cellStyleId;

    const normalizedAddress = cellAddress.toUpperCase();
    const cellStyleIdFromCell = visualContext.cellStyleIdByAddress.get(normalizedAddress);
    if (cellStyleIdFromCell != null) return cellStyleIdFromCell;

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

  private buildStyleCssByIdFromLayerStyles(stylesById: Record<string, WorkbookStyleOrm>): Map<number, string> {
    const styleCssById = new Map<number, string>();
    for (const [styleIdRaw, workbookStyle] of Object.entries(stylesById)) {
      const styleId = Number.parseInt(styleIdRaw, 10);
      if (!Number.isFinite(styleId)) continue;
      const cellStyleObject = this.convertWorkbookStyleToCellStyleObject(workbookStyle ?? null);
      if (!cellStyleObject) continue;
      const inlineCss = this.resolveCellInlineStyleFromStyleObject(cellStyleObject);
      if (!inlineCss) continue;
      styleCssById.set(styleId, inlineCss);
    }
    return styleCssById;
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

  private resolveCellInlineStyleFromStyleObject(styleInfo: Record<string, unknown>): string {
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
    let hasExplicitFontColor = /(?:^|;)color\s*:/i.test(cssRules.join(';'));
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

    return cssRules.join(';');
  }

  private resolveExcelColor(colorValue: unknown): string | null {
    const colorInfo = this.asRecord(colorValue);
    if (!colorInfo) return null;

    const rgbValue = typeof colorInfo['rgb'] === 'string' ? (colorInfo['rgb'] as string).trim() : '';
    if (rgbValue) {
      const normalizedRgb = rgbValue.startsWith('#') ? rgbValue.slice(1) : rgbValue;
      if (/^[0-9a-fA-F]{6}$/.test(normalizedRgb)) {
        return `#${normalizedRgb.toUpperCase()}`;
      }
    }
    return null;
  }

  private resolveHorizontalAlignment(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (['left', 'center', 'right', 'justify'].includes(normalized)) return normalized;
    return null;
  }

  private resolveVerticalAlignment(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'top') return 'top';
    if (normalized === 'center') return 'middle';
    if (normalized === 'bottom') return 'bottom';
    if (normalized === 'justify') return 'middle';
    return null;
  }

  private resolveBorderCss(borderSideInfo: Record<string, unknown> | null): string | null {
    if (!borderSideInfo) return null;
    const styleName = typeof borderSideInfo['style'] === 'string' ? (borderSideInfo['style'] as string).trim().toLowerCase() : '';
    if (!styleName || styleName === 'none') return null;

    const width = this.resolveBorderWidth(styleName);
    const color = this.resolveExcelColor(borderSideInfo['color']) ?? '#111827';
    return `${width} solid ${color}`;
  }

  private resolveBorderWidth(styleName: string): string {
    if (['hair', 'thin'].includes(styleName)) return '1px';
    if (['medium', 'dashdot', 'dashed', 'mediumdashdot', 'dashdotdot'].includes(styleName)) return '2px';
    if (['thick', 'double', 'slantdashdot', 'mediumdashdotdot'].includes(styleName)) return '3px';
    return '1px';
  }

  private resolveReadableTextColorForBackground(backgroundColor: string): string {
    const rgb = this.hexToRgb(backgroundColor);
    if (!rgb) return '';
    const luminance = 0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue;
    return luminance < 140 ? '#FFFFFF' : '#111827';
  }

  private hexToRgb(color: string): { red: number; green: number; blue: number } | null {
    const normalizedColor = color.startsWith('#') ? color.slice(1) : color;
    if (!/^[0-9a-fA-F]{6}$/.test(normalizedColor)) return null;
    const red = Number.parseInt(normalizedColor.slice(0, 2), 16);
    const green = Number.parseInt(normalizedColor.slice(2, 4), 16);
    const blue = Number.parseInt(normalizedColor.slice(4, 6), 16);
    if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) return null;
    return { red, green, blue };
  }

  private quoteFontFamily(fontFamily: string): string {
    const trimmed = fontFamily.trim();
    if (!trimmed) return 'inherit';
    if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private resolveColumnLayout(layout: WorkbookLayersOrm['layout'], columnNumber: number): WorkbookLayersOrm['layout']['columns'][number] | null {
    return layout.columns.find((range) => columnNumber >= range.min && columnNumber <= range.max) ?? null;
  }

  private resolveColumnWidthPx(layout: WorkbookLayersOrm['layout'], columnNumber: number): number | null {
    const columnLayout = this.resolveColumnLayout(layout, columnNumber);
    if (!columnLayout) return null;
    if (typeof columnLayout.widthPx === 'number' && Number.isFinite(columnLayout.widthPx)) {
      return Math.max(0, Math.round(columnLayout.widthPx));
    }
    if (typeof columnLayout.width === 'number' && Number.isFinite(columnLayout.width)) {
      return Math.max(0, Math.round(columnLayout.width * 8 + 12));
    }
    return null;
  }

  private resolveRowHeightPx(layout: WorkbookLayersOrm['layout'], rowNumber: number): number | null {
    const rowLayout = layout.rows.find((row) => row.row === rowNumber) ?? null;
    if (!rowLayout) return null;
    if (typeof rowLayout.heightPx === 'number' && Number.isFinite(rowLayout.heightPx)) {
      return Math.max(0, Math.round(rowLayout.heightPx));
    }
    if (typeof rowLayout.heightPt === 'number' && Number.isFinite(rowLayout.heightPt)) {
      return Math.max(0, Math.round(rowLayout.heightPt * (96 / 72)));
    }
    return null;
  }

  private isColumnHidden(layout: WorkbookLayersOrm['layout'], columnNumber: number): boolean {
    const columnLayout = this.resolveColumnLayout(layout, columnNumber);
    if (!columnLayout) return false;
    if (columnLayout.hidden === true) return true;
    if (typeof columnLayout.widthPx === 'number' && Number.isFinite(columnLayout.widthPx) && columnLayout.widthPx <= 0) return true;
    if (typeof columnLayout.width === 'number' && Number.isFinite(columnLayout.width) && columnLayout.width <= 0) return true;
    return false;
  }

  private isRowHidden(layout: WorkbookLayersOrm['layout'], rowNumber: number): boolean {
    const rowLayout = layout.rows.find((row) => row.row === rowNumber) ?? null;
    if (!rowLayout) return false;
    if (rowLayout.hidden === true) return true;
    if (typeof rowLayout.heightPx === 'number' && Number.isFinite(rowLayout.heightPx) && rowLayout.heightPx <= 0) return true;
    if (typeof rowLayout.heightPt === 'number' && Number.isFinite(rowLayout.heightPt) && rowLayout.heightPt <= 0) return true;
    return false;
  }

  private resolveColumnLeftPx(layout: WorkbookLayersOrm['layout'], columnNumber: number): number {
    let leftPx = 48;
    for (let currentColumn = 1; currentColumn < columnNumber; currentColumn += 1) {
      const columnLayout = this.resolveColumnLayout(layout, currentColumn);
      if (this.isColumnHidden(layout, currentColumn)) continue;
      leftPx += columnLayout?.widthPx ?? layout.defaultColumnWidthPx ?? 80;
    }
    return leftPx;
  }

  private resolveRowTopPx(layout: WorkbookLayersOrm['layout'], rowNumber: number): number {
    let topPx = 22;
    for (let currentRow = 1; currentRow < rowNumber; currentRow += 1) {
      const rowLayout = layout.rows.find((row) => row.row === currentRow) ?? null;
      if (this.isRowHidden(layout, currentRow)) continue;
      topPx += rowLayout?.heightPx ?? layout.defaultRowHeightPx ?? 22;
    }
    return topPx;
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

  private selectRange(startAddress: string, endAddress: string): void {
    const start = this.decodeCellAddress(startAddress);
    const end = this.decodeCellAddress(endAddress);
    if (!start || !end) return;

    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);

    const addresses = new Set<string>();
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        addresses.add(`${this.columnLabelFromIndex(col)}${row + 1}`);
      }
    }
    this.selectedCellAddresses = addresses;
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

  private emitSelectedCell(cell: XlsxPreviewRenderedCell, cellElement: HTMLElement | null): void {
    const computedStyle = cellElement ? window.getComputedStyle(cellElement) : null;
    this.cellSelected.emit({
      address: cell.address,
      value: cell.text,
      formula: cell.formula,
      row: cell.row,
      col: cell.col,
      cellClassName: cell.className,
      cellInlineStyle: cell.inlineStyle,
      computedBackgroundColor: computedStyle?.backgroundColor ?? '',
      computedColor: computedStyle?.color ?? '',
      computedTextAlign: computedStyle?.textAlign ?? '',
      computedFontWeight: computedStyle?.fontWeight ?? '',
    });
  }

  private clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(maxValue, Math.max(minValue, value));
  }
}
