import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  effect,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NgStyle } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
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
import { ParametersB5dImportDialog, type B5dParameterImportSummary } from '../../models/parameters-b5d-import-dialog/parameters-b5d-import-dialog';
import { ParametersXdbImportDialog, type XdbParameterImportSummary } from '../../models/parameters-xdb-import-dialog/parameters-xdb-import-dialog';
import { LoadingPanel } from '../../models/loading-panel/loading-panel';
import {
  CatalogStructureDialog,
  type CatalogCostImportDraft,
  type CatalogStructureDraft,
} from '../../models/catalog-structure-dialog/catalog-structure-dialog';
import { BackendAuthService } from '../../services/backend-auth.service';
import { BackendProyectosService } from '../../services/backend-proyectos.service';
import { IfcFileCacheService } from '../../services/ifc-file-cache.service';
import { LocalViewerSyncService, type LocalViewerSyncMessage } from '../../services/local-viewer-sync.service';
import { CuantificadorB5D } from '../../utils/b5d-quantification';
import { isB5dDebugEnabled, logB5dDebug } from '../../utils/debug/b5d-debug';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';
import { VisorIfc } from '../../utils/ifc-viewer';
import { LoadingPanelService } from '../../services/loading-panel.service';
import { resolveIfcSelectionFromConceptKey } from '../../utils/ifc-selection/ifc-selection';
import { startPointerDrag } from '../../utils/panel-interactions/panel-interactions';
import { getSafeLocalStorage, getSafeSessionStorage } from '../../utils/browser-storage';
import { buildScopedStorageKey } from '../../utils/ui-state-storage';
import { createB5dExportPlan, createB5dImportPlan, createCatalogImportPlan } from '../../utils/loading-panel/loading-plans';
import { VIEWER_SCREEN_TRANSLATIONS } from './viewer-screen.translations';
import type { InformacionElementoSeleccionado } from '../../types/ifc';
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
import type { ViewerWindowMode } from '../../types/viewer-window';

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

type ViewerUiState = {
  bottomPanelTab?: BottomPanelTab;
  treeSectionHeight?: number;
  toolbarContentVisible?: boolean;
  modelLightingEnabled?: boolean;
  selectedCatalogId?: number | null;
  tableFiltersVisible?: boolean;
  floatingPanels?: Record<FloatingPanelId, FloatingPanelState>;
  linkingPanel?: {
    leftPanelWidth?: number;
    topPanelHeight?: number;
    topPanelOrder?: ('concepts' | 'ifc-objects')[];
    conceptPanelZoomPercent?: number;
    objectPanelZoomPercent?: number;
    relatedLinksPanelZoomPercent?: number;
    relatedLinksVisible?: boolean;
    activeWorkspacePanel?: 'concepts' | 'ifc-objects' | 'related-links';
    selectedCatalogId?: number | null;
  };
  boqPanel?: {
    leftPanelWidth?: number;
    panelOrder?: ('list' | 'preview')[];
    listZoomPercent?: number;
    sheetZoomPercent?: number;
  };
  parametersPanel?: {
    parameterListVisible?: boolean;
    boqPreviewVisible?: boolean;
    descriptionMatchesVisible?: boolean;
    analysisVisible?: boolean;
    paneOrder?: ('parameter-list' | 'boq-preview' | 'description-matches' | 'analysis')[];
    topLeftPaneWidth?: number;
    bottomLeftPaneWidth?: number;
    topWorkspaceHeight?: number;
    parameterListZoomPercent?: number;
    boqPreviewZoomPercent?: number;
    descriptionMatchesZoomPercent?: number;
    analysisZoomPercent?: number;
  };
  propertiesPanel?: {
    activeTab?: 'properties' | 'location' | 'classification' | 'relations' | 'quantities';
    seccionesAbiertas?: Record<string, boolean>;
  };
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
    ParametersB5dImportDialog,
    ParametersXdbImportDialog,
    LoadingPanel,
    CatalogStructureDialog,
  ],
  templateUrl: './viewer-screen.html',
  styleUrl: './viewer-screen.scss',
})
export class ViewerScreen implements AfterViewChecked, AfterViewInit, OnDestroy, OnInit {
  readonly viewerScreenTranslations = VIEWER_SCREEN_TRANSLATIONS;

  @ViewChild('contenedorVisor') private readonly contenedorVisor?: ElementRef<HTMLElement>;
  @ViewChild('inputB5d') private readonly inputB5d?: ElementRef<HTMLInputElement>;
  @ViewChild(PropertiesPanel) private readonly propertiesPanel?: PropertiesPanel;
  @ViewChild(LinkingPanel) private readonly linkingPanel?: LinkingPanel;
  @ViewChild(ParametersPanel) private readonly parametersPanel?: ParametersPanel;
  @ViewChild(ParametersReportPanel) private readonly parametersReportPanel?: ParametersReportPanel;
  @ViewChild(BoqPanel) private readonly boqPanel?: BoqPanel;
  private readonly defaultDockedTopWithToolbar = 114;
  private readonly defaultDockedTopWithoutToolbar = 34;
  private readonly defaultTreeDockedWidth = 360;
  private readonly defaultBottomDockedHeight = 280;
  private readonly projectImportPollIntervalMs = 2000;
  private readonly projectImportTimeoutMs = 20 * 60 * 1000;

