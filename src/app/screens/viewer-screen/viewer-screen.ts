import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  effect,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { NgStyle } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Toolbar, type ToolbarActionId } from '../../models/toolbar/toolbar';
import { TOOLBAR_TRANSLATIONS } from '../../models/toolbar/toolbar.translations';
import { TreePanel } from '../../models/tree-panel/tree-panel';
import { PropertiesPanel } from '../../models/properties-panel/properties-panel';
import { LinkingPanel } from '../../models/linking-panel/linking-panel';
import { ModelVisibilityPanel } from '../../models/model-visibility-panel/model-visibility-panel';
import { BoqPanel } from '../../models/boq-panel/boq-panel';
import { ParametersPanel } from '../../models/parameters-panel/parameters-panel';
import { ParametersReportPanel } from '../../models/parameters-report-panel/parameters-report-panel';
import { ParametersImportDialog } from '../../models/parameters-import-dialog/parameters-import-dialog';
import { CatalogStructureDialog, type CatalogStructureDraft } from '../../models/catalog-structure-dialog/catalog-structure-dialog';
import { BackendAuthService } from '../../services/backend-auth.service';
import { BackendProyectosService } from '../../services/backend-proyectos.service';
import { CuantificadorB5D } from '../../utils/b5d-quantification';
import { I18nService } from '../../utils/i18n/i18n.service';
import { VisorIfc } from '../../utils/ifc-viewer';
import type {
  CatalogoB5DOrm,
  ConceptoB5DOrm,
  CuantificacionB5DOrm,
  ParametroB5DOrm,
  SaveB5DProyectPayloadOrm,
  ProyectoTrabajoOrm,
  UsuarioSesionOrm,
  VinculoConceptoBimOrm,
} from '../../types/b5d-orm';
import type { HomeBottomPanelTab, HomeToolbarState, SelectFilterMode, UnlinkedObjectsMode } from '../../types/home-toolbar';
import type {
  MeasurementCountMode,
  MeasurementLengthMode,
  MeasurementMode,
  MeasurementVolumeSummary,
} from '../../types/measurement';
import type { FloatingPanelId } from '../../types/floating-panel';
import type { ElementoIfcB5D, NodoCuantificacion } from '../../types/quantity-take-off';

type DockSide = 'left' | 'right' | 'bottom';
type BottomPanelTab = HomeBottomPanelTab;
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
    ParametersReportPanel,
    ParametersImportDialog,
    CatalogStructureDialog,
  ],
  templateUrl: './viewer-screen.html',
  styleUrl: './viewer-screen.scss',
})
export class ViewerScreen implements AfterViewInit, OnDestroy {
  @ViewChild('contenedorVisor', { static: true }) private readonly contenedorVisor?: ElementRef<HTMLElement>;
  @ViewChild('inputB5d') private readonly inputB5d?: ElementRef<HTMLInputElement>;
  @ViewChild(LinkingPanel) private readonly linkingPanel?: LinkingPanel;
  @ViewChild(ParametersPanel) private readonly parametersPanel?: ParametersPanel;
  @ViewChild(ParametersReportPanel) private readonly parametersReportPanel?: ParametersReportPanel;
  @ViewChild(BoqPanel) private readonly boqPanel?: BoqPanel;
  private readonly defaultDockedTopWithToolbar = 114;
  private readonly defaultDockedTopWithoutToolbar = 34;
  private readonly defaultTreeDockedWidth = 360;
  private readonly defaultBottomDockedHeight = 280;

