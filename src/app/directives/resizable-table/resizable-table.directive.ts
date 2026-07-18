import { AfterViewInit, Directive, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';

@Directive({
  selector: 'table[b5dResizableTable]',
  standalone: true,
})
export class ResizableTableDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input('b5dResizableTable') storageKey = '';
  @Input() b5dResizableMinWidthPx = 90;
  @Input() b5dResizableRefreshToken = 0;

  private readonly maxWidthPx = 2400;
  private readonly boundHandleListenerRemovers: Array<() => void> = [];
  private readonly pointerCleanup: Array<() => void> = [];
  private columnWidthsByKey = new Map<string, number>();

  constructor(private readonly host: ElementRef<HTMLTableElement>) {}

  ngAfterViewInit(): void {
    if (typeof document === 'undefined') return;
    const table = this.host.nativeElement;
    table.classList.add('b5d-resizable-table');
    this.rebindTableStructure();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['storageKey'] && !changes['storageKey'].firstChange) {
      this.columnWidthsByKey = new Map();
      this.rebindTableStructure();
      return;
    }
    if (changes['b5dResizableRefreshToken'] && !changes['b5dResizableRefreshToken'].firstChange) {
      this.rebindTableStructure();
      return;
    }
    this.rebindTableStructure();
  }

  ngOnDestroy(): void {
    for (const removeListener of this.boundHandleListenerRemovers) removeListener();
    this.boundHandleListenerRemovers.length = 0;
    this.clearPointerListeners();
  }

  private rebindTableStructure(): void {
    if (typeof document === 'undefined') return;
    for (const removeListener of this.boundHandleListenerRemovers) removeListener();
    this.boundHandleListenerRemovers.length = 0;
    this.restoreColumnWidths();
    this.bindHeaderHandles();
    this.applyColumnWidths();
  }

  private bindHeaderHandles(): void {
    const headers = this.getHeaderCells();
    headers.forEach((headerCell) => {
      const existingHandle = headerCell.querySelector('.b5d-resizable-table__handle');
      if (existingHandle) existingHandle.remove();
      headerCell.classList.add('b5d-resizable-table__header');
      const handle = document.createElement('span');
      handle.className = 'b5d-resizable-table__handle';
      handle.setAttribute('aria-hidden', 'true');
      headerCell.appendChild(handle);

      const onPointerDown = (event: PointerEvent): void => {
        const columnKey = this.getColumnKey(headerCell);
        if (!columnKey) return;
        this.startResize(event, columnKey, headerCell);
      };
      handle.addEventListener('pointerdown', onPointerDown);
      this.boundHandleListenerRemovers.push(() => handle.removeEventListener('pointerdown', onPointerDown));
    });
  }

  private startResize(event: PointerEvent, columnKey: string, headerCell: HTMLElement): void {
    if (typeof window === 'undefined') return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.clearPointerListeners();

    const initialWidth = this.columnWidthsByKey.get(columnKey) ?? headerCell.getBoundingClientRect().width;
    const startX = event.clientX;

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startX;
      const width = this.clamp(initialWidth + deltaX, this.b5dResizableMinWidthPx, this.maxWidthPx);
      this.columnWidthsByKey.set(columnKey, width);
      this.applyColumnWidths();
    };
    const onPointerUp = (): void => {
      this.persistColumnWidths();
      this.clearPointerListeners();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    this.pointerCleanup.push(() => window.removeEventListener('pointermove', onPointerMove));
    this.pointerCleanup.push(() => window.removeEventListener('pointerup', onPointerUp));
  }

  private applyColumnWidths(): void {
    const headers = this.getHeaderCells();
    headers.forEach((headerCell) => {
      const columnKey = this.getColumnKey(headerCell);
      if (!columnKey) return;
      const width = this.columnWidthsByKey.get(columnKey);
      headerCell.style.width = typeof width === 'number' && width > 0 ? `${width}px` : '';
      headerCell.style.minWidth = `${this.b5dResizableMinWidthPx}px`;
    });
  }

  private getHeaderCells(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll('thead th[data-b5d-column-key]'));
  }

  private restoreColumnWidths(): void {
    if (typeof window === 'undefined') return;
    if (!this.storageKey) return;
    this.columnWidthsByKey = new Map();
    try {
      const raw = window.localStorage.getItem(this.buildStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      for (const [columnKey, width] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
          this.columnWidthsByKey.set(columnKey, width);
        }
      }
    } catch {
      this.columnWidthsByKey = new Map();
    }
  }

  private persistColumnWidths(): void {
    if (typeof window === 'undefined') return;
    if (!this.storageKey) return;
    try {
      window.localStorage.setItem(this.buildStorageKey(), JSON.stringify(Object.fromEntries(this.columnWidthsByKey.entries())));
    } catch {
      // Ignore storage errors (private mode, quota exceeded, or unavailable storage).
    }
  }

  private clearPointerListeners(): void {
    for (const removeListener of this.pointerCleanup) removeListener();
    this.pointerCleanup.length = 0;
  }

  private buildStorageKey(): string {
    return `b5d-resizable-table:${this.storageKey}`;
  }

  private getColumnKey(headerCell: HTMLElement): string {
    return headerCell.getAttribute('data-b5d-column-key')?.trim() ?? '';
  }

  private clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(Math.max(value, minValue), maxValue);
  }
}
