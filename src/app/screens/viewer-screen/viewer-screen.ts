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
import { Toolbar } from '../../models/toolbar/toolbar';
import { TreePanel } from '../../models/tree-panel/tree-panel';
import { PropertiesPanel } from '../../models/properties-panel/properties-panel';
import { QuantificationPanel } from '../../models/quantification-panel/quantification-panel';
import { LinkingPanel } from '../../models/linking-panel/linking-panel';
import { ModelVisibilityPanel } from '../../models/model-visibility-panel/model-visibility-panel';
import { CuantificadorB5D } from '../../utils/b5d-quantification';
import { VisorIfc } from '../../utils/ifc-viewer';
import type { FloatingPanelId } from '../../types/floating-panel';
import type { NodoCuantificacion } from '../../types/quantity-take-off';

type FloatingPanelState = {
  visible: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex: number;
};

@Component({
  selector: 'app-viewer-screen',
  imports: [
    Toolbar,
    TreePanel,
    PropertiesPanel,
    QuantificationPanel,
    LinkingPanel,
    ModelVisibilityPanel,
  ],
  templateUrl: './viewer-screen.html',
  styleUrl: './viewer-screen.scss',
})
export class ViewerScreen implements AfterViewInit, OnDestroy {
  @ViewChild('contenedorVisor', { static: true }) private readonly contenedorVisor?: ElementRef<HTMLElement>;

  readonly visorIfc = inject(VisorIfc);
  readonly cuantificacion = signal<NodoCuantificacion | null>(null);
  readonly floatingPanels = signal<Record<FloatingPanelId, FloatingPanelState>>({
    tree: { visible: true, left: 8, top: 135, width: 610, height: 420, zIndex: 31 },
    quantification: { visible: true, left: 12, top: 90, width: 300, height: 260, zIndex: 32 },
    linking: { visible: true, left: 12, top: 320, width: 900, height: 420, zIndex: 33 },
    models: { visible: true, left: 16, top: 520, width: 280, height: 240, zIndex: 34 },
    properties: { visible: true, left: 860, top: 12, width: 420, height: 580, zIndex: 35 },
  });
  readonly floatingPanelVisibility = computed<Record<FloatingPanelId, boolean>>(() => {
    const panels = this.floatingPanels();

    return {
      tree: panels.tree.visible,
      quantification: panels.quantification.visible,
      linking: panels.linking.visible,
      models: panels.models.visible,
      properties: panels.properties.visible,
    };
  });
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

  // Starts moving a floating panel from its title bar.
  startFloatingPanelDrag(event: PointerEvent, panelId: FloatingPanelId): void {
    if (event.button !== 0) return;

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