  readonly visorIfc = inject(VisorIfc);
  readonly backendAuth = inject(BackendAuthService);
  readonly backendProyectos = inject(BackendProyectosService);
  readonly i18n = inject(I18nService);
  readonly cuantificacion = signal<NodoCuantificacion | null>(null);
  readonly ifcElements = signal<ElementoIfcB5D[]>([]);
  readonly proyectoB5dActivo = signal<ProyectoTrabajoOrm | null>(null);
  readonly b5dConcepts = signal<ConceptoB5DOrm[]>([]);
  readonly b5dLinks = signal<VinculoConceptoBimOrm[]>([]);
  readonly b5dCatalogs = signal<CatalogoB5DOrm[]>([]);
  readonly cuantificacionesB5d = signal<CuantificacionB5DOrm[]>([]);
  readonly parametrosB5d = signal<ParametroB5DOrm[]>([]);
  readonly b5dCargando = signal(false);
  readonly b5dMensaje = signal('');
  readonly usuarioSesion = signal<UsuarioSesionOrm | null>(null);
  readonly catalogStructureDialogVisible = signal(false);
  readonly catalogStructureDialogMode = signal<'create' | 'info'>('create');
  readonly catalogStructureDialogCatalog = signal<CatalogoB5DOrm | null>(null);
  readonly catalogStructureDialogLoading = signal(false);
  readonly parameterImportDialogVisible = signal(false);
  private readonly catalogLinkCopySourceByTargetId = new Map<number, number>();
  readonly homeToolbarState = signal<HomeToolbarState>({
    activeBottomTab: 'links',
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
    selectedCatalogId: null,
    parametersTotal: 0,
    selectedParameterIds: [],
    parameterListVisible: true,
    parameterBoqVisible: true,
    parameterDescriptionMatchesVisible: true,
    parameterAnalysisVisible: true,
    tableFiltersVisible: false,
  });
  readonly activeMeasurementMode = signal<MeasurementMode | null>(null);
  readonly activeLengthMeasurementMode = signal<MeasurementLengthMode>('edge');
  readonly activeCountMeasurementMode = signal<MeasurementCountMode>('selected');
  readonly volumeMeasurementSummary = signal<MeasurementVolumeSummary | null>(null);
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
    { id: 'report', label: 'Reporte' },
  ];
  treeSectionHeight = 220;
  private readonly cuantificadorB5D = new CuantificadorB5D();
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly measurementSelectionEffect = effect(() => {
    const mode = this.activeMeasurementMode();

    void this.visorIfc.setMeasurementMode(mode);
    this.visorIfc.setMeasurementLengthMode(this.activeLengthMeasurementMode());
    this.visorIfc.setMeasurementCountMode(this.activeCountMeasurementMode());

    if (mode !== 'volume') {
      this.measurementVolumeRequestId += 1;
      this.volumeMeasurementSummary.set(null);
      return;
    }

    const selectionMap = this.visorIfc.seleccionActual();
    void this.actualizarResumenVolumen(selectionMap);
  });
  private nextFloatingPanelZIndex = 40;
  private autoSaveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private autoSaveInProgress = false;
  private hasPendingDraftChanges = false;
  private draftChangeVersion = 0;
  private measurementVolumeRequestId = 0;
  private readonly b5dDebugLoggingEnabled = true;

  async ngAfterViewInit(): Promise<void> {
    if (!this.contenedorVisor?.nativeElement) return;
    this.debugB5d('ngAfterViewInit: initializing viewer');
    await this.visorIfc.inicializarVisor(this.contenedorVisor.nativeElement);
    this.debugB5d('ngAfterViewInit: viewer ready, loading B5D panels');
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
      this.parametrosB5d.set([]);
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
    this.debugB5d('inicializarPanelesB5d: checking backend session');
    if (!(await this.asegurarSesionBackend())) {
      this.debugB5d('inicializarPanelesB5d: session check failed, redirecting to login');
      await this.router.navigate(['/login']);
      return;
    }
    this.debugB5d('inicializarPanelesB5d: session OK, loading recent project');
    await this.cargarProyectoReciente();
  }

  private async asegurarSesionBackend(): Promise<boolean> {
    try {
      this.debugB5d('asegurarSesionBackend: calling /api/auth/me');
      const sesion = await firstValueFrom(this.backendAuth.me());
      this.debugB5d('asegurarSesionBackend: response received', sesion);
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
    this.debugB5d('cargarProyectoReciente: start');
    this.b5dCargando.set(true);
    this.b5dMensaje.set('');
    try {
      this.debugB5d('cargarProyectoReciente: requesting project list');
      const proyectos = await firstValueFrom(this.backendProyectos.listarProyectos());
      this.debugB5d('cargarProyectoReciente: project list received', proyectos);
      const proyecto = proyectos.resultados[0] ?? null;
      this.proyectoB5dActivo.set(proyecto);
      if (!proyecto) {
        this.b5dConcepts.set([]);
        this.b5dLinks.set([]);
        this.b5dCatalogs.set([]);
        this.cuantificacionesB5d.set([]);
        this.parametrosB5d.set([]);
        this.b5dMensaje.set('No hay proyectos importados. Usa "Importar de base de datos B5D".');
        return;
      }

      this.debugB5d('cargarProyectoReciente: loading active project data', proyecto.id);
      await this.cargarDatosProyectoB5d(proyecto.id);
      this.debugB5d('cargarProyectoReciente: project data loaded');
    } catch (error) {
      this.debugB5d('cargarProyectoReciente: error', error);
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo consultar la lista de proyectos B5D.'));
    } finally {
      this.debugB5d('cargarProyectoReciente: end');
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

  // Opens the concept-structure dialog in create or read-only mode.
  abrirDialogoEstructuraCatalogo(modo: 'create' | 'info'): void {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay un proyecto B5D activo para administrar catálogos.');
      return;
    }

    const catalogoSeleccionado = this.obtenerCatalogoSeleccionado();
    if (modo === 'info' && !catalogoSeleccionado) {
      this.b5dMensaje.set('Selecciona un catálogo para ver su información.');
      return;
    }

    this.catalogStructureDialogMode.set(modo);
    this.catalogStructureDialogCatalog.set(modo === 'info' ? catalogoSeleccionado : null);
    this.catalogStructureDialogLoading.set(false);
    this.catalogStructureDialogVisible.set(true);
    this.b5dMensaje.set('');
  }

  // Closes the concept-structure dialog and clears its local state.
  cerrarDialogoEstructuraCatalogo(): void {
    this.catalogStructureDialogVisible.set(false);
    this.catalogStructureDialogCatalog.set(null);
    this.catalogStructureDialogLoading.set(false);
  }

  // Opens the parameter import wizard.
  abrirDialogoImportacionParametros(): void {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay un proyecto B5D activo para importar parametros.');
      return;
    }

    this.parameterImportDialogVisible.set(true);
    this.b5dMensaje.set('');
  }

  // Closes the parameter import wizard.
  cerrarDialogoImportacionParametros(): void {
    this.parameterImportDialogVisible.set(false);
  }

  // Imports a PlanAXA catalog and refreshes the current project snapshot.
  async guardarEstructuraCatalogo(draft: CatalogStructureDraft): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay un proyecto B5D activo para importar catálogos.');
      return;
    }

    if (this.catalogStructureDialogLoading()) return;

    this.catalogStructureDialogLoading.set(true);
    this.b5dMensaje.set('');
    try {
      const respuesta = await firstValueFrom(
        this.backendProyectos.importarCatalogoAxa(proyecto.id, {
          archivo: draft.archivo as File,
          nombre: draft.nombre,
          descripcion: draft.descripcion,
          propiedad_tipo_bim: draft.propiedad_tipo_bim,
          grupo_cantidades_bim: draft.grupo_cantidades_bim,
        }),
      );

      await this.cargarDatosProyectoB5d(proyecto.id);
      this.setBottomPanelTab('links');
      await this.sincronizarCatalogoSeleccionado(respuesta.catalogo.id);
      this.cerrarDialogoEstructuraCatalogo();
      this.b5dMensaje.set(`Catálogo importado correctamente: ${respuesta.catalogo.nombre ?? draft.nombre}.`);
    } catch (error) {
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo importar la estructura de conceptos.'));
    } finally {
      this.catalogStructureDialogLoading.set(false);
    }
  }

  // Creates an empty catalog or imports a PlanAXA catalog, then optionally copies links.
  async guardarEstructuraCatalogoV2(draft: CatalogStructureDraft): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay un proyecto B5D activo para administrar catalogos.');
      return;
    }

    if (this.catalogStructureDialogLoading()) return;

    this.catalogStructureDialogLoading.set(true);
    this.b5dMensaje.set('');
    try {
      const sourceCatalogId = draft.copiar_vinculos ? draft.copiar_vinculos_desde_catalogo_id : null;
      const shouldCopyLinks = sourceCatalogId != null;
      const respuesta = draft.archivo
        ? await firstValueFrom(
            this.backendProyectos.importarCatalogoAxa(proyecto.id, {
              archivo: draft.archivo,
              nombre: draft.nombre,
              descripcion: draft.descripcion,
              propiedad_tipo_bim: draft.propiedad_tipo_bim,
              grupo_cantidades_bim: draft.grupo_cantidades_bim,
            }),
          )
        : await firstValueFrom(
            this.backendProyectos.crearCatalogo(proyecto.id, {
              nombre: draft.nombre,
              descripcion: draft.descripcion,
              propiedad_tipo_bim: draft.propiedad_tipo_bim,
              grupo_cantidades_bim: draft.grupo_cantidades_bim,
              copiar_vinculos_desde_catalogo_id: sourceCatalogId,
            }),
          );

      const catalogoCreado = this.obtenerCatalogoDeRespuesta(respuesta);
      if (shouldCopyLinks) {
        this.catalogLinkCopySourceByTargetId.set(catalogoCreado.id, sourceCatalogId);
      }

      await this.cargarDatosProyectoB5d(proyecto.id);
      this.setBottomPanelTab('links');
      await this.sincronizarCatalogoSeleccionado(catalogoCreado.id);
      if (shouldCopyLinks) {
        await this.persistirCambiosB5dEnServidor(proyecto.id, this.draftChangeVersion);
      }
      this.cerrarDialogoEstructuraCatalogo();
      const actionLabel = draft.archivo ? 'importado' : 'creado';
      this.b5dMensaje.set(`Catalogo ${actionLabel} correctamente: ${catalogoCreado.nombre ?? draft.nombre}.`);
    } catch (error) {
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo guardar la estructura de conceptos.'));
    } finally {
      this.catalogStructureDialogLoading.set(false);
    }
  }

  // Refreshes project state after the parameter import wizard completes.
  async onParametersImportCompleted(summary: { created: number; updated: number; skipped: number; failed: number }): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) return;

    await this.cargarDatosProyectoB5d(proyecto.id);
    this.b5dMensaje.set(
      `Importación de parámetros finalizada: ${summary.created} creados, ${summary.updated} actualizados, ${summary.skipped} omitidos, ${summary.failed} fallidos.`,
    );
  }

  // Deletes the selected catalog and keeps the remaining catalog selection in sync.
  async eliminarCatalogoSeleccionado(): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    const catalogoSeleccionado = this.obtenerCatalogoSeleccionado();
    if (!proyecto) {
      this.b5dMensaje.set('No hay un proyecto B5D activo para eliminar catálogos.');
      return;
    }
    if (!catalogoSeleccionado) {
      this.b5dMensaje.set('Selecciona un catálogo para eliminarlo.');
      return;
    }

    const nombreCatalogo = catalogoSeleccionado.nombre ?? `ID ${catalogoSeleccionado.id}`;
    const confirmado = window.confirm(`¿Eliminar la estructura de conceptos "${nombreCatalogo}"?`);
    if (!confirmado) return;

    this.catalogStructureDialogLoading.set(true);
    this.b5dMensaje.set('');
    try {
      await firstValueFrom(this.backendProyectos.eliminarCatalogo(proyecto.id, catalogoSeleccionado.id));
      this.catalogLinkCopySourceByTargetId.delete(catalogoSeleccionado.id);
      for (const [targetCatalogId, sourceCatalogId] of [...this.catalogLinkCopySourceByTargetId.entries()]) {
        if (sourceCatalogId === catalogoSeleccionado.id) {
          this.catalogLinkCopySourceByTargetId.delete(targetCatalogId);
        }
      }
      await this.cargarDatosProyectoB5d(proyecto.id);
      this.setBottomPanelTab('links');
      await this.sincronizarCatalogoSeleccionado(this.b5dCatalogs()[0]?.id ?? null);
      this.cerrarDialogoEstructuraCatalogo();
      this.b5dMensaje.set('La estructura de conceptos se eliminó correctamente.');
    } catch (error) {
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo eliminar la estructura de conceptos.'));
    } finally {
      this.catalogStructureDialogLoading.set(false);
    }
  }

  // Persists the current linking workspace draft in the backend project tables.
  private async persistirCambiosB5dEnServidor(proyectoId: number, draftVersionAtStart: number): Promise<void> {
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
            costo: conceptItem.costo ?? null,
            costo_mn: conceptItem.costo_mn ?? null,
            costo_me: conceptItem.costo_me ?? null,
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
    if (draftVersionAtStart !== this.draftChangeVersion) {
      this.debugB5d('persistirCambiosB5dEnServidor: stale response ignored', {
        proyectoId,
        draftVersionAtStart,
        currentDraftVersion: this.draftChangeVersion,
      });
      return;
    }
    this.proyectoB5dActivo.set(savedSnapshot.proyecto);
    if (savedSnapshot.catalogos?.resultados) {
      this.b5dCatalogs.set(savedSnapshot.catalogos.resultados);
    }
    this.b5dConcepts.set(this.normalizarConceptosB5d(savedSnapshot.conceptos.resultados));
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
      await this.persistirCambiosB5dEnServidor(proyecto.id, this.draftChangeVersion);
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
      await this.persistirCambiosB5dEnServidor(proyectoId, this.draftChangeVersion);
    }
  }

  private async cargarDatosProyectoB5d(proyectoId: number): Promise<void> {
    this.debugB5d('cargarDatosProyectoB5d: start', proyectoId);
    const [estado, conceptos, vinculos, catalogos, cuantificaciones, parametros] = await Promise.all([
      firstValueFrom(this.backendProyectos.consultarEstadoProyecto(proyectoId)),
      firstValueFrom(this.backendProyectos.listarConceptos(proyectoId)),
      firstValueFrom(this.backendProyectos.listarVinculosBim(proyectoId)),
      firstValueFrom(this.backendProyectos.listarCatalogos(proyectoId)),
      firstValueFrom(this.backendProyectos.listarCuantificaciones(proyectoId)),
      firstValueFrom(this.backendProyectos.listarParametros(proyectoId)),
    ]);
    this.debugB5d('cargarDatosProyectoB5d: responses received', {
      estado: !!estado,
      conceptos: conceptos.resultados.length,
      vinculos: vinculos.resultados.length,
      catalogos: catalogos.resultados.length,
      cuantificaciones: cuantificaciones.resultados.length,
      parametros: parametros.resultados.length,
    });

    this.proyectoB5dActivo.set(estado);
    this.b5dConcepts.set(this.normalizarConceptosB5d(conceptos.resultados));
    this.b5dLinks.set(vinculos.resultados);
    this.b5dCatalogs.set(catalogos.resultados);
    this.limpiarCopiasDeCatalogosInexistentes(catalogos.resultados);
    this.cuantificacionesB5d.set(cuantificaciones.resultados);
    this.parametrosB5d.set(parametros.resultados);
    this.debugB5d('cargarDatosProyectoB5d: end', proyectoId);
  }

  // Extracts the created catalog from either a raw catalog or a wrapped response.
  private obtenerCatalogoDeRespuesta(respuesta: CatalogoB5DOrm | { catalogo: CatalogoB5DOrm }): CatalogoB5DOrm {
    return 'catalogo' in respuesta ? respuesta.catalogo : respuesta;
  }

  // Removes copy-link mappings that point to catalogs no longer present in the project.
  private limpiarCopiasDeCatalogosInexistentes(catalogos: CatalogoB5DOrm[]): void {
    const catalogIds = new Set(catalogos.map((catalogo) => catalogo.id));
    for (const [targetCatalogId, sourceCatalogId] of [...this.catalogLinkCopySourceByTargetId.entries()]) {
      if (!catalogIds.has(targetCatalogId) || !catalogIds.has(sourceCatalogId)) {
        this.catalogLinkCopySourceByTargetId.delete(targetCatalogId);
      }
    }
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

  private debugB5d(message: string, data?: unknown): void {
    if (!this.b5dDebugLoggingEnabled) return;
    if (data === undefined) {
      console.debug(`[B5D] ${message}`);
      return;
    }
    console.debug(`[B5D] ${message}`, data);
  }

  private normalizarConceptosB5d(conceptos: ConceptoB5DOrm[]): ConceptoB5DOrm[] {
    return conceptos.map((concepto) => ({
      ...concepto,
      costo: this.parseNumericLikeValue(concepto.costo),
      costo_mn: this.parseNumericLikeValue(concepto.costo_mn),
      costo_me: this.parseNumericLikeValue(concepto.costo_me),
    }));
  }

  private parseNumericLikeValue(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    const normalized = String(value).trim();
    if (!normalized) return null;

    let sanitized = normalized.replace(/[^\d.,-]/g, '');
    if (sanitized.includes(',') && sanitized.includes('.')) {
      if (sanitized.lastIndexOf(',') > sanitized.lastIndexOf('.')) {
        sanitized = sanitized.replace(/\./g, '').replace(',', '.');
      } else {
        sanitized = sanitized.replace(/,/g, '');
      }
    } else if (sanitized.includes(',')) {
      sanitized = sanitized.replace(',', '.');
    }

    const numericValue = Number(sanitized);
    return Number.isFinite(numericValue) ? numericValue : null;
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
      'import-axa-catalog': () => {
        void this.asegurarSesionBackend().then((autenticado) => {
          if (!autenticado) {
            void this.irALogin();
            return;
          }
          this.abrirDialogoEstructuraCatalogo('create');
        });
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
      'measurement-volume': () => this.toggleVolumeMeasurementMode(),
      'measurement-area': () => this.toggleAreaMeasurementMode(),
      'measurement-length': () => this.toggleLengthMeasurementMode(),
      'measurement-angle': () => this.toggleAngleMeasurementMode(),
      'measurement-count': () => this.toggleCountMeasurementMode(),
      'measurement-length-edge': () => this.setLengthMeasurementMode('edge'),
      'measurement-length-points': () => this.setLengthMeasurementMode('points'),
      'measurement-count-selected': () => this.setCountMeasurementMode('selected'),
      'measurement-count-manual': () => this.setCountMeasurementMode('manual'),
      'clear-measurements': () => this.clearMeasurements(),
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

  // Toggles the active measurement mode and clears the overlay when disabled.
  toggleVolumeMeasurementMode(): void {
    this.toggleMeasurementMode('volume');
  }

  // Toggles the area measurement mode used for face-level area selection.
  toggleAreaMeasurementMode(): void {
    this.toggleMeasurementMode('area');
  }

  // Toggles the length measurement mode used for vertex-to-vertex snapping.
  toggleLengthMeasurementMode(): void {
    this.toggleMeasurementMode('length');
  }

  // Toggles the angle measurement mode used for three-point angle snapping.
  toggleAngleMeasurementMode(): void {
    this.toggleMeasurementMode('angle');
  }

  // Toggles the count measurement mode used for selected or clicked objects.
  toggleCountMeasurementMode(): void {
    this.toggleMeasurementMode('count');
  }

  // Sets the active length sub-mode and keeps the length measurement mode enabled.
  setLengthMeasurementMode(mode: MeasurementLengthMode): void {
    this.activeLengthMeasurementMode.set(mode);
    if (this.activeMeasurementMode() !== 'length') {
      this.activeMeasurementMode.set('length');
    }
    this.visorIfc.setMeasurementLengthMode(mode);
  }

  // Sets the active count sub-mode and keeps the count measurement mode enabled.
  setCountMeasurementMode(mode: MeasurementCountMode): void {
    this.activeCountMeasurementMode.set(mode);
    if (this.activeMeasurementMode() !== 'count') {
      this.activeMeasurementMode.set('count');
    }
    this.visorIfc.setMeasurementCountMode(mode);
  }

  // Switches measurement modes without affecting unrelated toolbar state.
  toggleMeasurementMode(mode: MeasurementMode): void {
    this.measurementVolumeRequestId += 1;
    this.activeMeasurementMode.set(this.activeMeasurementMode() === mode ? null : mode);
  }

  // Stores linking panel state used to toggle Home toolbar actions.
  onLinkingToolbarStateChange(state: HomeToolbarState): void {
    this.homeToolbarState.set({
      ...this.homeToolbarState(),
      ...state,
    });
  }

  // Stores parameters panel state to toggle Home toolbar actions in parameter mode.
  onParametersToolbarStateChange(state: HomeToolbarState): void {
    this.homeToolbarState.set({
      ...this.homeToolbarState(),
      ...state,
      activeBottomTab: 'parameters',
    });
  }

  // Stores BOQ panel state updates so the shared Home toolbar can reflect filter toggles.
  onBoqToolbarStateChange(state: HomeToolbarState): void {
    this.homeToolbarState.set({
      ...this.homeToolbarState(),
      ...state,
      activeBottomTab: 'boq',
    });
  }

  // Syncs parameter rows returned from CRUD operations in the parameter panel.
  onParametersRowsChange(rows: ParametroB5DOrm[]): void {
    this.parametrosB5d.set(rows);
  }

  // Returns the current measurement panel title.
  getMeasurementPanelTitle(): string {
    const mode = this.activeMeasurementMode();
    const key =
      mode === 'area'
        ? 'toolbar.measurement.panel.area.title'
        : mode === 'length'
          ? 'toolbar.measurement.panel.length.title'
          : mode === 'angle'
            ? 'toolbar.measurement.panel.angle.title'
            : mode === 'count'
              ? 'toolbar.measurement.panel.count.title'
          : 'toolbar.measurement.panel.volume.title';
    return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, key);
  }

  // Returns the current measurement panel empty-state message.
  getMeasurementEmptyMessage(): string {
    const mode = this.activeMeasurementMode();
    const key =
      mode === 'area'
        ? 'toolbar.measurement.panel.area.empty'
        : mode === 'length'
          ? 'toolbar.measurement.panel.length.empty'
          : mode === 'angle'
            ? 'toolbar.measurement.panel.angle.empty'
            : mode === 'count'
              ? this.activeCountMeasurementMode() === 'manual'
                ? 'toolbar.measurement.panel.count.manual.empty'
                : 'toolbar.measurement.panel.count.empty'
          : 'toolbar.measurement.panel.volume.empty';
    return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, key);
  }

  // Returns the unavailable-data message for the current measurement mode.
  getMeasurementUnavailableMessage(): string {
    const mode = this.activeMeasurementMode();
    const key =
      mode === 'area'
        ? 'toolbar.measurement.panel.area.unavailable'
        : mode === 'length'
          ? 'toolbar.measurement.panel.length.unavailable'
          : mode === 'angle'
            ? 'toolbar.measurement.panel.angle.unavailable'
            : mode === 'count'
              ? 'toolbar.measurement.panel.count.unavailable'
          : 'toolbar.measurement.panel.volume.unavailable';
    return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, key);
  }

  // Returns the helper message shown while the user is choosing the second length anchor.
  getMeasurementLengthWaitingMessage(): string {
    return this.i18n.translateForComponent(
      TOOLBAR_TRANSLATIONS,
      'toolbar.measurement.panel.length.waitingSecond',
    );
  }

  // Returns the helper message shown while the user is choosing the remaining angle vertices.
  getMeasurementAngleWaitingMessage(): string {
    return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, 'toolbar.measurement.panel.angle.waiting');
  }

  // Returns the selected-item label for the current measurement summary.
  getMeasurementSelectedLabel(): string {
    const mode = this.activeMeasurementMode();
    if (mode === 'length') {
      const edgeSummary = this.visorIfc.lengthEdgeMeasurementSummary();
      if (edgeSummary) {
        const key = edgeSummary.isPinned
          ? 'toolbar.measurement.panel.selectedEdge'
          : 'toolbar.measurement.panel.hoveredEdge';
        return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, key);
      }
    }

    if (mode === 'count') {
      const key =
        this.activeCountMeasurementMode() === 'manual'
          ? 'toolbar.measurement.panel.countedObjects'
          : 'toolbar.measurement.panel.selectedObjects';
      return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, key);
    }

    const key =
      mode === 'area'
        ? 'toolbar.measurement.panel.selectedFaces'
        : mode === 'length'
          ? 'toolbar.measurement.panel.selectedPoints'
          : mode === 'angle'
            ? 'toolbar.measurement.panel.selectedPoints'
          : 'toolbar.measurement.panel.selectedObjects';
    return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, key);
  }

  // Returns the total measurement label for the current measurement summary.
  getMeasurementTotalLabel(): string {
    const mode = this.activeMeasurementMode();
    if (mode === 'length' && this.visorIfc.lengthEdgeMeasurementSummary()) {
      return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, 'toolbar.measurement.panel.edgeLength');
    }

    const key =
      mode === 'area'
        ? 'toolbar.measurement.panel.totalArea'
        : mode === 'length'
          ? 'toolbar.measurement.panel.totalDistance'
          : mode === 'angle'
            ? 'toolbar.measurement.panel.totalAngle'
            : mode === 'count'
              ? 'toolbar.measurement.panel.totalCount'
          : 'toolbar.measurement.panel.totalVolume';
    return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, key);
  }

  // Returns the label for the object count line in area measurements.
  getMeasurementObjectCountLabel(): string {
    return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, 'toolbar.measurement.panel.objects');
  }

  // Returns the label used by the remove buttons in the area measurement list.
  getMeasurementRemoveLabel(): string {
    return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, 'toolbar.measurement.panel.remove');
  }

  // Formats the measurement summary value for display.
  formatMeasurementValue(): string {
    const mode = this.activeMeasurementMode();
    if (mode === 'area') {
      const summary = this.visorIfc.areaMeasurementSummary();
      if (!summary || summary.totalArea === null) return '-';
      return `${summary.totalArea.toFixed(3)} m²`;
    }

    if (mode === 'length') {
      const edgeSummary = this.visorIfc.lengthEdgeMeasurementSummary();
      if (edgeSummary && edgeSummary.distance !== null) {
        return `${edgeSummary.distance.toFixed(3)} m`;
      }

      const summary = this.visorIfc.lengthMeasurementSummary();
      if (!summary || summary.distance === null) return '-';
      return `${summary.distance.toFixed(3)} m`;
    }

    if (mode === 'angle') {
      const summary = this.visorIfc.angleMeasurementSummary();
      if (!summary || summary.angle === null) return '-';
      return `${summary.angle.toFixed(3)} °`;
    }

    if (mode === 'count') {
      const summary = this.visorIfc.countMeasurementSummary();
      if (!summary) return '-';
      return `${summary.count}`;
    }

    const summary = this.volumeMeasurementSummary();
    if (!summary || summary.totalVolume === null) return '-';

    return `${summary.totalVolume.toFixed(3)} m³`;
  }

  // Indicates whether any measurement overlay should be visible.
  isMeasurementVisible(): boolean {
    return (
      this.activeMeasurementMode() === 'volume' ||
      this.activeMeasurementMode() === 'area' ||
      this.activeMeasurementMode() === 'length' ||
      this.activeMeasurementMode() === 'angle' ||
      this.activeMeasurementMode() === 'count'
    );
  }

  // Clears every measurement selection and overlay currently active in the viewer.
  clearMeasurements(): void {
    void this.visorIfc.clearAllMeasurements();
    this.measurementVolumeRequestId += 1;
    this.volumeMeasurementSummary.set(null);
  }

  // Recomputes the total volume for the current selection and guards against stale async results.
  private async actualizarResumenVolumen(selectionMap: Record<string, Set<number>>): Promise<void> {
    const requestId = ++this.measurementVolumeRequestId;

    if (!Object.values(selectionMap).some((localIdSet) => localIdSet.size > 0)) {
      this.volumeMeasurementSummary.set({ totalVolume: null, selectedCount: 0 });
      return;
    }

    try {
      const summary = await this.visorIfc.obtenerResumenVolumenSeleccionado(selectionMap);
      if (requestId !== this.measurementVolumeRequestId) return;
      if (this.activeMeasurementMode() !== 'volume') return;

      this.volumeMeasurementSummary.set(summary);
    } catch (error) {
      if (requestId !== this.measurementVolumeRequestId) return;
      console.warn('No se pudo calcular el volumen seleccionado:', error);
      this.volumeMeasurementSummary.set({
        totalVolume: null,
        selectedCount: Object.values(selectionMap).reduce((count, localIdSet) => count + localIdSet.size, 0),
      });
    }
  }

  // Mirrors IFC object-table selection into the 3D model selection.
  onLinkingIfcSelectionChange(localIds: number[]): void {
    void this.visorIfc.seleccionarElementosPorLocalIds(localIds);
  }

  // Schedules draft autosave when the linking workspace mutates concepts or links.
  onLinkingDraftChanged(): void {
    this.draftChangeVersion += 1;
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
    this.homeToolbarState.update((state) => ({
      ...state,
      activeBottomTab: tab,
    }));
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
      'home-refresh-view',
      'home-toggle-filters',
      'home-reset-view',
      'home-coStru-new',
      'home-coStru-remove',
      'home-coStru-dup',
      'home-coStru-info',
      'import-parameters-excel',
    ].includes(action);
  }

  // Routes Home actions to the linking workspace and option prompts.
  private handleHomeToolbarAction(action: ToolbarActionId): void {
    const activeTab = this.bottomPanelTab();

    if (action === 'home-refresh-view') {
      const proyecto = this.proyectoB5dActivo();
      if (!proyecto) return;
      const catalogoActual = this.homeToolbarState().selectedCatalogId ?? null;
      void (async () => {
        await this.cargarDatosProyectoB5d(proyecto.id);
        await this.sincronizarCatalogoSeleccionado(catalogoActual);
      })();
      return;
    }

    if (action === 'home-toggle-filters') {
      this.homeToolbarState.update((state) => ({
        ...state,
        tableFiltersVisible: !state.tableFiltersVisible,
      }));
      return;
    }

    if (action === 'home-reset-view') {
      this.homeToolbarState.update((state) => ({
        ...state,
        tableFiltersVisible: false,
      }));
      if (activeTab === 'links') {
        this.linkingPanel?.resetTableViews();
      } else if (activeTab === 'parameters') {
        this.parametersPanel?.resetTableViews();
      } else if (activeTab === 'report') {
        this.parametersReportPanel?.resetView();
      } else if (activeTab === 'boq') {
        this.boqPanel?.resetTableViews();
      }
      return;
    }

    if (action === 'home-coStru-new') {
      this.abrirDialogoEstructuraCatalogo('create');
      return;
    }

    if (action === 'home-coStru-info') {
      this.abrirDialogoEstructuraCatalogo('info');
      return;
    }

    if (action === 'import-parameters-excel') {
      this.abrirDialogoImportacionParametros();
      return;
    }

    if (action === 'home-coStru-remove') {
      void this.eliminarCatalogoSeleccionado();
      return;
    }

    if (action === 'home-coStru-dup') {
      this.b5dMensaje.set('La duplicación de estructuras de conceptos aún no está disponible.');
      return;
    }

    if (action === 'home-select-filter' || action === 'home-unlinked-objects' || action === 'home-links-view') {
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
      return;
    }

    if (activeTab === 'links') {
      this.linkingPanel?.triggerHomeAction(action);
      return;
    }

    if (activeTab === 'parameters') {
      this.parametersPanel?.triggerHomeAction(action);
      return;
    }

    if (activeTab === 'boq') {
      this.boqPanel?.triggerHomeAction(action);
      return;
    }
  }

  // Returns the catalog currently selected in the concept workspace.
  private obtenerCatalogoSeleccionado(): CatalogoB5DOrm | null {
    const catalogoSeleccionadoId = this.homeToolbarState().selectedCatalogId;
    if (catalogoSeleccionadoId == null) return null;
    return this.b5dCatalogs().find((catalogoItem) => catalogoItem.id === catalogoSeleccionadoId) ?? null;
  }

  get selectedCatalogLinkCopySourceId(): number | null {
    const catalogoSeleccionadoId = this.homeToolbarState().selectedCatalogId;
    if (catalogoSeleccionadoId == null) return null;
    return this.catalogLinkCopySourceByTargetId.get(catalogoSeleccionadoId) ?? null;
  }

  // Syncs the selected catalog in the toolbar and the linking workspace without creating a draft save.
  private async sincronizarCatalogoSeleccionado(catalogoId: number | null): Promise<void> {
    this.homeToolbarState.update((state) => ({
      ...state,
      selectedCatalogId: catalogoId,
    }));

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (this.linkingPanel) {
      this.linkingPanel.setCatalogSelectionFromHost(catalogoId);
    }
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
