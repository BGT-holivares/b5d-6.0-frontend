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
  private columnWidths: number[] = [];

  constructor(private readonly host: ElementRef<HTMLTableElement>) {}

  ngAfterViewInit(): void {
    const table = this.host.nativeElement;
    table.classList.add('b5d-resizable-table');
    this.rebindTableStructure();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['storageKey'] && !changes['storageKey'].firstChange) {
      this.columnWidths = [];
      this.rebindTableStructure();
      return;
    }
    if (changes['b5dResizableRefreshToken'] && !changes['b5dResizableRefreshToken'].firstChange) {
      this.columnWidths = [];
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
    for (const removeListener of this.boundHandleListenerRemovers) removeListener();
    this.boundHandleListenerRemovers.length = 0;
    this.restoreColumnWidths();
    this.bindHeaderHandles();
    this.applyColumnWidths();
  }

  private bindHeaderHandles(): void {
    const headers = this.getHeaderCells();
    headers.forEach((headerCell, index) => {
      const existingHandle = headerCell.querySelector('.b5d-resizable-table__handle');
      if (existingHandle) existingHandle.remove();
      headerCell.classList.add('b5d-resizable-table__header');
      const handle = document.createElement('span');
      handle.className = 'b5d-resizable-table__handle';
      handle.setAttribute('aria-hidden', 'true');
      headerCell.appendChild(handle);

      const onPointerDown = (event: PointerEvent): void => this.startResize(event, index, headerCell);
      handle.addEventListener('pointerdown', onPointerDown);
      this.boundHandleListenerRemovers.push(() => handle.removeEventListener('pointerdown', onPointerDown));
    });
  }

  private startResize(event: PointerEvent, columnIndex: number, headerCell: HTMLElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.clearPointerListeners();

    const initialWidth = this.columnWidths[columnIndex] ?? headerCell.getBoundingClientRect().width;
    const startX = event.clientX;

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startX;
      const width = this.clamp(initialWidth + deltaX, this.b5dResizableMinWidthPx, this.maxWidthPx);
      this.columnWidths[columnIndex] = width;
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
    const table = this.host.nativeElement;
    const colElements = Array.from(table.querySelectorAll<HTMLTableColElement>('colgroup col'));
    const headers = this.getHeaderCells();
    const widthValues = this.columnWidths;

    if (colElements.length) {
      colElements.forEach((colElement, index) => {
        const width = widthValues[index];
        colElement.style.width = typeof width === 'number' && width > 0 ? `${width}px` : '';
      });
      return;
    }

    headers.forEach((headerCell, index) => {
      const width = widthValues[index];
      headerCell.style.width = typeof width === 'number' && width > 0 ? `${width}px` : '';
      headerCell.style.minWidth = `${this.b5dResizableMinWidthPx}px`;
    });
  }

  private getHeaderCells(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll('thead th'));
  }

  private restoreColumnWidths(): void {
    if (!this.storageKey) return;
    try {
      const raw = window.localStorage.getItem(this.buildStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.columnWidths = parsed.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : -1));
    } catch {
      this.columnWidths = [];
    }
  }

  private persistColumnWidths(): void {
    if (!this.storageKey) return;
    try {
      window.localStorage.setItem(this.buildStorageKey(), JSON.stringify(this.columnWidths));
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

  private clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(Math.max(value, minValue), maxValue);
  }
}