  readonly visorIfc = inject(VisorIfc);
  readonly backendAuth = inject(BackendAuthService);
  readonly backendProyectos = inject(BackendProyectosService);
  readonly ifcFileCache = inject(IfcFileCacheService);
  readonly localViewerSync = inject(LocalViewerSyncService);
  readonly i18n = inject(I18nService);
  readonly globalTranslations = GLOBAL_TRANSLATIONS;
  readonly loadingPanel = inject(LoadingPanelService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  readonly cuantificacion = signal<NodoCuantificacion | null>(null);
  readonly ifcElements = signal<ElementoIfcB5D[]>([]);
  readonly sharedIfcSelectionLocalIds = signal<number[]>([]);
  readonly sharedSelectionInfo = signal<InformacionElementoSeleccionado | null>(null);
  readonly proyectoB5dActivo = signal<ProyectoTrabajoOrm | null>(null);
  readonly b5dConcepts = signal<ConceptoB5DOrm[]>([]);
  readonly b5dConceptKeys = computed(() =>
    this.b5dConcepts()
      .map((conceptItem) => (conceptItem.clave ?? '').trim())
      .filter((conceptKey) => !!conceptKey),
  );
  readonly b5dLinks = signal<VinculoConceptoBimOrm[]>([]);
  readonly b5dCatalogs = signal<CatalogoB5DOrm[]>([]);
  readonly cuantificacionesB5d = signal<CuantificacionB5DOrm[]>([]);
  readonly parametrosB5d = signal<ParametroB5DOrm[]>([]);
  readonly b5dCargando = signal(false);
  readonly b5dMensaje = signal('');
  readonly usuarioSesion = signal<UsuarioSesionOrm | null>(null);
  readonly importDebugTrace = signal<string[]>([]);
  readonly catalogStructureDialogVisible = signal(false);
  readonly catalogStructureDialogMode = signal<'create' | 'info'>('create');
  readonly catalogStructureDialogCatalog = signal<CatalogoB5DOrm | null>(null);
  readonly catalogStructureDialogLoading = signal(false);
  readonly parameterImportDialogVisible = signal(false);
  readonly parameterB5dImportDialogVisible = signal(false);
  readonly parameterXdbImportDialogVisible = signal(false);
  private readonly catalogLinkCopySourceByTargetId = new Map<number, number>();
  private backendImportTraceCount = 0;
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
  readonly modelLightingEnabled = signal(false);
  readonly windowMode = signal<ViewerWindowMode>(this.restoreWindowMode());
  readonly bottomPanelTab = signal<BottomPanelTab>('links');
  readonly bottomPanelTabs: { id: BottomPanelTab; label: string }[] = [
    { id: 'links', label: 'Estructura de conceptos' },
    { id: 'boq', label: 'Cuantificaciones' },
    { id: 'parameters', label: 'Parametros' },
    { id: 'report', label: 'Reporte' },
  ];
  treeSectionHeight = 220;
  private readonly cuantificadorB5D = new CuantificadorB5D();
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly localViewerSyncSubscription: Subscription = this.localViewerSync.messages$.subscribe((message) => {
    void this.handleLocalViewerSyncMessage(message);
  });
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
  private readonly b5dMessageEffect = effect(() => {
    this.scheduleB5dMessageClear(this.b5dMensaje());
  });
  private readonly localViewerSelectionSyncEffect = effect(() => {
    const selectionMap = this.visorIfc.seleccionActual();
    if (this.windowMode() !== 'viewer' || !this.localViewerSyncReady || this.suppressLocalViewerBroadcast || !this.ifcElements().length) return;

    const localIds = this.extractSelectedLocalIds(selectionMap);
    const selectedElementInfo = this.visorIfc.informacionSeleccionada();
    this.sharedIfcSelectionLocalIds.set(localIds);
    this.sharedSelectionInfo.set(selectedElementInfo ? { ...selectedElementInfo } : null);
    this.localViewerSync.broadcastSelection(localIds, selectedElementInfo);
  });
  private nextFloatingPanelZIndex = 40;
  private autoSaveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private b5dMessageTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private autoSaveInProgress = false;
  private hasPendingDraftChanges = false;
  private draftChangeVersion = 0;
  private measurementVolumeRequestId = 0;
  private localViewerSyncReady = false;
  private suppressLocalViewerBroadcast = false;
  private processingLocalViewerSyncMessages = false;
  private pendingLocalViewerSyncMessages: LocalViewerSyncMessage[] = [];
  private readonly viewerWindowModeStorageKey = 'b5d-viewer-window-mode';
  private lastPersistedViewerUiState = '';
  private pendingViewerUiState: ViewerUiState | null = null;
  private persistedLinkingPanelUiStateApplied = false;
  private persistedBoqPanelUiStateApplied = false;
  private persistedParametersPanelUiStateApplied = false;
  private persistedPropertiesPanelUiStateApplied = false;
  private lastLoadedIfcFile: File | null = null;

  get uiStorageScopeKey(): string {
    const userId = this.usuarioSesion()?.id;
    return userId != null ? `user-${userId}` : 'anonymous';
  }

  private get viewerUiStateStorageKey(): string {
    return buildScopedStorageKey('b5d-viewer-ui-state', this.uiStorageScopeKey);
  }

  ngOnInit(): void {
    this.debugB5d('ngOnInit: start', {
      windowMode: this.windowMode(),
    });
    this.restoreViewerUiState();
    this.debugB5d('ngOnInit: ui state restored', {
      bottomPanelTab: this.bottomPanelTab(),
      treeSectionHeight: this.treeSectionHeight,
      pendingViewerUiState: !!this.pendingViewerUiState,
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.debugB5d('ngAfterViewInit: start', {
      isBrowser: this.isBrowser,
      windowMode: this.windowMode(),
      hasContainer: !!this.contenedorVisor?.nativeElement,
      localViewerSyncReady: this.localViewerSyncReady,
    });
    if (!this.isBrowser) return;

    try {
      if (this.windowMode() === 'viewer' && this.contenedorVisor?.nativeElement) {
        this.debugB5d('ngAfterViewInit: initializing viewer canvas');
        await this.initializeViewerCanvas();
      }

      this.debugB5d('ngAfterViewInit: initializing panels');
      await this.withTimeout(
        this.inicializarPanelesB5d(),
        30000,
        'La carga de paneles B5D no termino en 30 segundos.',
      );

      this.localViewerSyncReady = true;
      this.debugB5d('ngAfterViewInit: localViewerSyncReady true');
      await this.processPendingLocalViewerSyncMessages();
      this.applyPersistedViewerUiState();
    } catch {
      // Mantiene la pantalla limpia; el estado de carga del visor ya refleja el fallo.
    } finally {
      if (this.windowMode() === 'viewer' || this.visorIfc.mundoActual) {
        this.visorIfc.cargando.set(false);
        this.visorIfc.loadingStage.set(null);
      }
    }
  }

  ngAfterViewChecked(): void {
    if (!this.isBrowser) return;
    this.applyPersistedViewerUiState();
    this.persistViewerUiState();
  }

  ngOnDestroy(): void {
    this.debugB5d('ngOnDestroy: start', {
      autoSavePending: !!this.autoSaveTimeoutId,
      messageClearPending: !!this.b5dMessageTimeoutId,
      localViewerSyncReady: this.localViewerSyncReady,
      pendingSyncMessages: this.pendingLocalViewerSyncMessages.length,
    });
    if (this.autoSaveTimeoutId) {
      clearTimeout(this.autoSaveTimeoutId);
      this.autoSaveTimeoutId = null;
    }
    if (this.b5dMessageTimeoutId) {
      clearTimeout(this.b5dMessageTimeoutId);
      this.b5dMessageTimeoutId = null;
    }
    this.localViewerSyncSubscription.unsubscribe();
    this.visorIfc.destruirVisor();
  }

  // Loads an IFC file locally and mirrors it to the other browser tabs.
  async cargarArchivo(archivo: File): Promise<void> {
    const projectId = this.proyectoB5dActivo()?.id ?? null;
    this.debugB5d('cargarArchivo: start', {
      fileName: archivo.name,
      fileType: archivo.type,
      fileSize: archivo.size,
      projectId,
      windowMode: this.windowMode(),
      suppressLocalViewerBroadcast: this.suppressLocalViewerBroadcast,
    });
    if (projectId != null) {
      void this.ifcFileCache.save(projectId, archivo);
    }

    if (this.windowMode() === 'control' && !this.visorIfc.mundoActual) {
      this.lastLoadedIfcFile = archivo;
      this.sharedIfcSelectionLocalIds.set([]);
      this.sharedSelectionInfo.set(null);
      if (!this.suppressLocalViewerBroadcast) {
        this.localViewerSync.broadcastIfcFile(archivo);
      }
      return;
    }

    if (!this.visorIfc.mundoActual) {
      const initialized = await this.initializeViewerCanvas();
      if (!initialized) return;
    }

    const previousBroadcastSuppressed = this.suppressLocalViewerBroadcast;
    this.suppressLocalViewerBroadcast = true;

    try {
      this.lastLoadedIfcFile = archivo;
      this.cuantificacion.set(null);
      this.ifcElements.set([]);
      this.sharedIfcSelectionLocalIds.set([]);
      this.sharedSelectionInfo.set(null);
      await this.visorIfc.cargarArchivoIfc(archivo);
      const ifcElements = this.visorIfc.obtenerElementosB5D();
      this.ifcElements.set(ifcElements);
      this.localViewerSync.broadcastIfcElements(ifcElements);
      await this.actualizarReferenciaIfc(archivo);
    } finally {
      this.suppressLocalViewerBroadcast = previousBroadcastSuppressed;
    }

    if (!previousBroadcastSuppressed) {
      this.localViewerSync.broadcastIfcFile(archivo);
    }
    this.debugB5d('cargarArchivo: end', {
      fileName: archivo.name,
      projectId,
      windowMode: this.windowMode(),
    });
  }

  // Handles the local broadcast messages shared across browser tabs.
  private async handleLocalViewerSyncMessage(message: LocalViewerSyncMessage): Promise<void> {
    this.debugB5d('handleLocalViewerSyncMessage: received', {
      kind: message.kind,
      windowMode: this.windowMode(),
      ready: this.localViewerSyncReady,
      processing: this.processingLocalViewerSyncMessages,
      detail:
        message.kind === 'ifc-file'
          ? {
              fileName: message.file.name,
              fileType: message.file.type,
              fileSize: message.file.size,
            }
          : message.kind === 'ifc-clear'
            ? {}
          : message.kind === 'ifc-elements'
            ? { count: message.ifcElements.length }
            : message.kind === 'ifc-selection'
              ? {
                  count: message.localIds.length,
                  hasSelectedElementInfo: !!message.selectedElementInfo,
                }
              : {
                  enabled: message.enabled,
                },
    });
    if (!this.localViewerSyncReady || this.processingLocalViewerSyncMessages) {
      this.pendingLocalViewerSyncMessages.push(message);
      return;
    }

    this.pendingLocalViewerSyncMessages.push(message);
    await this.processPendingLocalViewerSyncMessages();
  }

  // Applies queued local broadcast messages in the order they were received.
  private async processPendingLocalViewerSyncMessages(): Promise<void> {
    if (!this.localViewerSyncReady || this.processingLocalViewerSyncMessages) return;

    this.processingLocalViewerSyncMessages = true;
    try {
      this.debugB5d('processPendingLocalViewerSyncMessages: start', {
        pending: this.pendingLocalViewerSyncMessages.length,
      });
      while (this.pendingLocalViewerSyncMessages.length) {
        const pendingMessage = this.pendingLocalViewerSyncMessages.shift();
        if (!pendingMessage) continue;
        this.debugB5d('processPendingLocalViewerSyncMessages: applying message', {
          kind: pendingMessage.kind,
        });

        if (pendingMessage.kind === 'ifc-file') {
          await this.applyRemoteIfcFile(pendingMessage.file);
        } else if (pendingMessage.kind === 'ifc-clear') {
          await this.applyRemoteIfcClear();
        } else if (pendingMessage.kind === 'ifc-elements') {
          this.applyRemoteIfcElements(pendingMessage.ifcElements);
        } else if (pendingMessage.kind === 'ifc-selection') {
          await this.applyRemoteIfcSelection(pendingMessage.localIds, pendingMessage.selectedElementInfo);
        } else if (pendingMessage.kind === 'viewer-lighting') {
          this.applyRemoteModelLighting(pendingMessage.enabled);
        }
      }
    } finally {
      this.processingLocalViewerSyncMessages = false;
    }
  }

  // Loads an IFC file received from another browser tab without rebroadcasting it.
  private async applyRemoteIfcFile(file: File): Promise<void> {
    const projectId = this.proyectoB5dActivo()?.id ?? null;
    this.debugB5d('applyRemoteIfcFile: start', {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      projectId,
      windowMode: this.windowMode(),
    });
    if (projectId != null) {
      void this.ifcFileCache.save(projectId, file);
    }
    this.lastLoadedIfcFile = file;

    if (this.windowMode() === 'control' && !this.visorIfc.mundoActual) {
      this.sharedIfcSelectionLocalIds.set([]);
      this.sharedSelectionInfo.set(null);
      return;
    }

    if (!this.visorIfc.mundoActual) {
      const initialized = await this.initializeViewerCanvas();
      if (!initialized) return;
    }

    const previousBroadcastSuppressed = this.suppressLocalViewerBroadcast;
    this.suppressLocalViewerBroadcast = true;

    try {
      await this.cargarArchivo(file);
    } finally {
      this.suppressLocalViewerBroadcast = previousBroadcastSuppressed;
    }
    this.debugB5d('applyRemoteIfcFile: end', {
      fileName: file.name,
      projectId,
      windowMode: this.windowMode(),
    });
  }

  // Clears the current IFC file and mirrored IFC state in the active window.
  private async applyRemoteIfcClear(): Promise<void> {
    this.debugB5d('applyRemoteIfcClear: start', {
      windowMode: this.windowMode(),
      hasWorld: !!this.visorIfc.mundoActual,
      hasLastLoadedFile: !!this.lastLoadedIfcFile,
    });
    this.lastLoadedIfcFile = null;
    this.cuantificacion.set(null);
    this.ifcElements.set([]);
    this.sharedIfcSelectionLocalIds.set([]);
    this.sharedSelectionInfo.set(null);

    if (this.visorIfc.mundoActual) {
      this.visorIfc.destruirVisor();
    }

    this.debugB5d('applyRemoteIfcClear: end', {
      windowMode: this.windowMode(),
      hasWorld: !!this.visorIfc.mundoActual,
    });
  }

  // Stores mirrored IFC rows from another window without forcing the viewer canvas to load.
  private applyRemoteIfcElements(ifcElements: ElementoIfcB5D[]): void {
    this.debugB5d('applyRemoteIfcElements: update', {
      count: ifcElements.length,
      windowMode: this.windowMode(),
    });
    this.ifcElements.set([...ifcElements]);
  }

  // Replays a remote selection in the current IFC viewer.
  private async applyRemoteIfcSelection(localIds: number[], selectedElementInfo: InformacionElementoSeleccionado | null): Promise<void> {
    this.debugB5d('applyRemoteIfcSelection: start', {
      count: localIds.length,
      hasSelectedElementInfo: !!selectedElementInfo,
      windowMode: this.windowMode(),
      hasWorld: !!this.visorIfc.mundoActual,
    });
    this.sharedIfcSelectionLocalIds.set([...new Set(localIds)]);
    this.sharedSelectionInfo.set(selectedElementInfo ? { ...selectedElementInfo } : null);

    if (this.windowMode() === 'control' && !this.visorIfc.mundoActual) {
      return;
    }

    if (!this.visorIfc.mundoActual) {
      const initialized = await this.initializeViewerCanvas();
      if (!initialized) return;
    }

    const previousBroadcastSuppressed = this.suppressLocalViewerBroadcast;
    this.suppressLocalViewerBroadcast = true;

    try {
      if (!localIds.length) {
        await this.visorIfc.limpiarSeleccion();
      } else {
        await this.visorIfc.seleccionarElementosPorLocalIds(localIds);
      }
    } finally {
      this.suppressLocalViewerBroadcast = previousBroadcastSuppressed;
    }
    this.debugB5d('applyRemoteIfcSelection: end', {
      count: localIds.length,
      windowMode: this.windowMode(),
    });
  }

  // Replays the viewer lighting preset received from another browser tab.
  private applyRemoteModelLighting(enabled: boolean): void {
    this.debugB5d('applyRemoteModelLighting: update', {
      enabled,
      windowMode: this.windowMode(),
      hasWorld: !!this.visorIfc.mundoActual,
    });
    this.setModelLightingEnabled(enabled, false);
  }

  // Updates the viewer lighting preset and optionally mirrors it to the other tabs.
  private setModelLightingEnabled(enabled: boolean, broadcast = true): void {
    this.modelLightingEnabled.set(enabled);
    this.visorIfc.setModelLightingEnabled(enabled);

    if (broadcast && this.localViewerSyncReady && !this.suppressLocalViewerBroadcast) {
      this.localViewerSync.broadcastModelLighting(enabled);
    }
  }

  // Toggles the viewer lighting preset.
  private toggleModelLighting(): void {
    this.setModelLightingEnabled(!this.modelLightingEnabled());
  }

  // Extracts a flat, de-duplicated list of selected local identifiers.
  private extractSelectedLocalIds(selectionMap: Record<string, Set<number>>): number[] {
    const localIds = new Set<number>();
    for (const localIdSet of Object.values(selectionMap)) {
      for (const localId of localIdSet) {
        if (Number.isInteger(localId) && localId > 0) {
          localIds.add(localId);
        }
      }
    }
    return [...localIds].sort((first, second) => first - second);
  }

  async abrirSelectorImportacionB5d(): Promise<void> {
    if (!(await this.asegurarSesionBackend())) return;
    this.inputB5d?.nativeElement.click();
  }

  async quitarArchivoIfcCargado(): Promise<void> {
    this.debugB5d('quitarArchivoIfcCargado: start', {
      projectId: this.proyectoB5dActivo()?.id ?? null,
      hasWorld: !!this.visorIfc.mundoActual,
      hasLastLoadedFile: !!this.lastLoadedIfcFile,
    });

    const projectId = this.proyectoB5dActivo()?.id ?? null;
    if (projectId != null) {
      await this.ifcFileCache.clear(projectId);
    }

    this.lastLoadedIfcFile = null;
    this.cuantificacion.set(null);
    this.ifcElements.set([]);
    this.sharedIfcSelectionLocalIds.set([]);
    this.sharedSelectionInfo.set(null);

    if (this.visorIfc.mundoActual) {
      this.visorIfc.destruirVisor();
    }

    if (this.localViewerSyncReady) {
      this.localViewerSync.broadcastIfcClear();
    }

    this.b5dMensaje.set('Archivo IFC descargado.');
    this.debugB5d('quitarArchivoIfcCargado: end', {
      projectId,
      hasWorld: !!this.visorIfc.mundoActual,
      hasLastLoadedFile: !!this.lastLoadedIfcFile,
    });
  }

  async procesarArchivoB5dSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;

    await this.importarProyectoB5d(archivo);
  }

  async irALogin(): Promise<void> {
    this.debugB5d('irALogin: navigating to /login');
    if (this.usuarioSesion()) {
      try {
        await firstValueFrom(this.backendAuth.logout());
      } catch {
        // Ignora error de logout y continua con redireccion.
      }
      this.usuarioSesion.set(null);
    }
    await this.router.navigate(['/login'], { replaceUrl: true });
  }

  async cerrarSesionBackend(): Promise<void> {
    this.debugB5d('cerrarSesionBackend: start');
    try {
      await firstValueFrom(this.backendAuth.logout());
    } finally {
      this.debugB5d('cerrarSesionBackend: session cleared and redirecting');
      this.usuarioSesion.set(null);
      this.proyectoB5dActivo.set(null);
      this.b5dConcepts.set([]);
      this.b5dLinks.set([]);
      this.b5dCatalogs.set([]);
      this.cuantificacionesB5d.set([]);
      this.parametrosB5d.set([]);
      this.b5dMensaje.set('Sesion cerrada.');
      await this.router.navigate(['/login'], { replaceUrl: true });
    }
  }

  cuantificarB5D(): void {
    const elementos = this.ifcElements();

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
      await this.router.navigate(['/login'], { replaceUrl: true });
      return;
    }
    this.debugB5d('inicializarPanelesB5d: session OK, loading recent project');
    await this.cargarProyectoReciente();
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async asegurarSesionBackend(): Promise<boolean> {
    try {
      this.debugB5d('asegurarSesionBackend: calling /api/auth/me');
      const sesion = await firstValueFrom(this.backendAuth.me());
      this.debugB5d('asegurarSesionBackend: response received', sesion);
      if (!sesion.authenticated || !sesion.user) {
        this.debugB5d('asegurarSesionBackend: unauthenticated response, redirect expected');
        this.usuarioSesion.set(null);
        this.b5dMensaje.set('Sesion no iniciada.');
        return false;
      }
      this.usuarioSesion.set(sesion.user);
      this.restoreViewerUiState();
      return true;
    } catch (error) {
      this.debugB5d('asegurarSesionBackend: error', error);
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
      const proyectos = await firstValueFrom(this.backendProyectos.listarProyectos());
      const proyecto = proyectos.resultados[0] ?? null;
      this.debugB5d('cargarProyectoReciente: active project selected', {
        projectId: proyecto?.id ?? null,
        projectName: proyecto?.nombre ?? null,
      });
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

      if (proyecto.estado === 'importando') {
        this.debugB5d('cargarProyectoReciente: waiting for importing project', proyecto.id);
        await this.esperarProyectoImportado(proyecto.id);
      }

      this.debugB5d('cargarProyectoReciente: loading active project data', proyecto.id);
      await this.cargarDatosProyectoB5d(proyecto.id);
      await this.restorePersistedIfcFileForProject(proyecto.id);
      this.debugB5d('cargarProyectoReciente: project data loaded');
    } catch (error) {
      this.debugB5d('cargarProyectoReciente: error', error);
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo consultar la lista de proyectos B5D.'));
    } finally {
      this.debugB5d('cargarProyectoReciente: end');
      this.b5dCargando.set(false);
    }
  }

  private restoreViewerUiState(): void {
    if (!this.isBrowser || typeof window === 'undefined') return;

    this.lastPersistedViewerUiState = '';
    this.persistedLinkingPanelUiStateApplied = false;
    this.persistedBoqPanelUiStateApplied = false;
    this.persistedParametersPanelUiStateApplied = false;
    this.persistedPropertiesPanelUiStateApplied = false;

    try {
      const storage = getSafeLocalStorage();
      const raw = storage?.getItem(this.viewerUiStateStorageKey) ?? null;
      if (!raw) return;
      const parsed = JSON.parse(raw) as ViewerUiState | null;
      if (!parsed || typeof parsed !== 'object') return;

      this.pendingViewerUiState = parsed;
      this.debugB5d('restoreViewerUiState: parsed', parsed);
      const restoredBottomPanelTab = parsed.bottomPanelTab;
      if (
        restoredBottomPanelTab === 'links' ||
        restoredBottomPanelTab === 'boq' ||
        restoredBottomPanelTab === 'parameters' ||
        restoredBottomPanelTab === 'report'
      ) {
        this.bottomPanelTab.set(restoredBottomPanelTab);
        this.homeToolbarState.update((state) => ({
          ...state,
          activeBottomTab: restoredBottomPanelTab,
        }));
      }
      if (typeof parsed.treeSectionHeight === 'number' && Number.isFinite(parsed.treeSectionHeight)) {
        this.treeSectionHeight = parsed.treeSectionHeight;
      }
      if (typeof parsed.toolbarContentVisible === 'boolean') {
        this.toolbarContentVisible.set(parsed.toolbarContentVisible);
      }
      if (typeof parsed.modelLightingEnabled === 'boolean') {
        this.setModelLightingEnabled(parsed.modelLightingEnabled, false);
      }
      if (typeof parsed.selectedCatalogId === 'number' && Number.isFinite(parsed.selectedCatalogId)) {
        this.homeToolbarState.update((state) => ({
          ...state,
          selectedCatalogId: parsed.selectedCatalogId ?? null,
        }));
      } else if (parsed.selectedCatalogId === null) {
        this.homeToolbarState.update((state) => ({
          ...state,
          selectedCatalogId: null,
        }));
      }
      if (typeof parsed.tableFiltersVisible === 'boolean') {
        this.homeToolbarState.update((state) => ({
          ...state,
          tableFiltersVisible: parsed.tableFiltersVisible,
        }));
      }
      const linkingPanelState = parsed.linkingPanel;
      if (
        linkingPanelState &&
        (linkingPanelState.activeWorkspacePanel === 'concepts' ||
          linkingPanelState.activeWorkspacePanel === 'ifc-objects' ||
          linkingPanelState.activeWorkspacePanel === 'related-links')
      ) {
        const restoredActiveWorkspacePanel = linkingPanelState.activeWorkspacePanel;
        this.homeToolbarState.update((state) => ({
          ...state,
          activePanel: restoredActiveWorkspacePanel,
        }));
      }
      const floatingPanels = this.restoreFloatingPanelsState(parsed.floatingPanels);
      if (floatingPanels) {
        this.floatingPanels.set(floatingPanels);
      }
    } catch {
      this.pendingViewerUiState = null;
    }
  }

  private restoreFloatingPanelsState(
    persistedPanels: ViewerUiState['floatingPanels'],
  ): Record<FloatingPanelId, FloatingPanelState> | null {
    if (!persistedPanels || typeof persistedPanels !== 'object') return null;

    const nextPanels = { ...this.floatingPanels() };
    const panelIds: FloatingPanelId[] = ['tree', 'models', 'properties', 'bottom'];

    for (const panelId of panelIds) {
      const rawPanel = (persistedPanels as Partial<Record<FloatingPanelId, Partial<FloatingPanelState>>>)[panelId];
      if (!rawPanel || typeof rawPanel !== 'object') continue;

      const currentPanel = nextPanels[panelId];
      nextPanels[panelId] = {
        visible: typeof rawPanel.visible === 'boolean' ? rawPanel.visible : currentPanel.visible,
        docked: typeof rawPanel.docked === 'boolean' ? rawPanel.docked : currentPanel.docked,
        dockSide:
          rawPanel.dockSide === 'left' || rawPanel.dockSide === 'right' || rawPanel.dockSide === 'bottom'
            ? rawPanel.dockSide
            : currentPanel.dockSide,
        left: typeof rawPanel.left === 'number' && Number.isFinite(rawPanel.left) ? rawPanel.left : currentPanel.left,
        top: typeof rawPanel.top === 'number' && Number.isFinite(rawPanel.top) ? rawPanel.top : currentPanel.top,
        width: typeof rawPanel.width === 'number' && Number.isFinite(rawPanel.width) ? rawPanel.width : currentPanel.width,
        height: typeof rawPanel.height === 'number' && Number.isFinite(rawPanel.height) ? rawPanel.height : currentPanel.height,
        zIndex: typeof rawPanel.zIndex === 'number' && Number.isFinite(rawPanel.zIndex) ? rawPanel.zIndex : currentPanel.zIndex,
      };
    }

    return nextPanels;
  }

  private restoreWindowMode(): ViewerWindowMode {
    if (!this.isBrowser || typeof window === 'undefined') return 'viewer';

    try {
      const storage = getSafeSessionStorage();
      const raw = storage?.getItem('b5d-viewer-window-mode') ?? null;
      this.debugB5d('restoreWindowMode: raw value', { raw });
      return raw === 'control' ? 'control' : 'viewer';
    } catch {
      return 'viewer';
    }
  }

  private async initializeViewerCanvas(): Promise<boolean> {
    if (!this.isBrowser || !this.contenedorVisor?.nativeElement) return false;
    if (this.visorIfc.mundoActual) return true;

    this.debugB5d('initializeViewerCanvas: start', {
      hasContainer: !!this.contenedorVisor?.nativeElement,
      hasWorld: !!this.visorIfc.mundoActual,
      hasLastLoadedFile: !!this.lastLoadedIfcFile,
      windowMode: this.windowMode(),
    });
    this.visorIfc.cargando.set(true);
    this.visorIfc.loadingStage.set('reading');

    try {
      await this.withTimeout(
        this.visorIfc.inicializarVisor(this.contenedorVisor.nativeElement),
        30000,
        'El visor IFC no termino de inicializarse en 30 segundos.',
      );
      this.visorIfc.setModelLightingEnabled(this.modelLightingEnabled());

      if (this.lastLoadedIfcFile && this.windowMode() === 'viewer' && !this.visorIfc.modelosIfcCargados().length) {
        const previousBroadcastSuppressed = this.suppressLocalViewerBroadcast;
        this.suppressLocalViewerBroadcast = true;
        try {
          await this.cargarArchivo(this.lastLoadedIfcFile);
        } finally {
          this.suppressLocalViewerBroadcast = previousBroadcastSuppressed;
        }
      }

      return true;
    } catch {
      this.debugB5d('initializeViewerCanvas: failed');
      return false;
    } finally {
      this.visorIfc.cargando.set(false);
      this.visorIfc.loadingStage.set(null);
    }
  }

  private async restoreViewerCanvas(): Promise<void> {
    this.debugB5d('restoreViewerCanvas: start', {
      hasLastLoadedFile: !!this.lastLoadedIfcFile,
      hasWorld: !!this.visorIfc.mundoActual,
      loadedModels: this.visorIfc.modelosIfcCargados().length,
    });
    if (!this.lastLoadedIfcFile) return;
    if (!this.visorIfc.mundoActual) {
      await this.initializeViewerCanvas();
      return;
    }

    if (this.visorIfc.modelosIfcCargados().length) return;

    const previousBroadcastSuppressed = this.suppressLocalViewerBroadcast;
    this.suppressLocalViewerBroadcast = true;
    try {
      await this.cargarArchivo(this.lastLoadedIfcFile);
    } finally {
      this.suppressLocalViewerBroadcast = previousBroadcastSuppressed;
    }
  }

  private async restorePersistedIfcFileForProject(projectId: number): Promise<void> {
    if (this.windowMode() !== 'viewer') return;
    if (this.lastLoadedIfcFile) return;

    this.debugB5d('restorePersistedIfcFileForProject: loading cache', { projectId });
    const cachedFile = await this.ifcFileCache.load(projectId);
    if (!cachedFile) {
      this.debugB5d('restorePersistedIfcFileForProject: no cached file found', { projectId });
      return;
    }

    this.lastLoadedIfcFile = cachedFile;
    await this.restoreViewerCanvas();
  }

  private applyPersistedViewerUiState(): void {
    let shouldDetectChanges = false;
    const linkingState = this.pendingViewerUiState?.linkingPanel ?? null;
    if (!this.persistedLinkingPanelUiStateApplied && this.linkingPanel && linkingState) {
      if (typeof linkingState.leftPanelWidth === 'number' && Number.isFinite(linkingState.leftPanelWidth)) {
        this.linkingPanel.leftPanelWidth = linkingState.leftPanelWidth;
        shouldDetectChanges = true;
      }
      if (typeof linkingState.topPanelHeight === 'number' && Number.isFinite(linkingState.topPanelHeight)) {
        this.linkingPanel.topPanelHeight = linkingState.topPanelHeight;
        shouldDetectChanges = true;
      }
      if (
        Array.isArray(linkingState.topPanelOrder) &&
        linkingState.topPanelOrder.length === 2 &&
        linkingState.topPanelOrder.includes('concepts') &&
        linkingState.topPanelOrder.includes('ifc-objects')
      ) {
        this.linkingPanel.topPanelOrder = [...linkingState.topPanelOrder] as ('concepts' | 'ifc-objects')[];
        shouldDetectChanges = true;
      }
      if (typeof linkingState.conceptPanelZoomPercent === 'number' && Number.isFinite(linkingState.conceptPanelZoomPercent)) {
        this.linkingPanel.conceptPanelZoomPercent = linkingState.conceptPanelZoomPercent;
        shouldDetectChanges = true;
      }
      if (typeof linkingState.objectPanelZoomPercent === 'number' && Number.isFinite(linkingState.objectPanelZoomPercent)) {
        this.linkingPanel.objectPanelZoomPercent = linkingState.objectPanelZoomPercent;
        shouldDetectChanges = true;
      }
      if (
        typeof linkingState.relatedLinksPanelZoomPercent === 'number' &&
        Number.isFinite(linkingState.relatedLinksPanelZoomPercent)
      ) {
        this.linkingPanel.relatedLinksPanelZoomPercent = linkingState.relatedLinksPanelZoomPercent;
        shouldDetectChanges = true;
      }
      if (typeof linkingState.relatedLinksVisible === 'boolean') {
        this.linkingPanel.relatedLinksVisible = linkingState.relatedLinksVisible;
        shouldDetectChanges = true;
      }
      if (typeof linkingState.selectedCatalogId === 'number' && Number.isFinite(linkingState.selectedCatalogId)) {
        this.linkingPanel.setCatalogSelectionFromHost(linkingState.selectedCatalogId);
        shouldDetectChanges = true;
      } else if (linkingState.selectedCatalogId === null) {
        this.linkingPanel.setCatalogSelectionFromHost(null);
        shouldDetectChanges = true;
      }
      if (
        linkingState.activeWorkspacePanel === 'concepts' ||
        linkingState.activeWorkspacePanel === 'ifc-objects' ||
        linkingState.activeWorkspacePanel === 'related-links'
      ) {
        this.linkingPanel.selectActivePanel(linkingState.activeWorkspacePanel);
        shouldDetectChanges = true;
      }
      this.persistedLinkingPanelUiStateApplied = true;
    }

    const boqState = this.pendingViewerUiState?.boqPanel ?? null;
    if (!this.persistedBoqPanelUiStateApplied && this.boqPanel && boqState) {
      if (typeof boqState.leftPanelWidth === 'number' && Number.isFinite(boqState.leftPanelWidth)) {
        this.boqPanel.leftPanelWidth = boqState.leftPanelWidth;
        shouldDetectChanges = true;
      }
      if (
        Array.isArray(boqState.panelOrder) &&
        boqState.panelOrder.length === 2 &&
        boqState.panelOrder.includes('list') &&
        boqState.panelOrder.includes('preview')
      ) {
        this.boqPanel.panelOrder = [...boqState.panelOrder] as ('list' | 'preview')[];
        shouldDetectChanges = true;
      }
      if (typeof boqState.listZoomPercent === 'number' && Number.isFinite(boqState.listZoomPercent)) {
        this.boqPanel.listZoomPercent = boqState.listZoomPercent;
        shouldDetectChanges = true;
      }
      if (typeof boqState.sheetZoomPercent === 'number' && Number.isFinite(boqState.sheetZoomPercent)) {
        this.boqPanel.sheetZoomPercent = boqState.sheetZoomPercent;
        this.boqPanel.sheetZoomInputValue = String(boqState.sheetZoomPercent);
        shouldDetectChanges = true;
      }
      this.persistedBoqPanelUiStateApplied = true;
    }

    const parametersState = this.pendingViewerUiState?.parametersPanel ?? null;
    if (!this.persistedParametersPanelUiStateApplied && this.parametersPanel && parametersState) {
      if (typeof parametersState.parameterListVisible === 'boolean') {
        this.parametersPanel.parameterListVisible = parametersState.parameterListVisible;
        shouldDetectChanges = true;
      }
      if (typeof parametersState.boqPreviewVisible === 'boolean') {
        this.parametersPanel.boqPreviewVisible = parametersState.boqPreviewVisible;
        shouldDetectChanges = true;
      }
      if (typeof parametersState.descriptionMatchesVisible === 'boolean') {
        this.parametersPanel.descriptionMatchesVisible = parametersState.descriptionMatchesVisible;
        shouldDetectChanges = true;
      }
      if (typeof parametersState.analysisVisible === 'boolean') {
        this.parametersPanel.analysisVisible = parametersState.analysisVisible;
        shouldDetectChanges = true;
      }
      if (
        Array.isArray(parametersState.paneOrder) &&
        parametersState.paneOrder.length === 4 &&
        parametersState.paneOrder.includes('parameter-list') &&
        parametersState.paneOrder.includes('boq-preview') &&
        parametersState.paneOrder.includes('description-matches') &&
        parametersState.paneOrder.includes('analysis')
      ) {
        this.parametersPanel.paneOrder = [...parametersState.paneOrder] as (
          | 'parameter-list'
          | 'boq-preview'
          | 'description-matches'
          | 'analysis'
        )[];
        shouldDetectChanges = true;
      }
      if (typeof parametersState.topLeftPaneWidth === 'number' && Number.isFinite(parametersState.topLeftPaneWidth)) {
        this.parametersPanel.topLeftPaneWidth = parametersState.topLeftPaneWidth;
        shouldDetectChanges = true;
      }
      if (typeof parametersState.bottomLeftPaneWidth === 'number' && Number.isFinite(parametersState.bottomLeftPaneWidth)) {
        this.parametersPanel.bottomLeftPaneWidth = parametersState.bottomLeftPaneWidth;
        shouldDetectChanges = true;
      }
      if (typeof parametersState.topWorkspaceHeight === 'number' && Number.isFinite(parametersState.topWorkspaceHeight)) {
        this.parametersPanel.topWorkspaceHeight = parametersState.topWorkspaceHeight;
        shouldDetectChanges = true;
      }
      if (typeof parametersState.parameterListZoomPercent === 'number' && Number.isFinite(parametersState.parameterListZoomPercent)) {
        this.parametersPanel.parameterListZoomPercent = parametersState.parameterListZoomPercent;
        shouldDetectChanges = true;
      }
      if (typeof parametersState.boqPreviewZoomPercent === 'number' && Number.isFinite(parametersState.boqPreviewZoomPercent)) {
        this.parametersPanel.boqPreviewZoomPercent = parametersState.boqPreviewZoomPercent;
        shouldDetectChanges = true;
      }
      if (
        typeof parametersState.descriptionMatchesZoomPercent === 'number' &&
        Number.isFinite(parametersState.descriptionMatchesZoomPercent)
      ) {
        this.parametersPanel.descriptionMatchesZoomPercent = parametersState.descriptionMatchesZoomPercent;
        shouldDetectChanges = true;
      }
      if (typeof parametersState.analysisZoomPercent === 'number' && Number.isFinite(parametersState.analysisZoomPercent)) {
        this.parametersPanel.analysisZoomPercent = parametersState.analysisZoomPercent;
        shouldDetectChanges = true;
      }
      this.persistedParametersPanelUiStateApplied = true;
    }

    const propertiesState = this.pendingViewerUiState?.propertiesPanel ?? null;
    if (!this.persistedPropertiesPanelUiStateApplied && this.propertiesPanel && propertiesState) {
      if (
        propertiesState.activeTab === 'properties' ||
        propertiesState.activeTab === 'location' ||
        propertiesState.activeTab === 'classification' ||
        propertiesState.activeTab === 'relations' ||
        propertiesState.activeTab === 'quantities'
      ) {
        this.propertiesPanel.activeTab = propertiesState.activeTab;
        shouldDetectChanges = true;
      }
      if (propertiesState.seccionesAbiertas && typeof propertiesState.seccionesAbiertas === 'object') {
        this.propertiesPanel.seccionesAbiertas = { ...this.propertiesPanel.seccionesAbiertas, ...propertiesState.seccionesAbiertas };
        shouldDetectChanges = true;
      }
      this.persistedPropertiesPanelUiStateApplied = true;
    }

    if (shouldDetectChanges) {
      this.changeDetectorRef.detectChanges();
    }
  }

  private persistViewerUiState(): void {
    if (!this.isBrowser || typeof window === 'undefined') return;

    const snapshot: ViewerUiState = {
      bottomPanelTab: this.bottomPanelTab(),
      treeSectionHeight: this.treeSectionHeight,
      toolbarContentVisible: this.toolbarContentVisible(),
      modelLightingEnabled: this.modelLightingEnabled(),
      selectedCatalogId: this.homeToolbarState().selectedCatalogId ?? null,
      tableFiltersVisible: this.homeToolbarState().tableFiltersVisible ?? false,
      floatingPanels: this.floatingPanels(),
      linkingPanel: this.linkingPanel
        ? {
            leftPanelWidth: this.linkingPanel.leftPanelWidth,
            topPanelHeight: this.linkingPanel.topPanelHeight,
            topPanelOrder: [...this.linkingPanel.topPanelOrder],
            conceptPanelZoomPercent: this.linkingPanel.conceptPanelZoomPercent,
            objectPanelZoomPercent: this.linkingPanel.objectPanelZoomPercent,
            relatedLinksPanelZoomPercent: this.linkingPanel.relatedLinksPanelZoomPercent,
            relatedLinksVisible: this.linkingPanel.relatedLinksVisible,
            activeWorkspacePanel: this.homeToolbarState().activePanel,
            selectedCatalogId: this.homeToolbarState().selectedCatalogId ?? null,
          }
        : this.pendingViewerUiState?.linkingPanel,
      boqPanel: this.boqPanel
        ? {
            leftPanelWidth: this.boqPanel.leftPanelWidth,
            panelOrder: [...this.boqPanel.panelOrder],
            listZoomPercent: this.boqPanel.listZoomPercent,
            sheetZoomPercent: this.boqPanel.sheetZoomPercent,
          }
        : this.pendingViewerUiState?.boqPanel,
      parametersPanel: this.parametersPanel
        ? {
            parameterListVisible: this.parametersPanel.parameterListVisible,
            boqPreviewVisible: this.parametersPanel.boqPreviewVisible,
            descriptionMatchesVisible: this.parametersPanel.descriptionMatchesVisible,
            analysisVisible: this.parametersPanel.analysisVisible,
            paneOrder: [...this.parametersPanel.paneOrder],
            topLeftPaneWidth: this.parametersPanel.topLeftPaneWidth,
            bottomLeftPaneWidth: this.parametersPanel.bottomLeftPaneWidth,
            topWorkspaceHeight: this.parametersPanel.topWorkspaceHeight,
            parameterListZoomPercent: this.parametersPanel.parameterListZoomPercent,
            boqPreviewZoomPercent: this.parametersPanel.boqPreviewZoomPercent,
            descriptionMatchesZoomPercent: this.parametersPanel.descriptionMatchesZoomPercent,
            analysisZoomPercent: this.parametersPanel.analysisZoomPercent,
          }
        : this.pendingViewerUiState?.parametersPanel,
      propertiesPanel: this.propertiesPanel
        ? {
            activeTab: this.propertiesPanel.activeTab,
            seccionesAbiertas: { ...this.propertiesPanel.seccionesAbiertas },
          }
        : this.pendingViewerUiState?.propertiesPanel,
    };

    const serialized = JSON.stringify(snapshot);
    if (serialized === this.lastPersistedViewerUiState) return;

    try {
      getSafeLocalStorage()?.setItem(this.viewerUiStateStorageKey, serialized);
      this.lastPersistedViewerUiState = serialized;
    } catch {
      // Ignore persistence errors.
    }
  }

  private async importarProyectoB5d(archivo: File): Promise<void> {
    const inicioImportacion = performance.now();
    const loadingSessionId = this.loadingPanel.start(
      createB5dImportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.importB5dProject')),
    );
    this.b5dCargando.set(true);
    this.b5dMensaje.set('');
    this.clearImportDebugTrace();
    this.debugB5d('importarProyectoB5d: request start', {
      fileName: archivo.name,
      fileSize: archivo.size,
    });
    try {
      const proyecto = await firstValueFrom(
        this.backendProyectos.importarProyecto({
          archivo,
          nombre: archivo.name,
          sincrono: false,
        }),
      );
      this.loadingPanel.completeStep(loadingSessionId, 'uploading', 'Archivo B5D recibido.');
      this.debugB5d('importarProyectoB5d: upload request resolved', {
        projectId: proyecto.id,
        elapsedMs: Math.round(performance.now() - inicioImportacion),
      });
      const proyectoImportado = await this.esperarProyectoImportado(proyecto.id, loadingSessionId);
      this.loadingPanel.completeStep(loadingSessionId, 'processing', 'Proyecto B5D procesado.');
      this.proyectoB5dActivo.set(proyectoImportado);
      await this.cargarDatosProyectoB5d(proyectoImportado.id);
      this.loadingPanel.completeStep(loadingSessionId, 'refreshing', 'Vista actualizada.');
      this.debugB5d('importarProyectoB5d: import completed', {
        projectId: proyectoImportado.id,
        elapsedMs: Math.round(performance.now() - inicioImportacion),
      });
      this.b5dMensaje.set(`Proyecto importado: ${proyectoImportado.nombre} (ID ${proyectoImportado.id}).`);
    } catch (error) {
      this.debugB5d('importarProyectoB5d: import failed', {
        elapsedMs: Math.round(performance.now() - inicioImportacion),
        error,
      });
      this.loadingPanel.abort(loadingSessionId);
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo importar el archivo B5D.'));
    } finally {
      this.b5dCargando.set(false);
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, 'Proyecto importado.');
      }
    }
  }

