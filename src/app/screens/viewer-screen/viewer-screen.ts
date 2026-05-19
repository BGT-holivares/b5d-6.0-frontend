import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { NgStyle } from '@angular/common';
import { Toolbar } from '../../models/toolbar/toolbar';
import { TreePanel } from '../../models/tree-panel/tree-panel';
import { PropertiesPanel } from '../../models/properties-panel/properties-panel';
import { LinkingPanel } from '../../models/linking-panel/linking-panel';
import { ModelVisibilityPanel } from '../../models/model-visibility-panel/model-visibility-panel';
import { BoqPanel } from '../../models/boq-panel/boq-panel';
import { ParametersPanel } from '../../models/parameters-panel/parameters-panel';
import { CuantificadorB5D } from '../../utils/b5d-quantification';
import { VisorIfc } from '../../utils/ifc-viewer';
import type { FloatingPanelId } from '../../types/floating-panel';
import type { NodoCuantificacion } from '../../types/quantity-take-off';

type DockSide = 'left' | 'right' | 'bottom';
type BottomPanelTab = 'links' | 'boq' | 'parameters';

type FloatingPanelState = {
  visible: boolean;
  docked: boolean;
  dockSide: DockSide;
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex: number;
};

@Component({
  selector: 'app-viewer-screen',
  imports: [
    NgStyle,
    Toolbar,
    TreePanel,
    PropertiesPanel,
    LinkingPanel,
    ModelVisibilityPanel,
    BoqPanel,
    ParametersPanel,
  ],
  templateUrl: './viewer-screen.html',
  styleUrl: './viewer-screen.scss',
})
export class ViewerScreen implements AfterViewInit, OnDestroy {
  @ViewChild('contenedorVisor', { static: true }) private readonly contenedorVisor?: ElementRef<HTMLElement>;

  readonly visorIfc = inject(VisorIfc);
  readonly cuantificacion = signal<NodoCuantificacion | null>(null);
  readonly floatingPanels = signal<Record<FloatingPanelId, FloatingPanelState>>({
    tree: {
      visible: true,
      docked: true,
      dockSide: 'right',
      left: 8,
      top: 126,
      width: 360,
      height: 330,
      zIndex: 31,
    },
    models: {
      visible: true,
      docked: true,
      dockSide: 'left',
      left: 16,
      top: 126,
      width: 280,
      height: 240,
      zIndex: 32,
    },
    properties: {
      visible: true,
      docked: true,
      dockSide: 'right',
      left: 860,
      top: 466,
      width: 420,
      height: 300,
      zIndex: 33,
    },
    bottom: {
      visible: true,
      docked: true,
      dockSide: 'bottom',
      left: 12,
      top: 320,
      width: 900,
      height: 280,
      zIndex: 34,
    },
  });
  readonly floatingPanelVisibility = computed<Record<FloatingPanelId, boolean>>(() => {
    const panels = this.floatingPanels();

    return {
      tree: panels.tree.visible,
      models: panels.models.visible,
      properties: panels.properties.visible,
      bottom: panels.bottom.visible,
    };
  });
  readonly toolbarVisible = signal(true);
  readonly bottomPanelTab = signal<BottomPanelTab>('links');
  readonly bottomPanelTabs: { id: BottomPanelTab; label: string }[] = [
    { id: 'links', label: 'Links' },
    { id: 'boq', label: 'Bill of quantities' },
    { id: 'parameters', label: 'Parameters' },
  ];
  private readonly cuantificadorB5D = new CuantificadorB5D();
  private nextFloatingPanelZIndex = 40;

  async ngAfterViewInit(): Promise<void> {
    if (!this.contenedorVisor?.nativeElement) return;
    await this.visorIfc.inicializarVisor(this.contenedorVisor.nativeElement);
  }

  ngOnDestroy(): void {
    this.visorIfc.destruirVisor();
  }

  async cargarArchivo(archivo: File): Promise<void> {
    this.cuantificacion.set(null);
    await this.visorIfc.cargarArchivoIfc(archivo);
  }

