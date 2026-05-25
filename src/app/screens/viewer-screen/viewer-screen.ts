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
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Toolbar, type ToolbarActionId } from '../../models/toolbar/toolbar';
import { TreePanel } from '../../models/tree-panel/tree-panel';
import { PropertiesPanel } from '../../models/properties-panel/properties-panel';
import { LinkingPanel } from '../../models/linking-panel/linking-panel';
import { ModelVisibilityPanel } from '../../models/model-visibility-panel/model-visibility-panel';
import { BoqPanel } from '../../models/boq-panel/boq-panel';
import { ParametersPanel } from '../../models/parameters-panel/parameters-panel';
import { BackendAuthService } from '../../services/backend-auth.service';
import { BackendProyectosService } from '../../services/backend-proyectos.service';
import { CuantificadorB5D } from '../../utils/b5d-quantification';
import { VisorIfc } from '../../utils/ifc-viewer';
import type {
  ConceptoB5DOrm,
  CuantificacionB5DOrm,
  ProyectoTrabajoOrm,
  UsuarioSesionOrm,
  VinculoConceptoBimOrm,
} from '../../types/b5d-orm';
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
  @ViewChild('inputB5d') private readonly inputB5d?: ElementRef<HTMLInputElement>;

  readonly visorIfc = inject(VisorIfc);
  readonly backendAuth = inject(BackendAuthService);
  readonly backendProyectos = inject(BackendProyectosService);
  readonly cuantificacion = signal<NodoCuantificacion | null>(null);
  readonly proyectoB5dActivo = signal<ProyectoTrabajoOrm | null>(null);
  readonly conceptosB5d = signal<ConceptoB5DOrm[]>([]);
  readonly vinculosB5d = signal<VinculoConceptoBimOrm[]>([]);
  readonly cuantificacionesB5d = signal<CuantificacionB5DOrm[]>([]);
  readonly b5dCargando = signal(false);
  readonly b5dMensaje = signal('');
  readonly usuarioSesion = signal<UsuarioSesionOrm | null>(null);
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
  readonly toolbarContentVisible = signal(true);
  readonly bottomPanelTab = signal<BottomPanelTab>('links');
  readonly bottomPanelTabs: { id: BottomPanelTab; label: string }[] = [
    { id: 'links', label: 'Estructura de conceptos' },
    { id: 'boq', label: 'Cuantificaciones' },
    { id: 'parameters', label: 'Parameters' },
  ];
  private readonly cuantificadorB5D = new CuantificadorB5D();
  private readonly router = inject(Router);
  private nextFloatingPanelZIndex = 40;

  async ngAfterViewInit(): Promise<void> {
    if (!this.contenedorVisor?.nativeElement) return;
    await this.visorIfc.inicializarVisor(this.contenedorVisor.nativeElement);
    await this.inicializarPanelesB5d();
  }

  ngOnDestroy(): void {
    this.visorIfc.destruirVisor();
  }

  async cargarArchivo(archivo: File): Promise<void> {
    this.cuantificacion.set(null);
    await this.visorIfc.cargarArchivoIfc(archivo);
    await this.actualizarReferenciaIfc(archivo);
  }

  async abrirSelectorImportacionB5d(): Promise<void> {
    if (!(await this.asegurarSesionBackend())) return;
    this.inputB5d?.nativeElement.click();
  }

  async procesarArchivoB5dSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;

    await this.importarProyectoB5d(archivo);
  }

  async irALogin(): Promise<void> {
    if (this.usuarioSesion()) {
      try {
        await firstValueFrom(this.backendAuth.logout());
      } catch {
        // Ignora error de logout y continua con redireccion.
      }
      this.usuarioSesion.set(null);
    }
    await this.router.navigate(['/login']);
  }

  async cerrarSesionBackend(): Promise<void> {
    try {
      await firstValueFrom(this.backendAuth.logout());
    } finally {
      this.usuarioSesion.set(null);
      this.proyectoB5dActivo.set(null);
      this.conceptosB5d.set([]);
      this.vinculosB5d.set([]);
      this.cuantificacionesB5d.set([]);
      this.b5dMensaje.set('Sesion cerrada.');
      await this.router.navigate(['/login']);
    }
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

  private async inicializarPanelesB5d(): Promise<void> {
    if (!(await this.asegurarSesionBackend())) {
      await this.router.navigate(['/login']);
      return;
    }
    await this.cargarProyectoReciente();
  }

  private async asegurarSesionBackend(): Promise<boolean> {
    try {
      const sesion = await firstValueFrom(this.backendAuth.me());
      if (!sesion.authenticated || !sesion.user) {
        this.usuarioSesion.set(null);
        this.b5dMensaje.set('Sesion no iniciada.');
        return false;
      }
      this.usuarioSesion.set(sesion.user);
      return true;
    } catch (error) {
      this.usuarioSesion.set(null);
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No fue posible validar la sesion backend.'));
      return false;
    }
  }

  private async cargarProyectoReciente(): Promise<void> {
    this.b5dCargando.set(true);
    this.b5dMensaje.set('');
    try {
      const proyectos = await firstValueFrom(this.backendProyectos.listarProyectos());
      const proyecto = proyectos.resultados[0] ?? null;
      this.proyectoB5dActivo.set(proyecto);
      if (!proyecto) {
        this.conceptosB5d.set([]);
        this.vinculosB5d.set([]);
        this.cuantificacionesB5d.set([]);
        this.b5dMensaje.set('No hay proyectos importados. Usa "Importar de base de datos B5D".');
        return;
      }

      await this.cargarDatosProyectoB5d(proyecto.id);
    } catch (error) {
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo consultar la lista de proyectos B5D.'));
    } finally {
      this.b5dCargando.set(false);
    }
  }

  private async importarProyectoB5d(archivo: File): Promise<void> {
    this.b5dCargando.set(true);
    this.b5dMensaje.set('');
    try {
      const proyecto = await firstValueFrom(
        this.backendProyectos.importarProyecto({
          archivo,
          nombre: archivo.name,
          sincrono: true,
        }),
      );
      this.proyectoB5dActivo.set(proyecto);
      await this.cargarDatosProyectoB5d(proyecto.id);
      this.b5dMensaje.set(`Proyecto importado: ${proyecto.nombre} (ID ${proyecto.id}).`);
    } catch (error) {
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo importar el archivo B5D.'));
    } finally {
      this.b5dCargando.set(false);
    }
  }

  private async exportarProyectoB5dActivo(): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay proyecto B5D activo para exportar.');
      return;
    }

    this.b5dCargando.set(true);
    this.b5dMensaje.set('');
    try {
      const exportado = await firstValueFrom(this.backendProyectos.exportarProyecto(proyecto.id, true));
      this.proyectoB5dActivo.set(exportado);
      await this.cargarDatosProyectoB5d(exportado.id);
      const blob = await firstValueFrom(this.backendProyectos.descargarProyecto(exportado.id));
      this.descargarBlob(blob, `proyecto-${exportado.id}.b5d`);
      this.b5dMensaje.set(`Proyecto exportado correctamente (ID ${exportado.id}).`);
    } catch (error) {
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo exportar el proyecto B5D.'));
    } finally {
      this.b5dCargando.set(false);
    }
  }

  private async cargarDatosProyectoB5d(proyectoId: number): Promise<void> {
    const [estado, conceptos, vinculos, cuantificaciones] = await Promise.all([
      firstValueFrom(this.backendProyectos.consultarEstadoProyecto(proyectoId)),
      firstValueFrom(this.backendProyectos.listarConceptos(proyectoId)),
      firstValueFrom(this.backendProyectos.listarVinculosBim(proyectoId)),
      firstValueFrom(this.backendProyectos.listarCuantificaciones(proyectoId)),
    ]);

    this.proyectoB5dActivo.set(estado);
    this.conceptosB5d.set(conceptos.resultados);
    this.vinculosB5d.set(vinculos.resultados);
    this.cuantificacionesB5d.set(cuantificaciones.resultados);
  }

  private async actualizarReferenciaIfc(archivo: File): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) return;
    try {
      const actualizado = await firstValueFrom(
        this.backendProyectos.actualizarIfcMetadata(proyecto.id, {
          ifc_nombre_archivo: archivo.name,
          ifc_tamano_bytes: archivo.size,
        }),
      );
      this.proyectoB5dActivo.set(actualizado);
    } catch {
      // No bloquea el flujo de carga IFC si la metadata falla.
    }
  }

  private descargarBlob(blob: Blob, nombreArchivo: string): void {
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivo;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  private obtenerMensajeError(error: unknown, mensajePredeterminado: string): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const errorHttp = error as { error?: { error?: string } };
      const mensaje = errorHttp.error?.error;
      if (typeof mensaje === 'string' && mensaje.trim()) {
        return mensaje;
      }
    }
    return mensajePredeterminado;
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

    const top = this.toolbarContentVisible() ? panel.top : Math.max(34, panel.top - 86);

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

  // Applies toolbar actions emitted by toolbar-owned button declarations.
  handleToolbarAction(action: ToolbarActionId): void {
    const actionMap: Record<ToolbarActionId, () => void> = {
      'import-b5d-project': () => {
        void this.abrirSelectorImportacionB5d();
      },
      'export-b5d-project': () => {
        void this.asegurarSesionBackend().then((autenticado) => {
          if (!autenticado) {
            void this.irALogin();
            return;
          }
          void this.exportarProyectoB5dActivo();
        });
      },
      'refresh-b5d-project': () => {
        void this.asegurarSesionBackend().then((autenticado) => {
          if (!autenticado) {
            void this.irALogin();
            return;
          }
          void this.cargarProyectoReciente();
        });
      },
      'zoom-in': () => this.visorIfc.acercar(),
      'zoom-out': () => this.visorIfc.alejar(),
      'reset-view': () => this.visorIfc.restablecerVista(),
      'rotate-left': () => this.visorIfc.rotarIzquierda(),
      'rotate-right': () => this.visorIfc.rotarDerecha(),
      'clear-selection': () => this.visorIfc.limpiarSeleccion(),
      'expand-tree': () => this.visorIfc.expandirArbolCompleto(),
      'collapse-tree': () => this.visorIfc.colapsarArbolCompleto(),
      'quantify-b5d': () => this.cuantificarB5D(),
      'toggle-theme': () => undefined,
      'show-all-objects': () => this.visorIfc.showAllModelElements(),
      'show-selected-objects': () => this.visorIfc.showSelectedElements(),
      'transparent-selected-objects': () => this.visorIfc.makeSelectedElementsTransparent(),
      'hide-selected-objects': () => this.visorIfc.hideSelectedElements(),
      'show-not-selected-objects': () => this.visorIfc.showNotSelectedElements(),
      'transparent-not-selected-objects': () => this.visorIfc.makeNotSelectedElementsTransparent(),
      'hide-not-selected-objects': () => this.visorIfc.hideNotSelectedElements(),
      'view-3d': () => this.visorIfc.set3DView(),
      'view-2d': () => this.visorIfc.set2DView(),
      'focus-selection': () => this.visorIfc.focusSelectedElements(),
      'view-default': () => this.visorIfc.setDefaultModelView(),
      'view-front': () => this.visorIfc.setFrontModelView(),
      'view-back': () => this.visorIfc.setBackModelView(),
      'view-up': () => this.visorIfc.setTopModelView(),
      'view-right': () => this.visorIfc.setRightModelView(),
      'view-left': () => this.visorIfc.setLeftModelView(),
      'movement-axis-x': () => this.visorIfc.setMovementAxis('x'),
      'movement-axis-y': () => this.visorIfc.setMovementAxis('y'),
      'movement-axis-z': () => this.visorIfc.setMovementAxis('z'),
      'restore-selected-movement': () => this.visorIfc.restoreSelectedElementMovements(),
      'restore-all-movement': () => this.visorIfc.restoreAllElementMovements(),
    };

    actionMap[action]();
  }

  // Stores whether the toolbar command content is visible.
  setToolbarContentVisible(isVisible: boolean): void {
    this.toolbarContentVisible.set(isVisible);
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
        top: this.toolbarContentVisible() ? 136 : 42,
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
      top: this.toolbarContentVisible() ? 136 : 42,
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