  private async esperarProyectoImportado(proyectoId: number, loadingSessionId?: number): Promise<ProyectoTrabajoOrm> {
    return this.withTimeout(
      this.esperarProyectoEnEstadoSinTimeout(proyectoId, 'importando', 'processing', loadingSessionId),
      this.projectImportTimeoutMs,
      'La importacion del proyecto esta tardando demasiado. Vuelve a intentarlo en unos minutos.',
    );
  }

  private async esperarProyectoExportado(proyectoId: number, loadingSessionId?: number): Promise<ProyectoTrabajoOrm> {
    return this.withTimeout(
      this.esperarProyectoEnEstadoSinTimeout(proyectoId, 'exportando', 'downloading', loadingSessionId),
      this.projectImportTimeoutMs,
      'La exportacion del proyecto esta tardando demasiado. Vuelve a intentarlo en unos minutos.',
    );
  }

  private async esperarProyectoEnEstadoSinTimeout(
    proyectoId: number,
    estadoEnCurso: 'importando' | 'exportando',
    loadingStepId: 'processing' | 'downloading',
    loadingSessionId?: number,
  ): Promise<ProyectoTrabajoOrm> {
    const inicioEspera = performance.now();
    let pollCount = 0;
    this.appendImportDebugTrace(`esperando /estado para proyecto ${proyectoId}...`);
    while (true) {
      pollCount += 1;
      const proyecto = await firstValueFrom(this.backendProyectos.consultarEstadoProyecto(proyectoId));
      this.proyectoB5dActivo.set(proyecto);
      const backendTrace = proyecto.debug_trace ?? [];
      if (backendTrace.length < this.backendImportTraceCount) {
        this.backendImportTraceCount = 0;
      }
      for (const line of backendTrace.slice(this.backendImportTraceCount)) {
        this.appendImportDebugTrace(`backend: ${line}`);
      }
      this.backendImportTraceCount = backendTrace.length;
      this.debugB5d('esperarProyectoEnEstado: poll', {
        projectId: proyectoId,
        pollCount,
        estado: proyecto.estado,
        registrosImportados: proyecto.registros_importados,
        totalRegistros: proyecto.total_registros,
        progresoPorcentaje: proyecto.progreso_porcentaje,
        mensajeProgreso: proyecto.mensaje_progreso,
        elapsedMs: Math.round(performance.now() - inicioEspera),
      });
      this.appendImportDebugTrace(
        `poll ${pollCount}: estado=${proyecto.estado ?? '-'} progreso=${Math.max(0, Math.min(100, proyecto.progreso_porcentaje ?? 0)).toFixed(0)}% registros=${proyecto.registros_importados ?? 0}/${proyecto.total_registros ?? 0} mensaje=${(proyecto.mensaje_progreso ?? '').trim() || '-'}`,
      );

      if (proyecto.estado !== estadoEnCurso) {
        const mensajeError = proyecto.mensaje_error?.trim();
        if (mensajeError) {
          this.appendImportDebugTrace(`fin con error: ${mensajeError}`);
          throw new Error(mensajeError);
        }
        this.appendImportDebugTrace(`fin con estado=${proyecto.estado ?? '-'}`);
        return proyecto;
      }

      const mensajeProgreso = proyecto.mensaje_progreso?.trim() || (estadoEnCurso === 'importando' ? 'Importando proyecto B5D...' : 'Exportando proyecto B5D...');
      const progreso = Math.max(0, Math.min(100, proyecto.progreso_porcentaje ?? 0));
      this.b5dMensaje.set(mensajeProgreso);
      if (loadingSessionId) {
        this.loadingPanel.setStepProgress(loadingSessionId, loadingStepId, progreso, mensajeProgreso);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, this.projectImportPollIntervalMs));
    }
  }

  private async exportarProyectoB5dActivo(): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay proyecto B5D activo para exportar.');
      return;
    }

    const loadingSessionId = this.loadingPanel.start(
      createB5dExportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.exportB5dProject')),
    );
    this.b5dCargando.set(true);
    this.b5dMensaje.set('');
    try {
      this.loadingPanel.completeStep(loadingSessionId, 'preparing', 'Preparando exportación B5D.');
      const exportando = await firstValueFrom(this.backendProyectos.exportarProyecto(proyecto.id));
      const exportado = await this.esperarProyectoExportado(exportando.id, loadingSessionId);
      this.loadingPanel.completeStep(loadingSessionId, 'downloading', 'Archivo B5D listo para descargar.');
      this.proyectoB5dActivo.set(exportado);
      await this.cargarDatosProyectoB5d(exportado.id);
      const blob = await firstValueFrom(this.backendProyectos.descargarProyecto(exportado.id));
      this.descargarBlob(blob, `proyecto-${exportado.id}.b5d`);
      this.loadingPanel.completeStep(loadingSessionId, 'refreshing', 'Vista actualizada.');
      this.b5dMensaje.set(`Proyecto exportado correctamente (ID ${exportado.id}).`);
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo exportar el proyecto B5D.'));
    } finally {
      this.b5dCargando.set(false);
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, 'Proyecto exportado.');
      }
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

    const loadingSessionId = this.loadingPanel.start(
      createB5dExportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.exportB5dProject')),
    );
    this.b5dCargando.set(true);
    this.b5dMensaje.set('');
    try {
      await this.flushPendingAutoSave(proyecto.id);
      this.loadingPanel.completeStep(loadingSessionId, 'preparing', 'Preparando exportación B5D.');

      const proyectoEnExportacion = await firstValueFrom(this.backendProyectos.exportarProyecto(proyecto.id));
      const proyectoExportado = await this.esperarProyectoExportado(proyectoEnExportacion.id, loadingSessionId);
      this.loadingPanel.completeStep(loadingSessionId, 'downloading', 'Archivo B5D listo para descargar.');
      this.proyectoB5dActivo.set(proyectoExportado);
      await this.cargarDatosProyectoB5d(proyectoExportado.id);

      const archivoExportado = await firstValueFrom(this.backendProyectos.descargarProyecto(proyectoExportado.id));
      this.descargarBlob(archivoExportado, `proyecto-${proyectoExportado.id}.b5d`);
      this.loadingPanel.completeStep(loadingSessionId, 'refreshing', 'Vista actualizada.');
      this.b5dMensaje.set(`Proyecto exportado correctamente (ID ${proyectoExportado.id}).`);
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo exportar el proyecto B5D.'));
    } finally {
      this.b5dCargando.set(false);
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, 'Proyecto exportado.');
      }
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

  // Opens the B5D-based parameter import wizard.
  abrirDialogoImportacionParametrosB5d(): void {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay un proyecto B5D activo para importar parametros.');
      return;
    }

    this.parameterB5dImportDialogVisible.set(true);
    this.b5dMensaje.set('');
  }

  // Opens the XDB-based parameter import wizard.
  abrirDialogoImportacionParametrosXdb(): void {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay un proyecto B5D activo para importar parametros.');
      return;
    }

    this.parameterXdbImportDialogVisible.set(true);
    this.b5dMensaje.set('');
  }

  // Closes the parameter import wizard.
  cerrarDialogoImportacionParametros(): void {
    this.parameterImportDialogVisible.set(false);
  }

  // Closes the B5D parameter import wizard.
  cerrarDialogoImportacionParametrosB5d(): void {
    this.parameterB5dImportDialogVisible.set(false);
  }

  // Closes the XDB parameter import wizard.
  cerrarDialogoImportacionParametrosXdb(): void {
    this.parameterXdbImportDialogVisible.set(false);
  }

  // Imports a PlanAXA catalog and refreshes the current project snapshot.
  async guardarEstructuraCatalogo(draft: CatalogStructureDraft): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) {
      this.b5dMensaje.set('No hay un proyecto B5D activo para importar catálogos.');
      return;
    }

    if (this.catalogStructureDialogLoading()) return;

    const loadingSessionId = this.loadingPanel.start(
      createCatalogImportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.importCatalog')),
    );
    this.catalogStructureDialogLoading.set(true);
    this.b5dMensaje.set('');
    this.clearImportDebugTrace();
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
      this.loadingPanel.completeStep(loadingSessionId, 'preparing', 'Archivo XDB recibido.');
      const proyectoImportado = await this.esperarProyectoImportado(proyecto.id, loadingSessionId);
      await this.cargarDatosProyectoB5d(proyectoImportado.id);
      const catalogosActuales = this.b5dCatalogs();
      const catalogoCreado = respuesta.catalogo ?? catalogosActuales[catalogosActuales.length - 1] ?? null;
      if (!catalogoCreado) {
        throw new Error('No se pudo identificar el catálogo importado.');
      }
      this.setBottomPanelTab('links');
      this.loadingPanel.completeStep(loadingSessionId, 'refreshing', 'Vista actualizada.');
      await this.sincronizarCatalogoSeleccionado(catalogoCreado.id);
      this.cerrarDialogoEstructuraCatalogo();
      this.b5dMensaje.set(`Catálogo importado correctamente: ${catalogoCreado.nombre ?? draft.nombre}.`);
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo importar la estructura de conceptos.'));
    } finally {
      this.catalogStructureDialogLoading.set(false);
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, 'Catálogo importado.');
      }
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

    const loadingSessionId = draft.archivo
      ? this.loadingPanel.start(createCatalogImportPlan(this.i18n.translateForComponent(this.globalTranslations, 'common.loading.importCatalog')))
      : 0;
    this.catalogStructureDialogLoading.set(true);
    this.b5dMensaje.set('');
    this.clearImportDebugTrace();
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

      if (draft.archivo) {
        this.loadingPanel.completeStep(loadingSessionId, 'preparing', 'Archivo XDB recibido.');
        const proyectoImportado = await this.esperarProyectoImportado(proyecto.id, loadingSessionId);
        await this.cargarDatosProyectoB5d(proyectoImportado.id);
      }
      const catalogosActuales = this.b5dCatalogs();
      const catalogoCreado = draft.archivo
        ? ((respuesta as { catalogo?: CatalogoB5DOrm }).catalogo ?? catalogosActuales[catalogosActuales.length - 1] ?? null)
        : this.obtenerCatalogoDeRespuesta(respuesta);
      if (!catalogoCreado) {
        throw new Error('No se pudo identificar el catálogo guardado.');
      }
      if (shouldCopyLinks) {
        this.catalogLinkCopySourceByTargetId.set(catalogoCreado.id, sourceCatalogId);
      }

      if (!draft.archivo) {
        await this.cargarDatosProyectoB5d(proyecto.id);
      }
      this.setBottomPanelTab('links');
      if (draft.archivo) {
        this.loadingPanel.completeStep(loadingSessionId, 'refreshing', 'Vista actualizada.');
      }
      await this.sincronizarCatalogoSeleccionado(catalogoCreado.id);
      if (shouldCopyLinks) {
        await this.persistirCambiosB5dEnServidor(proyecto.id, this.draftChangeVersion);
      }
      this.cerrarDialogoEstructuraCatalogo();
      const actionLabel = draft.archivo ? 'importado' : 'creado';
      this.b5dMensaje.set(`Catalogo ${actionLabel} correctamente: ${catalogoCreado.nombre ?? draft.nombre}.`);
    } catch (error) {
      if (draft.archivo) {
        this.loadingPanel.abort(loadingSessionId);
      }
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo guardar la estructura de conceptos.'));
    } finally {
      this.catalogStructureDialogLoading.set(false);
      if (draft.archivo && this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, 'Catálogo importado.');
      }
    }
  }

  // Imports or updates only the metadata of the selected catalog from an XDB file.
  async importarMetadatosCatalogo(archivo: File): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    const catalogo = this.catalogStructureDialogCatalog();
    if (!proyecto || !catalogo) {
      this.b5dMensaje.set('Selecciona un catálogo activo para importar metadatos.');
      return;
    }

    if (this.catalogStructureDialogLoading()) return;

    const loadingSessionId = this.loadingPanel.start(createCatalogImportPlan('Importando metadatos de catálogo'));
    this.catalogStructureDialogLoading.set(true);
    this.b5dMensaje.set('');
    this.clearImportDebugTrace();
    try {
      const respuesta = await firstValueFrom(
        this.backendProyectos.importarMetadataCatalogoAxa(proyecto.id, catalogo.id, { archivo }),
      );
      this.loadingPanel.completeStep(loadingSessionId, 'preparing', 'Archivo XDB recibido.');
      await this.cargarDatosProyectoB5d(proyecto.id);
      const catalogoActualizado =
        this.b5dCatalogs().find((item) => item.id === catalogo.id) ?? respuesta.catalogo ?? null;
      if (!catalogoActualizado) {
        throw new Error('No se pudo identificar el catálogo actualizado.');
      }
      this.catalogStructureDialogCatalog.set(catalogoActualizado);
      await this.sincronizarCatalogoSeleccionado(catalogoActualizado.id);
      this.loadingPanel.completeStep(loadingSessionId, 'refreshing', 'Vista actualizada.');
      this.b5dMensaje.set(
        `Metadatos importados correctamente para ${catalogoActualizado.nombre ?? 'el catálogo seleccionado'}.`,
      );
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo importar la metadata del catálogo.'));
    } finally {
      this.catalogStructureDialogLoading.set(false);
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, 'Metadatos importados.');
      }
    }
  }

  // Imports selected costs into the active catalog from an XDB file.
  async importarCostosCatalogo(draft: CatalogCostImportDraft): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    const catalogo = this.catalogStructureDialogCatalog();
    if (!proyecto || !catalogo) {
      this.b5dMensaje.set('Selecciona un catálogo activo para importar costos.');
      return;
    }

    if (this.catalogStructureDialogLoading()) return;

    const loadingSessionId = this.loadingPanel.start(createCatalogImportPlan('Importando costos de catálogo'));
    this.catalogStructureDialogLoading.set(true);
    this.b5dMensaje.set('');
    this.clearImportDebugTrace();
    try {
      const respuesta = await firstValueFrom(
        this.backendProyectos.importarCostosCatalogoAxa(proyecto.id, catalogo.id, {
          archivo: draft.archivo,
          conceptos_seleccionados: draft.conceptos_seleccionados,
        }),
      );
      this.loadingPanel.completeStep(loadingSessionId, 'preparing', 'Archivo XDB recibido.');
      await this.cargarDatosProyectoB5d(proyecto.id);
      const catalogoActualizado = this.b5dCatalogs().find((item) => item.id === catalogo.id) ?? respuesta.catalogo ?? null;
      if (!catalogoActualizado) {
        throw new Error('No se pudo identificar el catálogo actualizado.');
      }
      this.catalogStructureDialogCatalog.set(catalogoActualizado);
      await this.sincronizarCatalogoSeleccionado(catalogoActualizado.id);
      this.loadingPanel.completeStep(loadingSessionId, 'refreshing', 'Vista actualizada.');
      this.cerrarDialogoEstructuraCatalogo();
      this.b5dMensaje.set(`Costos importados correctamente para ${catalogoActualizado.nombre ?? 'el catálogo seleccionado'}.`);
    } catch (error) {
      this.loadingPanel.abort(loadingSessionId);
      this.b5dMensaje.set(this.obtenerMensajeError(error, 'No se pudo importar los costos del catálogo.'));
    } finally {
      this.catalogStructureDialogLoading.set(false);
      if (this.loadingPanel.state().visible) {
        this.loadingPanel.complete(loadingSessionId, 'Costos importados.');
      }
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

  // Refreshes project state after the B5D parameter import wizard completes.
  async onParametersB5dImportCompleted(summary: B5dParameterImportSummary): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) return;

    await this.cargarDatosProyectoB5d(proyecto.id);
    this.b5dMensaje.set(
      `Importación B5D finalizada: ${summary.created} creados, ${summary.updated} actualizados, ${summary.skipped} omitidos, ${summary.failed} fallidos.`,
    );
  }

  // Refreshes project state after the XDB parameter import wizard completes.
  async onParametersXdbImportCompleted(summary: XdbParameterImportSummary): Promise<void> {
    const proyecto = this.proyectoB5dActivo();
    if (!proyecto) return;

    await this.cargarDatosProyectoB5d(proyecto.id);
    this.b5dMensaje.set(
      `Importación XDB finalizada: ${summary.created} creados, ${summary.updated} actualizados, ${summary.skipped} omitidos, ${summary.failed} fallidos.`,
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
            precio_unitario: conceptItem.precio_unitario ?? null,
            cantidad: conceptItem.cantidad ?? null,
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
  private obtenerCatalogoDeRespuesta(respuesta: CatalogoB5DOrm | { catalogo?: CatalogoB5DOrm } | null): CatalogoB5DOrm | null {
    if (!respuesta) {
      return null;
    }
    if ('id' in respuesta) {
      return respuesta;
    }
    return respuesta.catalogo ?? null;
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
    if (typeof error === 'object' && error !== null) {
      const errorHttp = error as {
        status?: number;
        message?: string;
      };
      const mensajeError = typeof errorHttp.message === 'string' ? errorHttp.message.trim() : '';
      if (
        errorHttp.status === 0 &&
        (mensajeError === 'Failed to fetch' || mensajeError === 'Http failure response for (unknown url): 0 Unknown Error')
      ) {
        return 'No se pudo conectar con el backend para importar el archivo. Revisa la red, CORS o si el servidor cerró la conexión.';
      }
    }

    const extraerMensaje = (valor: unknown): string | null => {
      if (typeof valor === 'string') {
        const mensaje = valor.trim();
        return mensaje || null;
      }

      if (Array.isArray(valor)) {
        for (const item of valor) {
          const mensaje = extraerMensaje(item);
          if (mensaje) {
            return mensaje;
          }
        }
        return null;
      }

      if (typeof valor === 'object' && valor !== null) {
        const objeto = valor as Record<string, unknown>;
        const clavesPrioritarias = ['error', 'detail', 'message', 'mensaje', 'mensaje_error'];
        for (const clave of clavesPrioritarias) {
          const mensaje = extraerMensaje(objeto[clave]);
          if (mensaje) {
            return mensaje;
          }
        }

        const proyecto = objeto['proyecto'] as Record<string, unknown> | undefined;
        const mensajeProyecto = extraerMensaje(proyecto?.['mensaje_error']);
        if (mensajeProyecto) {
          return mensajeProyecto;
        }

        const mensajeSinCampo = extraerMensaje(objeto['non_field_errors']);
        if (mensajeSinCampo) {
          return mensajeSinCampo;
        }
      }

      return null;
    };

    return extraerMensaje(error) ?? mensajePredeterminado;
  }

  // Schedules the upper-right status message to disappear after a short delay.
  private scheduleB5dMessageClear(message: string): void {
    if (this.b5dMessageTimeoutId) {
      clearTimeout(this.b5dMessageTimeoutId);
      this.b5dMessageTimeoutId = null;
    }

    if (!message) return;

    this.b5dMessageTimeoutId = setTimeout(() => {
      if (this.b5dMensaje() === message) {
        this.b5dMensaje.set('');
      }
      this.b5dMessageTimeoutId = null;
    }, 5000);
  }

  private debugB5d(message: string, data?: unknown): void {
    logB5dDebug(message, data);
  }

  private clearImportDebugTrace(): void {
    if (!isB5dDebugEnabled()) return;
    this.backendImportTraceCount = 0;
    this.importDebugTrace.set([]);
  }

  private appendImportDebugTrace(line: string): void {
    if (!isB5dDebugEnabled()) return;
    const nextTrace = [...this.importDebugTrace(), line].slice(-8);
    this.importDebugTrace.set(nextTrace);
  }

  private normalizarConceptosB5d(conceptos: ConceptoB5DOrm[]): ConceptoB5DOrm[] {
    return conceptos.map((concepto) => ({
      ...concepto,
      precio_unitario: this.parseNumericLikeValue(concepto.precio_unitario),
      cantidad: this.parseNumericLikeValue(concepto.cantidad),
      importe: this.parseNumericLikeValue(concepto.importe),
      porcentaje_padre: this.parseNumericLikeValue(concepto.porcentaje_padre),
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
      'quantify-b5d': () => this.cuantificarB5D(),
      'toggle-theme': () => undefined,
      'toggle-lighting': () => this.toggleModelLighting(),
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
      'set-window-viewer': () => {
        void this.setWindowMode('viewer');
      },
      'set-window-control': () => {
        void this.setWindowMode('control');
      },
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

  // Switches the current window between viewer and control roles.
  async setWindowMode(mode: ViewerWindowMode): Promise<void> {
    if (this.windowMode() === mode) return;

    this.debugB5d('setWindowMode: requested', {
      previousMode: this.windowMode(),
      nextMode: mode,
    });
    this.windowMode.set(mode);
    if (this.isBrowser) {
      try {
        getSafeSessionStorage()?.setItem(this.viewerWindowModeStorageKey, mode);
      } catch {
        // Ignore session storage errors.
      }
    }

    if (mode === 'control') {
      if (this.visorIfc.mundoActual) {
        this.debugB5d('setWindowMode: destroying viewer for control mode');
        this.visorIfc.destruirVisor();
      }
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    this.debugB5d('setWindowMode: restoring viewer canvas after mode switch');
    await this.restoreViewerCanvas();
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

  // Returns the message shown when the control window is active.
  getWindowModeHint(): string {
    const key = this.windowMode() === 'control' ? 'toolbar.view.window.controlHint' : 'toolbar.view.window.viewerHint';
    return this.i18n.translateForComponent(TOOLBAR_TRANSLATIONS, key);
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
    if (this.windowMode() === 'control') {
      this.sharedIfcSelectionLocalIds.set([...new Set(localIds)]);
      this.sharedSelectionInfo.set(null);
      this.localViewerSync.broadcastSelection(localIds, null);
      return;
    }

    void this.visorIfc.seleccionarElementosPorLocalIds(localIds);
  }

  // Resolves a selected concept key against the loaded IFC and mirrors the selection.
  async onConceptSelectionRequested(conceptKey: string): Promise<void> {
    const activeProject = this.proyectoB5dActivo();
    const resolution = resolveIfcSelectionFromConceptKey(
      conceptKey,
      this.b5dConcepts(),
      this.b5dLinks(),
      this.ifcElements(),
      activeProject?.ifc_nombre_archivo ?? null,
    );

    const previousBroadcastSuppressed = this.suppressLocalViewerBroadcast;
    this.suppressLocalViewerBroadcast = true;

    try {
      if (!resolution.localIds.length) {
        this.sharedIfcSelectionLocalIds.set([]);
        this.sharedSelectionInfo.set(null);
        if (this.visorIfc.mundoActual) {
          await this.visorIfc.limpiarSeleccion();
        }
        if (this.localViewerSyncReady) {
          this.localViewerSync.broadcastSelection([], null);
        }
        if (resolution.reason) {
          this.b5dMensaje.set(resolution.reason);
        }
        return;
      }

      this.sharedIfcSelectionLocalIds.set([...resolution.localIds]);

      if (this.windowMode() === 'control' && !this.visorIfc.mundoActual) {
        this.sharedSelectionInfo.set(null);
        this.localViewerSync.broadcastSelection(resolution.localIds, null);
        return;
      }

      if (!this.visorIfc.mundoActual) {
        const initialized = await this.initializeViewerCanvas();
        if (!initialized) return;
      }

      await this.visorIfc.seleccionarElementosPorLocalIds(resolution.localIds);
      const selectedElementInfo = this.visorIfc.informacionSeleccionada();
      this.sharedSelectionInfo.set(selectedElementInfo ? { ...selectedElementInfo } : null);
      if (this.localViewerSyncReady) {
        this.localViewerSync.broadcastSelection(resolution.localIds, selectedElementInfo ?? null);
      }
    } finally {
      this.suppressLocalViewerBroadcast = previousBroadcastSuppressed;
    }
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

    this.updateFloatingPanel(resolvedPanelId, { zIndex: this.nextFloatingPanelZIndex++ });

    const panel = this.floatingPanels()[resolvedPanelId];
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = panel.left;
    const startTop = panel.top;

    startPointerDrag(event, (moveEvent) => {
      const position = this.constrainFloatingPanelPosition(
        panelElement,
        startLeft + moveEvent.clientX - startX,
        startTop + moveEvent.clientY - startY,
      );

      this.updateFloatingPanel(resolvedPanelId, position);
    });
  }

  // Starts resizing a panel from the selected border or corner handle.
  startFloatingPanelResize(
    event: PointerEvent,
    panelId: FloatingPanelId,
    handle: ResizeHandle = 'bottom-right',
  ): void {
    const resolvedPanelId = this.resolvePanelId(panelId);
    if (event.button !== 0) return;
    const initialPanel = this.floatingPanels()[resolvedPanelId];
    if (!this.canResizeFromHandle(initialPanel, handle)) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = initialPanel.width;
    const startHeight = initialPanel.height;
    const startLeft = initialPanel.left;
    const startTop = initialPanel.top;

    this.updateFloatingPanel(resolvedPanelId, { zIndex: this.nextFloatingPanelZIndex++ });

    startPointerDrag(event, (moveEvent) => {
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
    });
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
    const panel = this.floatingPanels().tree;
    const panelHeight = panel.docked ? Math.max(140, window.innerHeight - this.getDockedPanelTop()) : panel.height;
    const splitterHeight = 8;
    const minTreeHeight = 140;
    const minPropertiesHeight = 180;
    const maxTreeHeight = Math.max(minTreeHeight, panelHeight - minPropertiesHeight - splitterHeight);
    const startY = event.clientY;
    const startHeight = this.treeSectionHeight;

    startPointerDrag(event, (moveEvent) => {
      const nextHeight = startHeight + (moveEvent.clientY - startY);
      this.treeSectionHeight = Math.min(Math.max(nextHeight, minTreeHeight), maxTreeHeight);
      this.changeDetectorRef.detectChanges();
    });
  }

  // Returns CSS row tracks for the unified IFC panel split layout.
  get unifiedIfcPanelRowsTemplate(): string {
    return `${this.treeSectionHeight}px 8px minmax(0, 1fr)`;
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
      'parameter-toggle-list',
      'parameter-toggle-boq',
      'parameter-toggle-matches',
      'parameter-toggle-analysis',
      'import-parameters-excel',
      'import-parameters-b5d',
      'import-parameters-xdb',
      'expand-tree',
      'collapse-tree',
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

    if (action === 'import-parameters-b5d') {
      this.abrirDialogoImportacionParametrosB5d();
      return;
    }

    if (action === 'import-parameters-xdb') {
      this.abrirDialogoImportacionParametrosXdb();
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
      this.i18n.translateForComponent(this.viewerScreenTranslations, 'viewer.prompt.selectFilterMode'),
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
      this.i18n.translateForComponent(this.viewerScreenTranslations, 'viewer.prompt.unlinkedObjectsMode'),
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