  cuantificarB5D(): void {
    const elementos = this.visorIfc.obtenerElementosB5D();

    if (!elementos.length) {
      window.alert('Primero carga un archivo IFC.');
      return;
    }

    const filas = this.cuantificadorB5D.cuantificar(elementos);
    this.cuantificacion.set(this.cuantificadorB5D.construirArbolPanel(filas));
  }

  // Returns whether a floating panel is currently enabled by the user.
  isFloatingPanelVisible(panelId: FloatingPanelId): boolean {
    return this.floatingPanels()[panelId].visible;
  }

  // Returns whether the panel is pinned to its dock side.
  isFloatingPanelDocked(panelId: FloatingPanelId): boolean {
    return this.floatingPanels()[panelId].docked;
  }

  // Builds the fixed or floating style for a panel from its current state.
  getFloatingPanelStyles(panelId: FloatingPanelId): Record<string, string | number> {
    const panel = this.floatingPanels()[panelId];

    if (!panel.docked) {
      return {
        left: `${panel.left}px`,
        top: `${panel.top}px`,
        width: `${panel.width}px`,
        height: `${panel.height}px`,
        zIndex: panel.zIndex,
      };
    }

    if (panel.dockSide === 'bottom') {
      return {
        left: '0',
        right: '0',
        bottom: '0',
        width: '100vw',
        height: `${panel.height}px`,
        zIndex: panel.zIndex,
      };
    }

    const top = this.toolbarVisible() ? panel.top : Math.max(8, panel.top - 118);

    return {
      [panel.dockSide]: '0',
      top: `${top}px`,
      width: `${panel.width}px`,
      height: `${panel.height}px`,
      zIndex: panel.zIndex,
    };
  }

  // Shows or hides a floating panel from the View toolbar controls.
  toggleFloatingPanel(panelId: FloatingPanelId): void {
    const isVisible = !this.floatingPanels()[panelId].visible;
    this.updateFloatingPanel(panelId, {
      visible: isVisible,
      zIndex: isVisible ? this.nextFloatingPanelZIndex++ : this.floatingPanels()[panelId].zIndex,
    });
  }

  // Hides the floating panel from its title bar action.
  hideFloatingPanel(panelId: FloatingPanelId): void {
    this.updateFloatingPanel(panelId, { visible: false });
  }

  // Switches a panel between its docked side and a movable floating position.
  toggleFloatingPanelDock(panelId: FloatingPanelId): void {
    const panel = this.floatingPanels()[panelId];

    if (!panel.docked) {
      this.updateFloatingPanel(panelId, { docked: true });
      return;
    }

    const floatingPosition = this.getFloatingPositionFromDock(panel);
    this.updateFloatingPanel(panelId, {
      docked: false,
      left: floatingPosition.left,
      top: floatingPosition.top,
      zIndex: this.nextFloatingPanelZIndex++,
    });
  }

  // Hides the ribbon toolbar to maximize model visibility.
  hideToolbar(): void {
    this.toolbarVisible.set(false);
  }

  // Restores the ribbon toolbar after it has been hidden.
  showToolbar(): void {
    this.toolbarVisible.set(true);
  }

  // Starts moving a floating panel from its title bar.
  startFloatingPanelDrag(event: PointerEvent, panelId: FloatingPanelId): void {
    if (event.button !== 0) return;
    if (this.floatingPanels()[panelId].docked) return;

    const panelElement = (event.currentTarget as HTMLElement).closest<HTMLElement>('.b5d-floating-panel');
    if (!panelElement) return;

    event.preventDefault();
    this.updateFloatingPanel(panelId, { zIndex: this.nextFloatingPanelZIndex++ });

    const panel = this.floatingPanels()[panelId];
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = panel.left;
    const startTop = panel.top;

    const movePanel = (moveEvent: PointerEvent): void => {
      const position = this.constrainFloatingPanelPosition(
        panelElement,
        startLeft + moveEvent.clientX - startX,
        startTop + moveEvent.clientY - startY,
      );

      this.updateFloatingPanel(panelId, position);
    };

    const stopMovingPanel = (): void => {
      window.removeEventListener('pointermove', movePanel);
      window.removeEventListener('pointerup', stopMovingPanel);
    };

    window.addEventListener('pointermove', movePanel);
    window.addEventListener('pointerup', stopMovingPanel, { once: true });
  }

