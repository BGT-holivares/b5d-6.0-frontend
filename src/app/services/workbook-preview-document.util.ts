export type BuildWorkbookPreviewDocumentOptions = {
  sheetHtml: string;
  zoomPercent: number;
  interactionScript?: string;
};

export function sanitizeWorkbookPreviewHtml(sheetHtml: string): string {
  if (!sheetHtml.trim()) return '';
  const documentParser = new DOMParser();
  const parsedDocument = documentParser.parseFromString(sheetHtml, 'text/html');

  parsedDocument.querySelectorAll('script, iframe, object, embed, link[rel="import"]').forEach((node) => {
    node.remove();
  });

  parsedDocument.querySelectorAll('*').forEach((element) => {
    for (const attributeName of element.getAttributeNames()) {
      const attributeValue = element.getAttribute(attributeName) ?? '';
      if (attributeName.toLowerCase().startsWith('on')) {
        element.removeAttribute(attributeName);
        continue;
      }
      if ((attributeName === 'href' || attributeName === 'src') && /^\s*javascript:/i.test(attributeValue)) {
        element.removeAttribute(attributeName);
      }
    }
  });

  return parsedDocument.body.innerHTML;
}

export function buildWorkbookPreviewDocument(options: BuildWorkbookPreviewDocumentOptions): string {
  const sanitizedSheetHtml = sanitizeWorkbookPreviewHtml(options.sheetHtml);
  const zoomFactor = clamp(Number.isFinite(options.zoomPercent) ? options.zoomPercent : 100, 20, 300) / 100;
  const hasScript = !!(options.interactionScript ?? '').trim();
  const csp = hasScript
    ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src data:;"
    : "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src data:;";
  const scriptTag = hasScript ? `\n    <script>${options.interactionScript}</script>` : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #f1f5f9;
      }
      body {
        font-family: Calibri, "Segoe UI", Arial, sans-serif;
        font-size: 11px;
        color: #111827;
      }
      .b5d-workbook-surface {
        width: 100%;
        height: 100vh;
        box-sizing: border-box;
        overflow: auto;
      }
      .excel-grid-shell {
        width: max-content;
        min-width: 100%;
        zoom: ${zoomFactor.toFixed(2)};
      }
      .excel-zoom-layer {
        width: 100%;
        min-height: 100%;
      }
      .excel-grid-table {
        border-collapse: separate;
        border-spacing: 0;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        position: relative;
        z-index: 2;
      }
      .excel-grid-canvas {
        position: relative;
        width: max-content;
        min-width: 100%;
        padding-bottom: 4px;
      }
      .excel-grid-table .row-head-col {
        width: 48px;
        min-width: 48px;
      }
      .excel-grid-table td,
      .excel-grid-table th {
        border: 1px solid #d1d5db;
        min-width: 80px;
        height: 22px;
        padding: 2px 6px;
        line-height: 1.25;
        vertical-align: middle;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        box-sizing: border-box;
      }
      .excel-grid-table td {
        background: #ffffff;
        color: #111827;
      }
      .excel-grid-table td:not([style]):hover {
        background: #f0f9ff;
      }
      .excel-grid-table td:focus,
      .excel-grid-table th:focus {
        outline: 2px solid #2563eb;
        outline-offset: -2px;
      }
      .excel-grid-table .excel-cell--numeric {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .excel-grid-table .excel-cell--boolean {
        text-align: center;
      }
      .excel-grid-table .column-header,
      .excel-grid-table .corner-header {
        position: sticky;
        top: 0;
        z-index: 6;
        background: #e2e8f0;
        font-weight: 700;
        text-align: center;
      }
      .excel-grid-table .row-header,
      .excel-grid-table .corner-header {
        position: sticky;
        left: 0;
        z-index: 5;
        background: #e2e8f0;
        font-weight: 700;
        text-align: center;
        min-width: 48px;
        width: 48px;
        max-width: 48px;
      }
      .excel-grid-table .corner-header {
        z-index: 10;
        position: sticky;
        top: 0;
        left: 0;
      }
      .excel-grid-table .row-header {
        padding: 2px 4px;
      }
      .excel-grid-table .corner-header--select-all {
        position: sticky;
        padding: 0;
      }
      .excel-grid-table .corner-header--select-all::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, #94a3b8 0 50%, transparent 50% 100%);
      }
      .excel-grid-table td.excel-selection,
      .excel-grid-table th.excel-selection {
        box-shadow: inset 0 0 0 1px #2563eb;
      }
      .excel-grid-table td.excel-selection:not([style]),
      .excel-grid-table th.excel-selection {
        background: #dbeafe;
      }
      .excel-grid-table a {
        color: #1d4ed8;
        text-decoration: underline;
      }
      .excel-grid-table tr:nth-child(even) td:not([style]) {
        background: #fcfcfd;
      }
      .excel-floating-image {
        position: absolute;
        z-index: 4;
        object-fit: contain;
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div class="b5d-workbook-surface"><div class="excel-zoom-layer">${sanitizedSheetHtml}</div></div>${scriptTag}
  </body>
</html>`;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}
