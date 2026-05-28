import {
  AfterViewInit,
  ChangeDetectorRef,
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
  CatalogoB5DOrm,
  ConceptoB5DOrm,
  CuantificacionB5DOrm,
  SaveB5DProyectPayloadOrm,
  ProyectoTrabajoOrm,
  UsuarioSesionOrm,
  VinculoConceptoBimOrm,
} from '../../types/b5d-orm';
import type { HomeToolbarState, SelectFilterMode, UnlinkedObjectsMode } from '../../types/home-toolbar';
import type { FloatingPanelId } from '../../types/floating-panel';
import type { ElementoIfcB5D, NodoCuantificacion } from '../../types/quantity-take-off';

type DockSide = 'left' | 'right' | 'bottom';
type BottomPanelTab = 'links' | 'boq' | 'parameters';
type ResizeHandle =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left';

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
  @ViewChild(LinkingPanel) private readonly linkingPanel?: LinkingPanel;
  private readonly defaultDockedTopWithToolbar = 114;
  private readonly defaultDockedTopWithoutToolbar = 34;
  private readonly defaultTreeDockedWidth = 360;
  private readonly defaultBottomDockedHeight = 280;

  readonly visorIfc = inject(VisorIfc);
  readonly backendAuth = inject(BackendAuthService);
  readonly backendProyectos = inject(BackendProyectosService);
  readonly cuantificacion = signal<NodoCuantificacion | null>(null);
  readonly ifcElements = signal<ElementoIfcB5D[]>([]);
  readonly proyectoB5dActivo = signal<ProyectoTrabajoOrm | null>(null);
  readonly b5dConcepts = signal<ConceptoB5DOrm[]>([]);
  readonly b5dLinks = signal<VinculoConceptoBimOrm[]>([]);
  readonly b5dCatalogs = signal<CatalogoB5DOrm[]>([]);
  readonly cuantificacionesB5d = signal<CuantificacionB5DOrm[]>([]);
  readonly b5dCargando = signal(false);
  readonly b5dMensaje = signal('');
  readonly usuarioSesion = signal<UsuarioSesionOrm | null>(null);
  readonly homeToolbarState = signal<HomeToolbarState>({
    activePanel: 'concepts',
    linksViewVisible: true,
    conceptsTotal: 0,
    objectsTotal: 0,
    linksTotal: 0,
    selectedConceptIds: [],
    selectedNonGroupingConceptIds: [],
    selectedObjectIds: [],
    selectedLinkIds: [],
    canPasteConcept: false,
  });
  readonly floatingPanels = signal<Record<FloatingPanelId, FloatingPanelState>>({
    tree: {
      visible: true,
      docked: true,
      dockSide: 'right',
      left: 8,
      top: 114,
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
      properties: panels.tree.visible,
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
  treeSectionHeight = 220;
  private readonly cuantificadorB5D = new CuantificadorB5D();
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private nextFloatingPanelZIndex = 40;
  private autoSaveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private autoSaveInProgress = false;
  private hasPendingDraftChanges = false;

  async ngAfterViewInit(): Promise<void> {
    if (!this.contenedorVisor?.nativeElement) return;
    await this.visorIfc.inicializarVisor(this.contenedorVisor.nativeElement);
    await this.inicializarPanelesB5d();
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimeoutId) {
      clearTimeout(this.autoSaveTimeoutId);
      this.autoSaveTimeoutId = null;
    }
    this.visorIfc.destruirVisor();
  }

  async cargarArchivo(archivo: File): Promise<void> {
    this.cuantificacion.set(null);
    this.ifcElements.set([]);
    await this.visorIfc.cargarArchivoIfc(archivo);
    this.ifcElements.set(this.visorIfc.obtenerElementosB5D());
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
      this.b5dConcepts.set([]);
      this.b5dLinks.set([]);
      this.b5dCatalogs.set([]);
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
        this.b5dConcepts.set([]);
        this.b5dLinks.set([]);
        this.b5dCatalogs.set([]);
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

  // Exports a new B5D file using the latest draft already persisted in the backend.
  async guardarYExportarProyectoB5dActivo(): Promise<void> {
    if (!(await this.asegurarSesionBackend())) {
      await this.irALogin();
      return;
    }

    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay proyecto B5D activo para exportar.');
      return;
    }

    this.b5dCargando.set(true);
    this.b5dMensaje.set('');
    try {
      await this.flushPendingAutoSave(proyecto.id);

      const proyectoExportado = await firstValueFrom(this.backendProyectos.exportarProyecto(proyecto.id, true));
      this.proyectoB5dActivo.set(proyectoExportado);
      await this.cargarDatosProyectoB5d(proyectoExportado.id);

      const archivoExportado = await firstValueFrom(this.backendProyectos.descargarProyecto(proyectoExportado.id));
      this.descargarBlob(archivoExportado, `proyecto-${proyectoExportado.id}.b5d`);
      this.b5dMensaje.set(`Proyecto exportado correctamente (ID ${proyectoExportado.id}).`);
    } catch (error) {
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo exportar el proyecto B5D.'));
    } finally {
      this.b5dCargando.set(false);
    }
  }

  // Persists the current linking workspace draft in the backend project tables.
  private async persistirCambiosB5dEnServidor(proyectoId: number): Promise<void> {
    if (this.bottomPanelTab() !== 'links') {
      this.setBottomPanelTab('links');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const linkingWorkspace = this.linkingPanel;
    const draftPayload: SaveB5DProyectPayloadOrm = linkingWorkspace
      ? linkingWorkspace.getProjectDraft()
      : {
          catalogo_activo_id: this.b5dCatalogs()[0]?.id ?? null,
          conceptos: this.b5dConcepts().map((conceptItem) => ({
            id: conceptItem.id,
            catalogo_id: conceptItem.catalogo_id ?? null,
            clave: conceptItem.clave ?? null,
            clave_secundaria: conceptItem.clave_secundaria ?? null,
            descripcion: conceptItem.descripcion ?? null,
            es_agrupador: !!conceptItem.es_agrupador,
            agrupador_padre_id: conceptItem.agrupador_padre_id ?? null,
            unidad: conceptItem.unidad ?? null,
            orden: conceptItem.orden ?? null,
            optimistic_lock_field: conceptItem.optimistic_lock_field ?? null,
            gc_record: conceptItem.gc_record ?? null,
          })),
          vinculos: this.b5dLinks().map((linkItem) => ({
            id: String(linkItem.id),
            identificador_original: linkItem.identificador_original ?? null,
            concepto_id: linkItem.concepto_id ?? null,
            tipo_objeto_bim: linkItem.tipo_objeto_bim ?? null,
            material_bim: linkItem.material_bim ?? null,
            propiedad_cantidad_bim: linkItem.propiedad_cantidad_bim ?? null,
            factor_conversion: linkItem.factor_conversion ?? 1,
            descripcion: linkItem.descripcion ?? null,
            optimistic_lock_field: linkItem.optimistic_lock_field ?? null,
            gc_record: linkItem.gc_record ?? null,
          })),
        };

    const savedSnapshot = await firstValueFrom(this.backendProyectos.guardarProyecto(proyectoId, draftPayload));
    this.proyectoB5dActivo.set(savedSnapshot.proyecto);
    if (savedSnapshot.catalogos?.resultados) {
      this.b5dCatalogs.set(savedSnapshot.catalogos.resultados);
    }
    this.b5dConcepts.set(savedSnapshot.conceptos.resultados);
    this.b5dLinks.set(savedSnapshot.vinculos.resultados);
  }

  // Debounces autosave operations to avoid excessive backend requests while editing.
  private scheduleAutoSave(): void {
    if (this.autoSaveTimeoutId) clearTimeout(this.autoSaveTimeoutId);
    this.autoSaveTimeoutId = setTimeout(() => {
      this.autoSaveTimeoutId = null;
      void this.executeAutoSave();
    }, 900);
  }

  // Executes autosave for draft changes and retries if new edits arrive during save.
  private async executeAutoSave(): Promise<void> {
    if (this.autoSaveInProgress) return;
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto || !this.hasPendingDraftChanges) return;

    this.autoSaveInProgress = true;
    this.hasPendingDraftChanges = false;
    try {
      await this.persistirCambiosB5dEnServidor(proyecto.id);
    } catch (error) {
      this.hasPendingDraftChanges = true;
      console.warn('No se pudo guardar automaticamente el borrador B5D.', error);
    } finally {
      this.autoSaveInProgress = false;
      if (this.hasPendingDraftChanges) this.scheduleAutoSave();
    }
  }

  // Ensures pending draft changes are persisted before exporting a new B5D file.
  private async flushPendingAutoSave(proyectoId: number): Promise<void> {
    if (this.autoSaveTimeoutId) {
      clearTimeout(this.autoSaveTimeoutId);
      this.autoSaveTimeoutId = null;
    }

    while (this.autoSaveInProgress) {
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
    }

    if (this.hasPendingDraftChanges) {
      this.hasPendingDraftChanges = false;
      await this.persistirCambiosB5dEnServidor(proyectoId);
    }
  }

  private async cargarDatosProyectoB5d(proyectoId: number): Promise<void> {
    const [estado, conceptos, vinculos, catalogos, cuantificaciones] = await Promise.all([
      firstValueFrom(this.backendProyectos.consultarEstadoProyecto(proyectoId)),
      firstValueFrom(this.backendProyectos.listarConceptos(proyectoId)),
      firstValueFrom(this.backendProyectos.listarVinculosBim(proyectoId)),
      firstValueFrom(this.backendProyectos.listarCatalogos(proyectoId)),
      firstValueFrom(this.backendProyectos.listarCuantificaciones(proyectoId)),
    ]);

    this.proyectoB5dActivo.set(estado);
    this.b5dConcepts.set(conceptos.resultados);
    this.b5dLinks.set(vinculos.resultados);
    this.b5dCatalogs.set(catalogos.resultados);
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
      const errorHttp = error as {
        error?: {
          error?: string;
          proyecto?: { mensaje_error?: string | null };
        };
      };
      const mensaje = errorHttp.error?.error;
      if (typeof mensaje === 'string' && mensaje.trim()) {
        return mensaje;
      }
      const mensajeProyecto = errorHttp.error?.proyecto?.mensaje_error;
      if (typeof mensajeProyecto === 'string' && mensajeProyecto.trim()) {
        return mensajeProyecto;
      }
    }
    return mensajePredeterminado;
  }

  // Returns whether a floating panel is currently enabled by the user.
  isFloatingPanelVisible(panelId: FloatingPanelId): boolean {
    return this.floatingPanels()[this.resolvePanelId(panelId)].visible;
  }

  // Returns whether the panel is pinned to its dock side.
  isFloatingPanelDocked(panelId: FloatingPanelId): boolean {
    return this.floatingPanels()[this.resolvePanelId(panelId)].docked;
  }

  // Builds the fixed or floating style for a panel from its current state.
  getFloatingPanelStyles(panelId: FloatingPanelId): Record<string, string | number> {
    const resolvedPanelId = this.resolvePanelId(panelId);
    const panel = this.floatingPanels()[resolvedPanelId];

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

    const top = this.getDockedPanelTop();
    const height =
      resolvedPanelId === 'tree' ? `${Math.max(140, window.innerHeight - top)}px` : `${panel.height}px`;

    return {
      [panel.dockSide]: '0',
      top: `${top}px`,
      width: `${panel.width}px`,
      height,
      zIndex: panel.zIndex,
    };
  }

  // Shows or hides a floating panel from the View toolbar controls.
  toggleFloatingPanel(panelId: FloatingPanelId): void {
    const panelKey = this.resolvePanelId(panelId);
    const isVisible = !this.floatingPanels()[panelKey].visible;
    this.updateFloatingPanel(panelKey, {
      visible: isVisible,
      zIndex: isVisible ? this.nextFloatingPanelZIndex++ : this.floatingPanels()[panelKey].zIndex,
    });
  }

  // Hides the floating panel from its title bar action.
  hideFloatingPanel(panelId: FloatingPanelId): void {
    this.updateFloatingPanel(this.resolvePanelId(panelId), { visible: false });
  }

  // Switches a panel between its docked side and a movable floating position.
  toggleFloatingPanelDock(panelId: FloatingPanelId): void {
    const resolvedPanelId = this.resolvePanelId(panelId);
    const panel = this.floatingPanels()[resolvedPanelId];

    if (!panel.docked) {
      this.resetDockedPanel(resolvedPanelId);
      return;
    }

    const floatingPosition = this.getFloatingPositionFromDock(panel);
    this.updateFloatingPanel(resolvedPanelId, {
      docked: false,
      left: floatingPosition.left,
      top: floatingPosition.top,
      zIndex: this.nextFloatingPanelZIndex++,
    });
  }

  // Applies toolbar actions emitted by toolbar-owned button declarations.
  handleToolbarAction(action: ToolbarActionId): void {
    if (this.isHomeToolbarAction(action)) {
      this.handleHomeToolbarAction(action);
      return;
    }

    const actionMap: Partial<Record<ToolbarActionId, () => void>> = {
      'import-b5d-project': () => {
        void this.abrirSelectorImportacionB5d();
      },
      'export-b5d-project': () => {
        void this.asegurarSesionBackend().then((autenticado) => {
          if (!autenticado) {
            void this.irALogin();
            return;
          }
          void this.guardarYExportarProyectoB5dActivo();
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

    actionMap[action]?.();
  }

  // Stores linking panel state used to toggle Home toolbar actions.
  onLinkingToolbarStateChange(state: HomeToolbarState): void {
    this.homeToolbarState.set(state);
  }

  // Mirrors IFC object-table selection into the 3D model selection.
  onLinkingIfcSelectionChange(localIds: number[]): void {
    void this.visorIfc.seleccionarElementosPorLocalIds(localIds);
  }

  // Schedules draft autosave when the linking workspace mutates concepts or links.
  onLinkingDraftChanged(): void {
    this.hasPendingDraftChanges = true;
    this.scheduleAutoSave();
  }

  // Stores whether the toolbar command content is visible.
  setToolbarContentVisible(isVisible: boolean): void {
    this.toolbarContentVisible.set(isVisible);
  }

  // Starts moving a floating panel from its title bar.
  startFloatingPanelDrag(event: PointerEvent, panelId: FloatingPanelId): void {
    const resolvedPanelId = this.resolvePanelId(panelId);
    if (event.button !== 0) return;
    if (this.floatingPanels()[resolvedPanelId].docked) return;

    const panelElement = (event.currentTarget as HTMLElement).closest<HTMLElement>('.b5d-floating-panel');
    if (!panelElement) return;

    event.preventDefault();
    this.updateFloatingPanel(resolvedPanelId, { zIndex: this.nextFloatingPanelZIndex++ });

    const panel = this.floatingPanels()[resolvedPanelId];
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

      this.updateFloatingPanel(resolvedPanelId, position);
    };

    this.registerPointerDrag(movePanel);
  }

  // Starts resizing a panel from the selected border or corner handle.
  startFloatingPanelResize(
    event: PointerEvent,
    panelId: FloatingPanelId,
    handle: ResizeHandle = 'bottom-right',
  ): void {
    const resolvedPanelId = this.resolvePanelId(panelId);
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    const initialPanel = this.floatingPanels()[resolvedPanelId];
    if (!this.canResizeFromHandle(initialPanel, handle)) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = initialPanel.width;
    const startHeight = initialPanel.height;
    const startLeft = initialPanel.left;
    const startTop = initialPanel.top;

    this.updateFloatingPanel(resolvedPanelId, { zIndex: this.nextFloatingPanelZIndex++ });

    const resizePanel = (moveEvent: PointerEvent): void => {
      const latestPanel = this.floatingPanels()[resolvedPanelId];
      const dimensions = this.getResizedPanelDimensions(
        latestPanel,
        handle,
        startWidth,
        startHeight,
        startLeft,
        startTop,
        moveEvent.clientX - startX,
        moveEvent.clientY - startY,
      );

      this.updateFloatingPanel(resolvedPanelId, dimensions);
    };

    this.registerPointerDrag(resizePanel);
  }

  // Changes the active tab shown inside the bottom docked panel.
  setBottomPanelTab(tab: BottomPanelTab): void {
    this.bottomPanelTab.set(tab);
  }

  // Returns a readable pin action title for the current panel mode.
  getDockActionTitle(panelId: FloatingPanelId): string {
    return this.isFloatingPanelDocked(panelId) ? 'Float panel' : 'Dock panel';
  }

  // Raises a panel above others to avoid constant hide/show while working.
  bringFloatingPanelToFront(panelId: FloatingPanelId): void {
    const resolvedPanelId = this.resolvePanelId(panelId);
    const panel = this.floatingPanels()[resolvedPanelId];
    if (panel.zIndex >= this.nextFloatingPanelZIndex - 1) return;
    this.updateFloatingPanel(resolvedPanelId, { zIndex: this.nextFloatingPanelZIndex++ });
  }

  // Resizes the split between IFC tree and properties in the unified panel.
  startTreePropertiesResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const panel = this.floatingPanels().tree;
    const panelHeight = panel.docked ? Math.max(140, window.innerHeight - this.getDockedPanelTop()) : panel.height;
    const splitterHeight = 8;
    const minTreeHeight = 140;
    const minPropertiesHeight = 180;
    const maxTreeHeight = Math.max(minTreeHeight, panelHeight - minPropertiesHeight - splitterHeight);
    const startY = event.clientY;
    const startHeight = this.treeSectionHeight;

    const resizeSections = (moveEvent: PointerEvent): void => {
      const nextHeight = startHeight + (moveEvent.clientY - startY);
      this.treeSectionHeight = Math.min(Math.max(nextHeight, minTreeHeight), maxTreeHeight);
    };

    this.registerPointerDrag(resizeSections);
  }

  // Returns CSS row tracks for the unified IFC panel split layout.
  get unifiedIfcPanelRowsTemplate(): string {
    return `${this.treeSectionHeight}px 8px minmax(0, 1fr)`;
  }

  // Reuses a single pointer drag registration with immediate UI refresh for all panel interactions.
  private registerPointerDrag(onPointerMove: (event: PointerEvent) => void): void {
    const handlePointerMove = (moveEvent: PointerEvent): void => {
      onPointerMove(moveEvent);
      this.changeDetectorRef.detectChanges();
    };

    const stopPointerDrag = (): void => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopPointerDrag);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopPointerDrag, { once: true });
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
    handle: ResizeHandle,
    startWidth: number,
    startHeight: number,
    startLeft: number,
    startTop: number,
    deltaX: number,
    deltaY: number,
  ): Pick<FloatingPanelState, 'left' | 'top' | 'width' | 'height'> {
    const minWidth = 220;
    const minHeight = 120;
    const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.85));
    const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight * 0.8));
    let width = startWidth;
    let height = startHeight;
    let left = startLeft;
    let top = startTop;

    if (panel.docked) {
      if (panel.dockSide === 'right' && (handle.includes('left') || handle.includes('right'))) {
        width = startWidth - deltaX;
      }

      if (panel.dockSide === 'left' && (handle.includes('left') || handle.includes('right'))) {
        width = startWidth + deltaX;
      }

      if (panel.dockSide === 'bottom' && (handle.includes('top') || handle.includes('bottom'))) {
        height = startHeight - deltaY;
      }
    } else {
      if (handle.includes('left')) {
        width = startWidth - deltaX;
        left = startLeft + deltaX;
      }
      if (handle.includes('right')) {
        width = startWidth + deltaX;
      }
      if (handle.includes('top')) {
        height = startHeight - deltaY;
        top = startTop + deltaY;
      }
      if (handle.includes('bottom')) {
        height = startHeight + deltaY;
      }
    }

    width = Math.min(Math.max(width, minWidth), maxWidth);
    height = Math.min(Math.max(height, minHeight), maxHeight);

    if (!panel.docked) {
      if (handle.includes('left')) {
        left = startLeft + (startWidth - width);
      }
      if (handle.includes('top')) {
        top = startTop + (startHeight - height);
      }
      const constrainedPosition = this.constrainFloatingPanelPositionWithSize(width, left, top);
      left = constrainedPosition.left;
      top = constrainedPosition.top;
    }

    return {
      left,
      top,
      width,
      height,
    };
  }

  // Allows only meaningful handle directions based on current dock side.
  private canResizeFromHandle(panel: FloatingPanelState, handle: ResizeHandle): boolean {
    if (!panel.docked) return true;
    if (panel.dockSide === 'left') return handle.includes('right');
    if (panel.dockSide === 'right') return handle.includes('left');
    return handle.includes('top');
  }

  // Keeps enough of a floating panel visible while considering its tentative size.
  private constrainFloatingPanelPositionWithSize(
    panelWidth: number,
    left: number,
    top: number,
  ): Pick<FloatingPanelState, 'left' | 'top'> {
    const visibleHandleWidth = 80;
    const titleBarHeight = 34;
    const minimumLeft = -panelWidth + visibleHandleWidth;
    const maximumLeft = window.innerWidth - visibleHandleWidth;
    const maximumTop = window.innerHeight - titleBarHeight;

    return {
      left: Math.min(Math.max(left, minimumLeft), maximumLeft),
      top: Math.min(Math.max(top, 0), maximumTop),
    };
  }

  private getDockedPanelTop(): number {
    return this.toolbarContentVisible() ? this.defaultDockedTopWithToolbar : this.defaultDockedTopWithoutToolbar;
  }

  private resetDockedPanel(panelId: FloatingPanelId): void {
    if (panelId === 'tree') {
      this.updateFloatingPanel(panelId, {
        docked: true,
        dockSide: 'right',
        top: this.getDockedPanelTop(),
        width: this.defaultTreeDockedWidth,
        zIndex: this.nextFloatingPanelZIndex++,
      });
      return;
    }

    if (panelId === 'bottom') {
      this.updateFloatingPanel(panelId, {
        docked: true,
        dockSide: 'bottom',
        height: this.defaultBottomDockedHeight,
        zIndex: this.nextFloatingPanelZIndex++,
      });
      return;
    }

    this.updateFloatingPanel(panelId, { docked: true, zIndex: this.nextFloatingPanelZIndex++ });
  }

  private resolvePanelId(panelId: FloatingPanelId): FloatingPanelId {
    return panelId === 'properties' ? 'tree' : panelId;
  }

  // Returns whether an action belongs to the Home toolbar workspace.
  private isHomeToolbarAction(action: ToolbarActionId): boolean {
    return [
      'home-add-item',
      'home-remove-item',
      'home-select-all',
      'home-cut',
      'home-copy',
      'home-paste',
      'home-select-filter',
      'home-object-info',
      'home-links-view',
      'home-assign-property',
      'home-unlinked-objects',
    ].includes(action);
  }

  // Routes Home actions to the linking workspace and option prompts.
  private handleHomeToolbarAction(action: ToolbarActionId): void {
    if (this.bottomPanelTab() !== 'links') {
      this.setBottomPanelTab('links');
      setTimeout(() => this.handleHomeToolbarAction(action));
      return;
    }

    const linkingWorkspace = this.linkingPanel;
    if (!linkingWorkspace) return;

    if (action === 'home-select-filter') {
      const mode = this.promptSelectFilterMode();
      if (!mode) return;
      linkingWorkspace.aplicarFiltroSeleccion(mode);
      return;
    }

    if (action === 'home-unlinked-objects') {
      const mode = this.promptUnlinkedObjectsMode();
      if (!mode) return;
      linkingWorkspace.aplicarFiltroObjetosSinVinculo(mode);
      return;
    }

    linkingWorkspace.triggerHomeAction(action);
  }

  // Requests filter mode to select IFC object rows and their model elements.
  private promptSelectFilterMode(): SelectFilterMode | null {
    const option = window.prompt(
      'Filtro de selección:\n1) Objetos con vínculos (todos)\n2) Objetos con vínculos (conceptos seleccionados)\n3) Objetos seleccionados en el modelo\n4) Todos los objetos del modelo\n5) Objetos del mismo tipo que el seleccionado',
      '1',
    );
    if (option == null) return null;

    const normalizedOption = option.trim();
    if (normalizedOption === '1') return 'linked-concepts-all';
    if (normalizedOption === '2') return 'linked-concepts-selected';
    if (normalizedOption === '3') return 'selected-in-model';
    if (normalizedOption === '4') return 'all-model';
    if (normalizedOption === '5') return 'same-type-as-selected';
    return null;
  }

  // Requests filter mode to find unlinked rows in IFC object data.
  private promptUnlinkedObjectsMode(): UnlinkedObjectsMode | null {
    const option = window.prompt(
      'Objetos sin vínculo:\n1) Objetos sin vínculos a conceptos\n2) Objetos sin materiales relacionados\n3) Materiales sin vínculos a conceptos',
      '1',
    );
    if (option == null) return null;

    const normalizedOption = option.trim();
    if (normalizedOption === '1') return 'objects-without-concept-links';
    if (normalizedOption === '2') return 'objects-without-material';
    if (normalizedOption === '3') return 'materials-without-object-links';
    return null;
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