  // Starts resizing a panel from the lower corner handle.
  startFloatingPanelResize(event: PointerEvent, panelId: FloatingPanelId): void {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    const panel = this.floatingPanels()[panelId];
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = panel.width;
    const startHeight = panel.height;

    this.updateFloatingPanel(panelId, { zIndex: this.nextFloatingPanelZIndex++ });

    const resizePanel = (moveEvent: PointerEvent): void => {
      const dimensions = this.getResizedPanelDimensions(
        panel,
        startWidth,
        startHeight,
        moveEvent.clientX - startX,
        moveEvent.clientY - startY,
      );

      this.updateFloatingPanel(panelId, dimensions);
    };

    const stopResizingPanel = (): void => {
      window.removeEventListener('pointermove', resizePanel);
      window.removeEventListener('pointerup', stopResizingPanel);
    };

    window.addEventListener('pointermove', resizePanel);
    window.addEventListener('pointerup', stopResizingPanel, { once: true });
  }

  // Changes the active tab shown inside the bottom docked panel.
  setBottomPanelTab(tab: BottomPanelTab): void {
    this.bottomPanelTab.set(tab);
  }

  // Returns a readable pin action title for the current panel mode.
  getDockActionTitle(panelId: FloatingPanelId): string {
    return this.isFloatingPanelDocked(panelId) ? 'Float panel' : 'Dock panel';
  }

  // Keeps enough of the title bar visible so the panel can always be moved back.
  private constrainFloatingPanelPosition(
    panelElement: HTMLElement,
    left: number,
    top: number,
  ): Pick<FloatingPanelState, 'left' | 'top'> {
    const visibleHandleWidth = 80;
    const titleBarHeight = 34;
    const minimumLeft = -panelElement.offsetWidth + visibleHandleWidth;
    const maximumLeft = window.innerWidth - visibleHandleWidth;
    const maximumTop = window.innerHeight - titleBarHeight;

    return {
      left: Math.min(Math.max(left, minimumLeft), maximumLeft),
      top: Math.min(Math.max(top, 0), maximumTop),
    };
  }

  // Finds a practical floating position when a docked panel is unpinned.
  private getFloatingPositionFromDock(panel: FloatingPanelState): Pick<FloatingPanelState, 'left' | 'top'> {
    const gap = 16;

    if (panel.dockSide === 'right') {
      return {
        left: Math.max(gap, window.innerWidth - panel.width - gap),
        top: this.toolbarVisible() ? 136 : gap,
      };
    }

    if (panel.dockSide === 'bottom') {
      return {
        left: gap,
        top: Math.max(gap, window.innerHeight - panel.height - gap),
      };
    }

    return {
      left: gap,
      top: this.toolbarVisible() ? 136 : gap,
    };
  }

  // Calculates a constrained panel size for floating and docked modes.
  private getResizedPanelDimensions(
    panel: FloatingPanelState,
    startWidth: number,
    startHeight: number,
    deltaX: number,
    deltaY: number,
  ): Pick<FloatingPanelState, 'width' | 'height'> {
    const minWidth = 220;
    const minHeight = 120;
    const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.85));
    const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight * 0.8));
    let width = startWidth + deltaX;
    let height = startHeight + deltaY;

    if (panel.docked && panel.dockSide === 'right') width = startWidth - deltaX;
    if (panel.docked && panel.dockSide === 'bottom') {
      width = startWidth;
      height = startHeight - deltaY;
    }

    return {
      width: Math.min(Math.max(width, minWidth), maxWidth),
      height: Math.min(Math.max(height, minHeight), maxHeight),
    };
  }

  // Updates a single floating panel without changing the rest of the layout.
  private updateFloatingPanel(panelId: FloatingPanelId, changes: Partial<FloatingPanelState>): void {
    this.floatingPanels.update((panels) => ({
      ...panels,
      [panelId]: {
        ...panels[panelId],
        ...changes,
      },
    }));
  }
}
