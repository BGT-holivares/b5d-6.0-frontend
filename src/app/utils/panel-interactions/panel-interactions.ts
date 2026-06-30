export function clampPanelPercent(value: number, minValue = 20, maxValue = 300): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

export function stepPanelPercent(currentValue: number, delta: number, minValue = 20, maxValue = 300): number {
  return clampPanelPercent(currentValue + delta, minValue, maxValue);
}

export function swapPanelOrder<T>(order: readonly [T, T]): [T, T] {
  return [order[1], order[0]];
}

export function startPointerDrag(
  event: PointerEvent,
  onMove: (moveEvent: PointerEvent) => void,
): boolean {
  if (event.button !== 0 || typeof window === 'undefined') return false;

  const dragTarget = event.currentTarget as HTMLElement | null;
  const pointerId = event.pointerId;
  dragTarget?.setPointerCapture?.(pointerId);

  const stopDragging = (): void => {
    dragTarget?.releasePointerCapture?.(pointerId);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
    window.removeEventListener('blur', stopDragging);
  };

  const handlePointerMove = (moveEvent: PointerEvent): void => {
    onMove(moveEvent);
  };

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopDragging, { once: true });
  window.addEventListener('pointercancel', stopDragging, { once: true });
  window.addEventListener('blur', stopDragging, { once: true });

  return true;
}

export function handlePanelZoomWheel(
  event: WheelEvent,
  onZoomIn: () => void,
  onZoomOut: () => void,
  requireCtrlKey = true,
): boolean {
  if (requireCtrlKey && !event.ctrlKey) return false;

  event.preventDefault();
  event.stopPropagation();

  if (event.deltaY < 0) {
    onZoomIn();
  } else {
    onZoomOut();
  }

  return true;
}
