import { Inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Box3, Sphere, Vector3 } from 'three';
import type {
  InformacionElementoSeleccionado,
  ModeloIfcCargado,
  NodoArbolIfc,
  ValorCacheSeleccion,
} from '../types/ifc';
import type {
  MeasurementAreaSummary,
  MeasurementLengthAnchor,
  MeasurementLengthEdge,
  MeasurementLengthEdgeSummary,
  MeasurementLengthSummary,
  MeasurementMode,
  MeasurementLengthMode,
  MeasurementVolumeSummary,
} from '../types/measurement';
import type { ElementoIfcB5D } from '../types/quantity-take-off';
import {
  construirIndiceRutaEspacial,
  recolectarLocalIdsEspaciales,
  obtenerValorIfc,
} from './ifc-spatial-tree';

type RegistroElemento = {
  localId: number;
  expressID?: number;
  ifcClass: string;
  name: string;
  objectType: string;
  project: string;
  site: string;
  building: string;
  storey: string;
  z: number;
};

type MovementAxis = 'x' | 'y' | 'z';
type FragmentTransform = {
  position: number[];
  xDirection: number[];
  yDirection: number[];
  itemId?: number | string;
};

type ModelTransparencyState = {
  opacity: number;
  localIds: Set<number>;
};

type ExtractedIfcQuantities = {
  values: Record<string, string>;
};

type MeasurementFaceSelection = {
  key: string;
  modelId: string;
  localId: number;
  itemId: number;
  label: string;
  area: number;
  triangles: Vector3[][];
  overlay: any;
};

type MeasurementFaceHit = {
  modelId: string;
  localId: number;
  itemId: number;
  facePoints: Vector3[];
  faceIndices?: number[];
  distance: number;
};

type MeasurementAreaTriangle = {
  index: number;
  points: [Vector3, Vector3, Vector3];
  normal: Vector3;
  planeConstant: number;
  area: number;
  vertexKeys: [string, string, string];
};

type MeasurementAreaSelectionBuild = {
  key: string;
  modelId: string;
  localId: number;
  itemId: number;
  label: string;
  area: number;
  triangles: Vector3[][];
};

type MeasurementLengthHit = {
  modelId: string;
  localId: number;
  itemId: number;
  point: Vector3;
  distance: number;
};

type MeasurementLengthEdgeHit = {
  modelId: string;
  localId: number;
  itemId: number;
  start: Vector3;
  end: Vector3;
  distance: number;
};

@Injectable({ providedIn: 'root' })
export class VisorIfc {
  readonly cargando = signal(false);
  readonly informacionSeleccionada = signal<InformacionElementoSeleccionado | null>(null);
  readonly datosArbol = signal<NodoArbolIfc[]>([]);
  readonly nodosExpandidos = signal<Record<string, boolean>>({});
  readonly arbolVisible = signal(false);
  readonly modelosIfcCargados = signal<ModeloIfcCargado[]>([]);
  readonly seleccionActual = signal<Record<string, Set<number>>>({});
  readonly areaMeasurementSummary = signal<MeasurementAreaSummary | null>(null);

  private componentes: any = null;
  private mundo: any = null;
  private cargadorIfc: any = null;
  private fragmentos: any = null;
  private resaltador: any = null;
  private raycasterIfc: any = null;
  private modeloCargado: any = null;
  private contenedorVisor: HTMLElement | null = null;
  private modelGridHelper: any = null;
  private modelAxesOverlay: any = null;
  private nombreArchivoPendiente = '';
  private urlTrabajador = '';
  private moduloThree: typeof import('three') | null = null;
  private fragsModule: typeof import('@thatopen/fragments') | null = null;
  private mapaTiposIfc: Record<number, string> = {};
  private registrosArbol = new Map<number, RegistroElemento>();
  private cacheSeleccion = new Map<string, ValorCacheSeleccion>();
  private cacheElevacionElementos = new Map<number, number>();
  private selectedModelItems: Record<string, Set<number>> = {};
  private originalMovedTransforms = new Map<string, FragmentTransform>();
  private activeMovementAxis: MovementAxis | null = null;
  private activeModelId: string | null = null;
  private orbitPivot: Vector3 | null = null;
  private hiddenModelIds = new Set<string>();
  private modelTransparencyState = new Map<string, ModelTransparencyState>();
  private measurementMode: MeasurementMode | null = null;
  private measurementLengthMode: MeasurementLengthMode = 'edge';
  private readonly measurementFaceSelections = new Map<string, MeasurementFaceSelection>();
  private readonly measurementLengthAnchors = new Map<string, MeasurementLengthAnchor>();
  private lengthEdgeSelection: MeasurementLengthEdge | null = null;
  private lengthEdgePreview: MeasurementLengthEdge | null = null;
  private lengthMeasurementOverlay: any = null;
  private lengthEdgeMeasurementOverlay: any = null;
  readonly lengthMeasurementSummary = signal<MeasurementLengthSummary | null>(null);
  readonly lengthEdgeMeasurementSummary = signal<MeasurementLengthEdgeSummary | null>(null);
  private measurementOverlayGroup: any = null;
  private readonly measurementSelectionColor = '#f472b6';
  private readonly defaultSelectionColor = '#f7f31c';
  private readonly measurementDebugEnabled = true;

  constructor(@Inject(PLATFORM_ID) private readonly plataformaId: object) {}

  get mundoActual(): any {
    return this.mundo;
  }

  get localIdSeleccionado(): number | null {
    const informacion = this.informacionSeleccionada();
    return typeof informacion?.localId === 'number' ? informacion.localId : null;
  }

  async inicializarVisor(contenedor: HTMLElement): Promise<void> {
    if (!isPlatformBrowser(this.plataformaId) || this.componentes) return;
    this.contenedorVisor = contenedor;

    const [THREE, WEBIFC, FRAGS, OBC, OBCF] = await Promise.all([
      import('three'),
      import('web-ifc'),
      import('@thatopen/fragments'),
      import('@thatopen/components'),
      import('@thatopen/components-front'),
    ]);

    this.moduloThree = THREE;
    this.fragsModule = FRAGS;
    this.mapaTiposIfc = this.construirMapaTiposIfc(WEBIFC);

    const componentes: any = new OBC.Components();
    const mundos = componentes.get(OBC.Worlds);
    const mundo: any = mundos.create();

    this.componentes = componentes;
    this.mundo = mundo;

    mundo.scene = new OBC.SimpleScene(componentes);
    mundo.renderer = new OBCF.PostproductionRenderer(componentes, contenedor);
    mundo.camera = new OBC.OrthoPerspectiveCamera(componentes);

    componentes.init();

    mundo.scene.setup();
    mundo.scene.three.background = new THREE.Color(0x1f2937);

    await mundo.camera.controls.setLookAt(12, 10, 12, 0, 0, 0);
    mundo.camera.controls.minDistance = 0.5;
    mundo.camera.controls.maxDistance = 2000;

    await mundo.camera.projection?.set?.('Perspective');

    const fragmentos = componentes.get(OBC.FragmentsManager);
    this.fragmentos = fragmentos;

    this.urlTrabajador = await this.crearUrlTrabajadorFragmentos();
    await fragmentos.init(this.urlTrabajador);

    mundo.camera.controls.addEventListener('update', () => {
      fragmentos.core.update();
    });

    fragmentos.list.onItemSet.add(({ key, value: modelo }: any) => {
      this.modeloCargado = modelo;
      modelo.useCamera(mundo.camera.three);
      mundo.scene.three.add(modelo.object);

      const modeloId = key || modelo.uuid || modelo.id || crypto.randomUUID();
      modelo.userData = {
        ...modelo.userData,
        modelId: modeloId,
      };
      this.activeModelId = modeloId;

      this.modelosIfcCargados.update((modelos) => {
        if (modelos.some((item) => item.id === modeloId)) return modelos;

        return [
          ...modelos,
          {
            id: modeloId,
            name: this.nombreArchivoPendiente || modelo.name || `IFC ${modelos.length + 1}`,
            visible: true,
          },
        ];
      });

      fragmentos.core.update(true);
      this.syncModelVisualGuides();
      void this.refreshSelectionFilter();
    });

    const raycasters = componentes.get(OBC.Raycasters);
    this.raycasterIfc = raycasters.get(mundo);

    const resaltador = componentes.get(OBCF.Highlighter);

    await resaltador.setup({
      world: mundo,
      selectMaterialDefinition: {
        color: new THREE.Color('#f7f31c'),
        opacity: 1,
        transparent: false,
        renderedFaces: 0,
      },
    });

    this.resaltador = resaltador;
    this.resaltador.events.select.onHighlight.add((selectionMap: Record<string, Set<number>>) => {
      this.updateSelectionFromMap(selectionMap);
    });
    this.resaltador.events.select.onClear.add(() => {
      this.updateSelectionFromMap(this.resaltador?.selection?.select ?? {});
    });

    this.measurementOverlayGroup = new THREE.Group();
    this.measurementOverlayGroup.name = 'measurement-overlays';
    this.measurementOverlayGroup.renderOrder = 10000;
    mundo.scene.three.add(this.measurementOverlayGroup);

    contenedor.addEventListener('pointerdown', this.handleMeasurementPointerDown, true);
    contenedor.addEventListener('pointermove', this.handleMeasurementPointerMove, true);
    contenedor.addEventListener('pointerleave', this.handleMeasurementPointerLeave, true);
    contenedor.addEventListener('pointerdown', this.handleAltPointerDown, true);

    const cargadorIfc = componentes.get(OBC.IfcLoader);
    this.cargadorIfc = cargadorIfc;

    await cargadorIfc.setup({
      autoSetWasm: false,
      wasm: {
        path: '/web-ifc/',
        absolute: true,
      },
    });
  }

  destruirVisor(): void {
    this.contenedorVisor?.removeEventListener('pointerdown', this.handleMeasurementPointerDown, true);
    this.contenedorVisor?.removeEventListener('pointermove', this.handleMeasurementPointerMove, true);
    this.contenedorVisor?.removeEventListener('pointerleave', this.handleMeasurementPointerLeave, true);
    this.contenedorVisor?.removeEventListener('pointerdown', this.handleAltPointerDown, true);
    this.clearAreaMeasurementSelections();
    this.clearLengthMeasurementSelections();
    this.removeModelVisualGuides();

    if (this.urlTrabajador) URL.revokeObjectURL(this.urlTrabajador);
    if (this.componentes) this.componentes.dispose();

    this.componentes = null;
    this.mundo = null;
    this.cargadorIfc = null;
    this.fragmentos = null;
    this.resaltador = null;
    this.fragsModule = null;
    this.raycasterIfc = null;
    this.modeloCargado = null;
    this.contenedorVisor = null;
    this.urlTrabajador = '';
    this.selectedModelItems = {};
    this.originalMovedTransforms.clear();
    this.activeMovementAxis = null;
    this.activeModelId = null;
    this.hiddenModelIds.clear();
    this.modelTransparencyState.clear();
    this.orbitPivot = null;
    this.cacheSeleccion.clear();
    this.cacheElevacionElementos.clear();
    this.registrosArbol.clear();
    this.seleccionActual.set({});
    this.measurementMode = null;
    this.lengthMeasurementSummary.set(null);
    this.lengthEdgeMeasurementSummary.set(null);
    this.measurementOverlayGroup = null;
    this.lengthMeasurementOverlay = null;
    this.lengthEdgeMeasurementOverlay = null;
    this.lengthEdgeSelection = null;
    this.lengthEdgePreview = null;
  }

  async cargarArchivoIfc(archivo: File): Promise<void> {
    if (!this.cargadorIfc) return;

    this.cargando.set(true);
    this.nombreArchivoPendiente = archivo.name;
    this.cacheSeleccion.clear();
    this.registrosArbol.clear();
    this.cacheElevacionElementos.clear();
    this.selectedModelItems = {};
    this.originalMovedTransforms.clear();
    this.activeMovementAxis = null;
    this.activeModelId = null;
    this.hiddenModelIds.clear();
    this.modelTransparencyState.clear();
    this.informacionSeleccionada.set(null);
    this.datosArbol.set([]);
    this.nodosExpandidos.set({});
    this.arbolVisible.set(false);
    this.seleccionActual.set({});
    this.clearAreaMeasurementSelections();
    this.clearLengthMeasurementSelections();

    try {
      const datos = await archivo.arrayBuffer();
      const buffer = new Uint8Array(datos);

      await this.cargadorIfc.load(buffer, false, archivo.name);

      try {
        await this.mundo?.camera?.controls?.setLookAt(12, 10, 12, 0, 0, 0, true);
      } catch (error) {
        console.warn('No se pudo reposicionar la cámara:', error);
      }

      await this.esperar(250);
      this.syncModelVisualGuides();

      const arbolConstruido = await this.construirArbolConReintentos();
      if (arbolConstruido) this.arbolVisible.set(true);
    } catch (error) {
      console.error('Error cargando IFC:', error);
    } finally {
      this.cargando.set(false);
      this.nombreArchivoPendiente = '';
    }
  }

  alternarNodoArbol(id: string): void {
    this.nodosExpandidos.update((nodos) => ({
      ...nodos,
      [id]: !nodos[id],
    }));
  }

  async expandirArbolCompleto(): Promise<void> {
    this.arbolVisible.set(true);

    if (!this.datosArbol().length) {
      const arbolConstruido = await this.construirArbolConReintentos();
      if (!arbolConstruido) return;
    }

    const siguientes: Record<string, boolean> = {};
    for (const id of this.recolectarIdsNodos(this.datosArbol())) {
      siguientes[id] = true;
    }

    this.nodosExpandidos.set(siguientes);
  }

  colapsarArbolCompleto(): void {
    this.nodosExpandidos.set({});
    this.arbolVisible.set(false);
  }

  async limpiarSeleccion(): Promise<void> {
    this.informacionSeleccionada.set(null);
    this.seleccionActual.set({});
    this.clearAreaMeasurementSelections();
    this.clearLengthMeasurementSelections();

    try {
      if (this.resaltador?.clear) await this.resaltador.clear();
    } catch (error) {
      console.warn('No se pudo limpiar selección:', error);
    }
  }

  // Updates the active measurement mode and prepares the model interaction state.
  async setMeasurementMode(mode: MeasurementMode | null): Promise<void> {
    if (this.measurementMode === mode) return;

    this.measurementMode = mode;
    await this.applyMeasurementSelectionStyle(mode !== null);

    if (mode === 'area') {
      await this.limpiarSeleccion();
      return;
    }

    if (mode === 'length') {
      await this.limpiarSeleccion();
      return;
    }

    if (mode === 'volume') {
      this.clearAreaMeasurementSelections();
      this.clearLengthMeasurementSelections();
      this.clearLengthEdgeMeasurement();
      return;
    }

    this.clearAreaMeasurementSelections();
    this.clearLengthMeasurementSelections();
    this.clearLengthEdgeMeasurement();
  }

  // Switches the active length sub-mode used while length measurement is enabled.
  setMeasurementLengthMode(mode: MeasurementLengthMode): void {
    if (this.measurementLengthMode === mode) return;

    this.measurementLengthMode = mode;
    this.clearLengthMeasurementSelections();
    this.clearLengthEdgeMeasurement();
  }

  async clearAllMeasurements(): Promise<void> {
    await this.limpiarSeleccion();
    this.clearLengthEdgeMeasurement();
  }

  // Temporary trace output for measurement debugging; remove once area selection is stable.
  private debugMeasurement(stage: string, payload: unknown): void {
    if (!this.measurementDebugEnabled) return;
    console.log('[measurement-debug]', stage, payload);
  }

  alternarVisibilidadIfc(modeloId: string): void {
    if (!this.fragmentos) return;

    for (const [, modelo] of this.fragmentos.list) {
      const idActual = modelo.userData?.modelId || modelo.uuid || modelo.id;

      if (idActual === modeloId) {
        modelo.object.visible = !modelo.object.visible;
        if (modelo.object.visible) {
          this.hiddenModelIds.delete(modeloId);
        } else {
          this.hiddenModelIds.add(modeloId);
          this.clearSelectionForModel(modeloId);
        }
        this.fragmentos.core.update(true);

        this.modelosIfcCargados.update((modelos) =>
          modelos.map((modeloIfc) =>
            modeloIfc.id === modeloId ? { ...modeloIfc, visible: modelo.object.visible } : modeloIfc,
          ),
        );

        this.syncModelVisualGuides();
        void this.refreshSelectionFilter();
        void this.applyPersistentTransparencyForModel(modeloId);
        break;
      }
    }
  }

  async seleccionarElementoDesdeArbol(localId: number): Promise<void> {
    if (!this.modeloCargado || !this.mundo) return;

    try {
      this.activeModelId = this.getModelId(this.modeloCargado);
      const { informacion, esfera } = await this.construirInformacionSeleccionada(
        this.modeloCargado,
        localId,
      );

      this.cacheSeleccion.set(`tree-${localId}`, { info: informacion, sphere: esfera });
      this.informacionSeleccionada.set(informacion);

      await this.resaltarPorLocalId(localId);
      await this.enfocarEsfera(this.mundo, esfera);
    } catch (error) {
      console.warn('No se pudo seleccionar/enfocar el elemento desde el árbol:', error);
    }
  }

  // Highlights multiple model elements from the linking panel object table.
  async seleccionarElementosPorLocalIds(localIds: number[]): Promise<void> {
    if (!this.modeloCargado || !this.resaltador) return;
    const uniqueLocalIds = Array.from(new Set(localIds.filter((localId) => Number.isInteger(localId) && localId > 0)));

    if (!uniqueLocalIds.length) {
      await this.limpiarSeleccion();
      return;
    }

    try {
      let modelId = this.getModelId(this.modeloCargado);
      if (!modelId && this.fragmentos?.list) {
        for (const [fragmentModelId] of this.fragmentos.list) {
          modelId = fragmentModelId;
          break;
        }
      }
      if (!modelId || !this.resaltador.highlightByID) return;

      this.activeModelId = modelId;
      if (this.resaltador.clear) await this.resaltador.clear();
      await this.resaltador.highlightByID('select', {
        [modelId]: new Set(uniqueLocalIds),
      });

      const firstLocalId = uniqueLocalIds[uniqueLocalIds.length - 1];
      const { informacion } = await this.construirInformacionSeleccionada(this.modeloCargado, firstLocalId);
      this.informacionSeleccionada.set(informacion);
      await this.focusSelectedElements();
    } catch (error) {
      console.warn('No se pudo seleccionar elementos por IDs locales:', error);
    }
  }

  async acercar(): Promise<void> {
    await this.mundo?.camera?.controls?.dolly(-2, true);
  }

  async alejar(): Promise<void> {
    await this.mundo?.camera?.controls?.dolly(2, true);
  }

  async rotarIzquierda(): Promise<void> {
    await this.mundo?.camera?.controls?.rotate(-1.570796327, 0, true);
  }

  async rotarDerecha(): Promise<void> {
    await this.mundo?.camera?.controls?.rotate(1.570796327, 0, true);
  }

  async restablecerVista(): Promise<void> {
    await this.setDefaultModelView();
  }

  // Restores visibility and opacity for every loaded model item.
  async showAllModelElements(): Promise<void> {
    this.modelTransparencyState.clear();
    await Promise.all(this.getLoadedModels().map((model) => this.resetModelVisibility(model)));
    this.fragmentos?.core?.update?.(true);
  }

  // Shows selected model items and restores their opacity.
  async showSelectedElements(): Promise<void> {
    this.clearActiveModelTransparencyState();
    await this.applyVisibilityToSelectedElements(true);
    await this.applyPersistentTransparencyForActiveModel();
  }

  // Applies a transparent visual state to selected model items.
  async makeSelectedElementsTransparent(): Promise<void> {
    const activeSelection = this.getActiveModelSelectionMap(this.selectedModelItems);
    const activeModelId = Object.keys(activeSelection)[0];
    if (!activeModelId) return;

    const localIds = Array.from(activeSelection[activeModelId] ?? []);
    if (!localIds.length) return;

    await this.setActiveModelTransparency(localIds, 0.25);
  }

  // Hides selected model items in the current model view.
  async hideSelectedElements(): Promise<void> {
    await this.applyVisibilityToSelectedElements(false);
    await this.applyPersistentTransparencyForActiveModel();
  }

  // Shows items that are not part of the current selection.
  async showNotSelectedElements(): Promise<void> {
    this.clearActiveModelTransparencyState();
    await this.applyVisibilityToNotSelectedElements(true);
    await this.applyPersistentTransparencyForActiveModel();
  }

  // Applies a transparent visual state to items outside the current selection.
  async makeNotSelectedElementsTransparent(): Promise<void> {
    const notSelectedMap = await this.getNotSelectedModelItemMap();
    const activeModelId = Object.keys(notSelectedMap)[0];
    if (!activeModelId) return;

    const localIds = Array.from(notSelectedMap[activeModelId] ?? []);
    if (!localIds.length) return;

    await this.setActiveModelTransparency(localIds, 0.25);
  }

  // Hides items that are not part of the current selection.
  async hideNotSelectedElements(): Promise<void> {
    await this.applyVisibilityToNotSelectedElements(false);
    await this.applyPersistentTransparencyForActiveModel();
  }

  // Switches to perspective navigation and restores the default model angle.
  async set3DView(): Promise<void> {
    await this.mundo?.camera?.projection?.set?.('Perspective');
    this.updateLoadedModelCameras();
    await this.setDefaultModelView();
  }

  // Switches to orthographic navigation and frames the model from above.
  async set2DView(): Promise<void> {
    await this.mundo?.camera?.projection?.set?.('Orthographic');
    this.updateLoadedModelCameras();
    await this.setTopModelView();
  }

  // Frames the current selection, or the full model when there is no selection.
  async focusSelectedElements(): Promise<void> {
    const selectedBounds = await this.getSelectedElementsBoundingBox();
    const boundingBox = selectedBounds ?? this.getActiveModelBoundingBox() ?? this.getFullModelBoundingBox();
    await this.focusBoundingBox(boundingBox);
  }

  // Restores the default 3D angle for the loaded model.
  async setDefaultModelView(): Promise<void> {
    await this.setModelViewFromDirection(12, 10, 12);
  }

  // Moves the camera to the front model view.
  async setFrontModelView(): Promise<void> {
    await this.setModelViewFromDirection(0, 0, 1);
  }

  // Moves the camera to the back model view.
  async setBackModelView(): Promise<void> {
    await this.setModelViewFromDirection(0, 0, -1);
  }

  // Moves the camera to the top model view.
  async setTopModelView(): Promise<void> {
    await this.setModelViewFromDirection(0, 1, 0);
  }

  // Moves the camera to the right model view.
  async setRightModelView(): Promise<void> {
    await this.setModelViewFromDirection(1, 0, 0);
  }

  // Moves the camera to the left model view.
  async setLeftModelView(): Promise<void> {
    await this.setModelViewFromDirection(-1, 0, 0);
  }

  // Defines the axis constraint used by Shift+Left Click movement.
  setMovementAxis(axis: MovementAxis): void {
    this.activeMovementAxis = this.activeMovementAxis === axis ? null : axis;
  }

  // Restores the original transforms for the current selection.
  async restoreSelectedElementMovements(): Promise<void> {
    await this.restoreMovementForSelection(this.getActiveModelSelectionMap(this.selectedModelItems));
  }

  // Restores every element transform changed by toolbar movement.
  async restoreAllElementMovements(): Promise<void> {
    await this.restoreMovementForKeys(Array.from(this.originalMovedTransforms.keys()));
  }

  obtenerElementosB5D(): ElementoIfcB5D[] {
    return Array.from(this.registrosArbol.values()).map((elemento) => ({
      localId: elemento.localId,
      expressID: elemento.expressID,
      ifcClass: elemento.ifcClass,
      name: elemento.name,
      objectType: elemento.objectType,
      project: elemento.project,
      site: elemento.site,
      building: elemento.building,
      storey: elemento.storey,
      category: this.mapearClaseIfcAGrupo(elemento.ifcClass, elemento.name, elemento.objectType),
      elementType: this.obtenerEtiquetaTipo(elemento.ifcClass, elemento.name, elemento.objectType),
      area: null,
      volume: null,
      length: null,
      count: 1,
    }));
  }

  async obtenerDetalleElementoB5D(localId: number): Promise<Record<string, unknown> | null> {
    if (!this.modeloCargado) return null;

    const { informacion } = await this.construirInformacionSeleccionada(this.modeloCargado, localId);

    return {
      localId,
      name: informacion.name,
      ifcClass: informacion.ifcClass,
      objectType: informacion.objectType,
      storey: informacion.storey,
      area: informacion.totalArea,
      grossArea: informacion.grossArea,
      netArea: informacion.netArea,
      volume: informacion.totalVolume,
      grossVolume: informacion.grossVolume,
      netVolume: informacion.netVolume,
      length: informacion.length,
      perimeter: informacion.perimeter,
      quantities: informacion.quantities,
    };
  }

  // Sums the volume of the current selected IFC items across every loaded model.
  async obtenerResumenVolumenSeleccionado(
    selectionMap: Record<string, Set<number>> = this.seleccionActual(),
  ): Promise<MeasurementVolumeSummary> {
    const selectedCount = Object.values(selectionMap).reduce((count, localIdSet) => count + localIdSet.size, 0);
    if (!selectedCount) return { totalVolume: null, selectedCount: 0 };

    let totalVolume = 0;
    let hasVolume = false;

    for (const [modelId, localIdSet] of Object.entries(selectionMap)) {
      const model = this.getModelById(modelId);
      const localIds = Array.from(localIdSet);
      if (!model || !localIds.length || typeof model.getItemsVolume !== 'function') continue;

      try {
        const rawVolume = await model.getItemsVolume(localIds);
        const numericVolume = this.normalizarVolumenPosible(rawVolume);
        if (numericVolume === null) continue;

        totalVolume += numericVolume;
        hasVolume = true;
      } catch {
        continue;
      }
    }

    return {
      totalVolume: hasVolume ? totalVolume : null,
      selectedCount,
    };
  }

  private readonly handleAltPointerDown = async (event: PointerEvent): Promise<void> => {
    if (!event.shiftKey || event.button !== 0) return;

    const selectionMap = this.getActiveModelSelectionMap(this.getSelectedModelItemMap());
    if (!this.hasSelectedItems(selectionMap)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const controls = this.mundo?.camera?.controls;
    const previousControlsEnabled = controls?.enabled ?? true;
    if (controls) controls.enabled = false;

    try {
      const pointerPosition = this.getPointerPositionFromEvent(event);
      const interactableObjects = this.getInteractableModelObjects();
      if (!pointerPosition || !interactableObjects.length) return;

      const targetPoint = this.obtenerPuntoInterseccion(pointerPosition, interactableObjects);
      if (!targetPoint) return;

      await this.moveSelectionToPoint(selectionMap, targetPoint);
    } catch (error) {
      console.warn('Could not move selected elements:', error);
    } finally {
      if (controls) controls.enabled = previousControlsEnabled;
    }
  };

  private readonly handleMeasurementPointerDown = async (event: PointerEvent): Promise<void> => {
    if (!this.measurementMode || event.button !== 0) return;

    // Volume mode should keep the normal fragments selection flow intact.
    if (this.measurementMode === 'volume') return;

    const pointerPosition = this.getPointerPixelPositionFromEvent(event);
    const canvas = this.getRendererCanvas();
    const camera = this.mundo?.camera?.three;
    if (!pointerPosition || !canvas || !camera) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    try {
      if (this.measurementMode === 'area') {
        this.debugMeasurement('area pointerdown', { pointerPosition, hasCanvas: !!canvas, hasCamera: !!camera });
        const hit = await this.findClosestAreaMeasurementHit(pointerPosition, camera, canvas);
        if (!hit) return;

        await this.toggleAreaMeasurementFace(hit);
        return;
      }

      if (this.measurementMode === 'length') {
        if (this.measurementLengthMode === 'edge') {
        const edgeHit = await this.findClosestLengthEdgeHit(pointerPosition, camera, canvas);
        if (edgeHit) {
          this.pinLengthEdgeMeasurement(edgeHit);
          return;
        }
          return;
        }

        const hit = await this.findClosestLengthMeasurementHit(pointerPosition, camera, canvas);
        if (!hit) return;

        this.clearLengthEdgeMeasurement();
        this.toggleLengthMeasurementAnchor(hit);
      }
    } catch (error) {
      console.warn('Could not resolve measurement interaction:', error);
    }
  };

  private readonly handleMeasurementPointerMove = async (event: PointerEvent): Promise<void> => {
    if (this.measurementMode !== 'length' || this.measurementLengthMode !== 'edge' || event.buttons !== 0) return;
    if (this.lengthEdgeSelection || this.measurementLengthAnchors.size > 0) return;

    const pointerPosition = this.getPointerPixelPositionFromEvent(event);
    const canvas = this.getRendererCanvas();
    const camera = this.mundo?.camera?.three;
    if (!pointerPosition || !canvas || !camera) return;

    try {
      const hit = await this.findClosestLengthEdgeHit(pointerPosition, camera, canvas);
      this.setLengthEdgePreview(hit);
    } catch {
      this.setLengthEdgePreview(null);
    }
  };

  private readonly handleMeasurementPointerLeave = (): void => {
    if (this.measurementMode !== 'length' || this.measurementLengthMode !== 'edge' || this.lengthEdgeSelection || this.measurementLengthAnchors.size > 0) return;
    this.setLengthEdgePreview(null);
  };

  // Converts pointer coordinates to normalized raycast coordinates.
  private getPointerPositionFromEvent(event: PointerEvent): { x: number; y: number } | undefined {
    if (!this.contenedorVisor) return undefined;

    const bounds = this.contenedorVisor.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return undefined;

    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    };
  }

  // Converts pointer coordinates to raw canvas-relative pixels for fragments raycasts.
  private getPointerPixelPositionFromEvent(event: PointerEvent): { x: number; y: number } | undefined {
    if (!this.contenedorVisor) return undefined;

    const bounds = this.contenedorVisor.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return undefined;

    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  }

  // Returns the canvas element used by the active renderer, if present.
  private getRendererCanvas(): HTMLCanvasElement | null {
    return (this.contenedorVisor?.querySelector('canvas') as HTMLCanvasElement | null) ?? null;
  }

  // Finds the closest face hit under the pointer for area measurements.
  private async findClosestAreaMeasurementHit(
    pointerPosition: { x: number; y: number },
    camera: any,
    canvas: HTMLCanvasElement,
  ): Promise<MeasurementFaceHit | null> {
    if (!this.moduloThree) return null;

    const mouse = new this.moduloThree.Vector2(pointerPosition.x, pointerPosition.y);
    const raycastData = { camera, mouse, dom: canvas };
    const candidates: MeasurementFaceHit[] = [];

    for (const model of this.getSelectableMeasurementModels()) {
      try {
        if (typeof model?.raycastAll !== 'function') continue;

        const modelId = this.getModelId(model);
        if (!modelId) continue;

        const hits = await model.raycastAll(raycastData);
        this.debugMeasurement('area raycastAll', {
          modelId,
          hitCount: Array.isArray(hits) ? hits.length : null,
        });
        if (!Array.isArray(hits) || !hits.length) continue;

        const validHit = this.pickClosestFaceHit(modelId, hits);
        if (validHit) candidates.push(validHit);
      } catch {
        continue;
      }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    const hit = candidates[0] ?? null;
    this.debugMeasurement('area hit', {
      hitCount: candidates.length,
      hit: !!hit,
    });
    return hit;
  }

  // Finds the closest vertex snap under the pointer for length measurements.
  private async findClosestLengthMeasurementHit(
    pointerPosition: { x: number; y: number },
    camera: any,
    canvas: HTMLCanvasElement,
  ): Promise<MeasurementLengthHit | null> {
    if (!this.moduloThree || !this.fragsModule) return null;

    const mouse = new this.moduloThree.Vector2(pointerPosition.x, pointerPosition.y);
    const snappingClass = this.fragsModule.SnappingClass.POINT;
    const raycastData = { camera, mouse, dom: canvas, snappingClasses: [snappingClass] };
    const candidates: MeasurementLengthHit[] = [];

    for (const model of this.getSelectableMeasurementModels()) {
      try {
        if (typeof model?.raycastWithSnapping !== 'function') continue;

        const modelId = this.getModelId(model);
        if (!modelId) continue;

        const hits = await model.raycastWithSnapping(raycastData);
        if (!Array.isArray(hits) || !hits.length) continue;

        const validHit = this.pickClosestLengthHit(modelId, hits);
        if (validHit) candidates.push(validHit);
      } catch {
        continue;
      }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0] ?? null;
  }

  // Finds the closest snapped edge under the pointer for hover-based length measurements.
  private async findClosestLengthEdgeHit(
    pointerPosition: { x: number; y: number },
    camera: any,
    canvas: HTMLCanvasElement,
  ): Promise<MeasurementLengthEdgeHit | null> {
    if (!this.moduloThree || !this.fragsModule) return null;

    const mouse = new this.moduloThree.Vector2(pointerPosition.x, pointerPosition.y);
    const snappingClass = this.fragsModule.SnappingClass.LINE;
    const raycastData = { camera, mouse, dom: canvas, snappingClasses: [snappingClass] };
    const candidates: MeasurementLengthEdgeHit[] = [];

    for (const model of this.getSelectableMeasurementModels()) {
      try {
        if (typeof model?.raycastWithSnapping !== 'function') continue;

        const modelId = this.getModelId(model);
        if (!modelId) continue;

        const hits = await model.raycastWithSnapping(raycastData);
        if (!Array.isArray(hits) || !hits.length) continue;

        const validHit = this.pickClosestLengthEdgeHit(modelId, hits);
        if (validHit) candidates.push(validHit);
      } catch {
        continue;
      }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0] ?? null;
  }

  // Filters loaded models to only the visible ones that can be measured.
  private getSelectableMeasurementModels(): any[] {
    return this.getLoadedModels().filter((model) => {
      const modelId = this.getModelId(model);
      return model?.object?.visible && (!modelId || !this.hiddenModelIds.has(modelId));
    });
  }

  // Picks the closest valid face hit from a model raycast result set.
  private pickClosestFaceHit(modelId: string, hits: any[]): MeasurementFaceHit | null {
    const sortedHits = [...hits]
      .filter((hit) => this.isValidFaceHit(hit))
      .sort((a, b) => (Number(a.distance) || Number.POSITIVE_INFINITY) - (Number(b.distance) || Number.POSITIVE_INFINITY));

    const hit = sortedHits[0];
    if (!hit) return null;

    return {
      modelId,
      localId: Number(hit.localId),
      itemId: Number(hit.itemId ?? hit.localId),
      facePoints: this.convertFacePoints(hit.facePoints),
      faceIndices: Array.isArray(hit.faceIndices) ? [...hit.faceIndices] : Array.from(hit.faceIndices ?? []),
      distance: Number(hit.distance ?? Number.POSITIVE_INFINITY),
    };
  }

  // Picks the closest valid point hit from a model raycast result set.
  private pickClosestLengthHit(modelId: string, hits: any[]): MeasurementLengthHit | null {
    const sortedHits = [...hits]
      .filter((hit) => this.isValidLengthHit(hit))
      .sort((a, b) => (Number(a.distance) || Number.POSITIVE_INFINITY) - (Number(b.distance) || Number.POSITIVE_INFINITY));

    const hit = sortedHits[0];
    if (!hit) return null;

    return {
      modelId,
      localId: Number(hit.localId),
      itemId: Number(hit.itemId ?? hit.localId),
      point: this.clonePoint(hit.point),
      distance: Number(hit.distance ?? Number.POSITIVE_INFINITY),
    };
  }

  // Picks the closest valid snapped edge from a model raycast result set.
  private pickClosestLengthEdgeHit(modelId: string, hits: any[]): MeasurementLengthEdgeHit | null {
    const sortedHits = [...hits]
      .filter((hit) => this.isValidLengthEdgeHit(hit))
      .sort((a, b) => (Number(a.distance) || Number.POSITIVE_INFINITY) - (Number(b.distance) || Number.POSITIVE_INFINITY));

    const hit = sortedHits[0];
    if (!hit) return null;

    return {
      modelId,
      localId: Number(hit.localId),
      itemId: Number(hit.itemId ?? hit.localId),
      start: this.clonePoint(hit.snappedEdgeP1 ?? hit.point),
      end: this.clonePoint(hit.snappedEdgeP2 ?? hit.point),
      distance: Number(hit.distance ?? Number.POSITIVE_INFINITY),
    };
  }

  // Verifies that a raycast result contains a face we can measure.
  private isValidFaceHit(hit: any): boolean {
    return !!hit && Number.isFinite(Number(hit.distance)) && !!hit.facePoints && hit.facePoints.length >= 9;
  }

  // Verifies that a raycast result contains a snapped point we can measure.
  private isValidLengthHit(hit: any): boolean {
    const pointClass = this.fragsModule?.SnappingClass.POINT;
    return !!hit && Number.isFinite(Number(hit.distance)) && !!hit.point && hit.snappingClass === pointClass;
  }

  // Verifies that a raycast result contains a snapped edge we can measure.
  private isValidLengthEdgeHit(hit: any): boolean {
    const lineClass = this.fragsModule?.SnappingClass.LINE;
    return (
      !!hit &&
      Number.isFinite(Number(hit.distance)) &&
      !!hit.snappedEdgeP1 &&
      !!hit.snappedEdgeP2 &&
      hit.snappingClass === lineClass
    );
  }

  // Converts raw face points into Three.js vectors.
  private convertFacePoints(facePoints: Float32Array | number[] | undefined): Vector3[] {
    if (!this.moduloThree || !facePoints || facePoints.length < 9) return [];

    const points: Vector3[] = [];
    for (let index = 0; index < facePoints.length; index += 3) {
      points.push(new this.moduloThree.Vector3(facePoints[index], facePoints[index + 1], facePoints[index + 2]));
    }

    return points;
  }

  // Adds or replaces the current length measurement anchor pair.
  private toggleLengthMeasurementAnchor(hit: MeasurementLengthHit): void {
    if (!this.moduloThree) return;

    const key = this.getMeasurementLengthAnchorKey(hit);
    const existingAnchor = this.measurementLengthAnchors.get(key);
    if (existingAnchor) return;

    if (this.measurementLengthAnchors.size >= 2) {
      this.measurementLengthAnchors.clear();
    }

    if (this.measurementLengthAnchors.size === 1) {
      const [firstAnchor] = Array.from(this.measurementLengthAnchors.values());
      if (this.isSameMeasurementObject(firstAnchor, hit)) return;
    }

    this.measurementLengthAnchors.set(key, {
      modelId: hit.modelId,
      localId: hit.localId,
      itemId: hit.itemId,
      label: this.getMeasurementEntityLabel(hit.modelId, hit.localId),
      x: hit.point.x,
      y: hit.point.y,
      z: hit.point.z,
    });

    this.updateLengthMeasurementSummary();
  }

  // Pins a hovered edge as the active length measurement and clears the point workflow.
  private pinLengthEdgeMeasurement(hit: MeasurementLengthEdgeHit): void {
    this.lengthEdgeSelection = {
      modelId: hit.modelId,
      localId: hit.localId,
      itemId: hit.itemId,
      label: this.getMeasurementEntityLabel(hit.modelId, hit.localId),
      start: {
        x: hit.start.x,
        y: hit.start.y,
        z: hit.start.z,
      },
      end: {
        x: hit.end.x,
        y: hit.end.y,
        z: hit.end.z,
      },
    };
    this.lengthEdgePreview = null;
    this.measurementLengthAnchors.clear();
    this.removeLengthMeasurementOverlay();
    this.updateLengthEdgeMeasurementSummary();
    this.lengthMeasurementSummary.set(null);
  }

  // Updates the hover preview used by the edge-based length mode.
  private setLengthEdgePreview(hit: MeasurementLengthEdgeHit | null): void {
    if (this.lengthEdgeSelection) return;

    this.lengthEdgePreview = hit
      ? {
          modelId: hit.modelId,
          localId: hit.localId,
          itemId: hit.itemId,
          label: this.getMeasurementEntityLabel(hit.modelId, hit.localId),
          start: {
            x: hit.start.x,
            y: hit.start.y,
            z: hit.start.z,
          },
          end: {
            x: hit.end.x,
            y: hit.end.y,
            z: hit.end.z,
          },
        }
      : null;

    this.updateLengthEdgeMeasurementSummary();
  }

  // Clears the edge-based length measurement state and overlay.
  private clearLengthEdgeMeasurement(): void {
    this.lengthEdgeSelection = null;
    this.lengthEdgePreview = null;
    this.removeLengthEdgeMeasurementOverlay();
    this.lengthEdgeMeasurementSummary.set(null);
  }

  // Adds or removes a measurement face and updates the summary state.
  private async toggleAreaMeasurementFace(hit: MeasurementFaceHit): Promise<void> {
    const builtSelection = await this.buildAreaMeasurementSelection(hit);
    if (!builtSelection) return;

    const key = builtSelection.key;
    const existingSelection = this.measurementFaceSelections.get(key);

    if (existingSelection) {
      this.removeAreaMeasurementFace(existingSelection);
      this.measurementFaceSelections.delete(key);
      this.updateAreaMeasurementSummary();
      return;
    }

    const area = builtSelection.area;
    const overlay = this.createAreaMeasurementOverlay(builtSelection.triangles);
    if (!overlay || !this.measurementOverlayGroup) return;

    overlay.userData = {
      ...overlay.userData,
      measurementFaceKey: key,
    };

    this.measurementOverlayGroup.add(overlay);
    this.measurementFaceSelections.set(key, {
      key,
      modelId: builtSelection.modelId,
      localId: builtSelection.localId,
      itemId: builtSelection.itemId,
      label: builtSelection.label,
      area,
      triangles: builtSelection.triangles,
      overlay,
    });

    this.updateAreaMeasurementSummary();
  }

  // Removes a selected measurement face from the list and overlay group.
  removeAreaMeasurementSelection(key: string): void {
    const selection = this.measurementFaceSelections.get(key);
    if (!selection) return;

    this.removeAreaMeasurementFace(selection);
    this.measurementFaceSelections.delete(key);
    this.updateAreaMeasurementSummary();
  }

  // Builds a merged face selection from the clicked triangle and its coplanar neighbors.
  private async buildAreaMeasurementSelection(hit: MeasurementFaceHit): Promise<MeasurementAreaSelectionBuild | null> {
    const model = this.getModelById(hit.modelId);
    if (!model?.getItemsGeometry || !this.moduloThree) return null;

    try {
      const geometries = await model.getItemsGeometry([hit.localId]);
      const geometryGroups = Array.isArray(geometries) ? geometries : geometries ? [geometries] : [];
      this.debugMeasurement('area geometry chunks', {
        modelId: hit.modelId,
        localId: hit.localId,
        chunkCount: geometryGroups.length,
        facePoints: hit.facePoints.length,
      });

      for (let groupIndex = 0; groupIndex < geometryGroups.length; groupIndex += 1) {
        const geometryGroup = geometryGroups[groupIndex];
        const chunks = Array.isArray(geometryGroup) ? geometryGroup : [geometryGroup];

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          const chunk = chunks[chunkIndex];
          const triangles = this.extractMeasurementTriangles(chunk);
          this.debugMeasurement('area triangles', {
            modelId: hit.modelId,
            localId: hit.localId,
            groupIndex,
            chunkIndex,
            triangleCount: triangles.length,
            chunkKeys: chunk ? Object.keys(chunk) : [],
          });
          if (!triangles.length) continue;

          const seedTriangleIndex = this.findMatchingTriangleIndex(triangles, hit.facePoints);
          this.debugMeasurement('area seed triangle', {
            modelId: hit.modelId,
            localId: hit.localId,
            groupIndex,
            chunkIndex,
            seedTriangleIndex,
          });
          if (seedTriangleIndex === null) continue;

          const selectedTriangleIndices = this.collectCoplanarTriangleRegion(triangles, seedTriangleIndex);
          this.debugMeasurement('area selected triangles', {
            modelId: hit.modelId,
            localId: hit.localId,
            groupIndex,
            chunkIndex,
            selectedTriangleCount: selectedTriangleIndices.length,
          });
          if (!selectedTriangleIndices.length) continue;

          const selectedTriangles = selectedTriangleIndices.map((triangleIndex) =>
            triangles[triangleIndex].points.map((point) => point.clone()) as Vector3[],
          );
          const area = selectedTriangleIndices.reduce((sum, triangleIndex) => sum + triangles[triangleIndex].area, 0);

          if (!Number.isFinite(area) || area <= 0) continue;

          const sortedIndices = [...selectedTriangleIndices].sort((a, b) => a - b);
          const key = `${hit.modelId}:${hit.localId}:${hit.itemId}:${groupIndex}:${chunkIndex}:${sortedIndices.join('-')}`;

          return {
            key,
            modelId: hit.modelId,
            localId: hit.localId,
            itemId: hit.itemId,
            label: this.getMeasurementEntityLabel(hit.modelId, hit.localId),
            area,
            triangles: selectedTriangles,
          };
        }
      }
    } catch (error) {
      console.warn('Could not build area measurement selection:', error);
    }

    return null;
  }

  // Builds a stable identifier for a face selection.
  private getMeasurementFaceKey(hit: MeasurementFaceHit): string {
    const faceIndicesKey = hit.faceIndices?.length
      ? hit.faceIndices.join('-')
      : hit.facePoints.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`).join('|');

    return `${hit.modelId}:${hit.localId}:${hit.itemId}:${faceIndicesKey}`;
  }

  // Extracts world-space triangles for a local item geometry chunk.
  private extractMeasurementTriangles(geometryChunk: any): MeasurementAreaTriangle[] {
    if (!this.moduloThree || !geometryChunk?.positions || !geometryChunk?.indices || !geometryChunk?.transform) return [];

    const positions = geometryChunk.positions instanceof Float32Array ? geometryChunk.positions : new Float32Array(geometryChunk.positions);
    const indices = geometryChunk.indices instanceof Uint32Array || geometryChunk.indices instanceof Uint16Array
      ? Array.from(geometryChunk.indices)
      : Array.isArray(geometryChunk.indices)
        ? geometryChunk.indices
        : [];
    const transform = geometryChunk.transform;
    const sourceIndices = indices.length ? indices : Array.from({ length: Math.floor(positions.length / 3) }, (_, index) => index);
    const triangles: MeasurementAreaTriangle[] = [];
    const v0 = new this.moduloThree.Vector3();
    const v1 = new this.moduloThree.Vector3();
    const v2 = new this.moduloThree.Vector3();
    const edgeA = new this.moduloThree.Vector3();
    const edgeB = new this.moduloThree.Vector3();
    const normal = new this.moduloThree.Vector3();

    for (let index = 0; index + 2 < sourceIndices.length; index += 3) {
      const i0 = sourceIndices[index];
      const i1 = sourceIndices[index + 1];
      const i2 = sourceIndices[index + 2];
      if ([i0, i1, i2].some((value) => !Number.isInteger(value))) continue;

      v0.fromArray(positions, i0 * 3).applyMatrix4(transform);
      v1.fromArray(positions, i1 * 3).applyMatrix4(transform);
      v2.fromArray(positions, i2 * 3).applyMatrix4(transform);

      edgeA.copy(v1).sub(v0);
      edgeB.copy(v2).sub(v0);
      normal.crossVectors(edgeA, edgeB);
      const area = 0.5 * normal.length();
      if (!Number.isFinite(area) || area <= 0) continue;

      normal.normalize();

      triangles.push({
        index: Math.floor(index / 3),
        points: [v0.clone(), v1.clone(), v2.clone()],
        normal: normal.clone(),
        planeConstant: -normal.dot(v0),
        area,
        vertexKeys: [v0, v1, v2].map((point) => this.getPointKey(point)) as [string, string, string],
      });
    }

    return triangles;
  }

  // Finds the triangle in a geometry chunk that matches the clicked face points.
  private findMatchingTriangleIndex(triangles: MeasurementAreaTriangle[], facePoints: Vector3[]): number | null {
    if (!facePoints.length) return null;
    const targetKeys = facePoints.map((point) => this.getPointKey(point)).sort();

    for (const triangle of triangles) {
      const triangleKeys = [...triangle.vertexKeys].sort();
      if (triangleKeys.length !== targetKeys.length) continue;
      if (triangleKeys.every((key, index) => key === targetKeys[index])) return triangle.index;
    }

    return null;
  }

  // Flood-fills the coplanar, edge-adjacent triangle region around the clicked triangle.
  private collectCoplanarTriangleRegion(triangles: MeasurementAreaTriangle[], seedTriangleIndex: number): number[] {
    const region = new Set<number>([seedTriangleIndex]);
    const queue: number[] = [seedTriangleIndex];
    const triangleByIndex = new Map(triangles.map((triangle) => [triangle.index, triangle] as const));
    const trianglesByVertex = new Map<string, number[]>();

    for (const triangle of triangles) {
      for (const vertexKey of triangle.vertexKeys) {
        const list = trianglesByVertex.get(vertexKey) ?? [];
        list.push(triangle.index);
        trianglesByVertex.set(vertexKey, list);
      }
    }

    const seedTriangle = triangleByIndex.get(seedTriangleIndex);
    if (!seedTriangle) return [];

    while (queue.length) {
      const currentIndex = queue.shift() ?? -1;
      const currentTriangle = triangleByIndex.get(currentIndex);
      if (!currentTriangle) continue;

      const candidateIndices = new Set<number>();
      for (const vertexKey of currentTriangle.vertexKeys) {
        for (const neighborIndex of trianglesByVertex.get(vertexKey) ?? []) {
          if (neighborIndex !== currentIndex) candidateIndices.add(neighborIndex);
        }
      }

      for (const candidateIndex of candidateIndices) {
        if (region.has(candidateIndex)) continue;
        const candidateTriangle = triangleByIndex.get(candidateIndex);
        if (!candidateTriangle) continue;
        if (!this.areTrianglesCoplanar(seedTriangle, candidateTriangle)) continue;
        if (!this.shareEdge(currentTriangle, candidateTriangle)) continue;

        region.add(candidateIndex);
        queue.push(candidateIndex);
      }
    }

    return Array.from(region);
  }

  // Serializes a 3D point into a stable key for triangle comparisons.
  private getPointKey(point: Vector3): string {
    return `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`;
  }

  // Checks whether two triangles share at least one edge.
  private shareEdge(first: MeasurementAreaTriangle, second: MeasurementAreaTriangle): boolean {
    let sharedVertices = 0;
    for (const key of first.vertexKeys) {
      if (second.vertexKeys.includes(key)) sharedVertices += 1;
    }

    return sharedVertices >= 2;
  }

  // Checks whether two triangles lie on the same plane.
  private areTrianglesCoplanar(seed: MeasurementAreaTriangle, candidate: MeasurementAreaTriangle): boolean {
    const normalDot = Math.abs(seed.normal.dot(candidate.normal));
    if (normalDot < 0.999) return false;

    const point = candidate.points[0];
    const distance = Math.abs(seed.normal.dot(point) + seed.planeConstant);
    return distance <= 0.001;
  }

  // Creates a translucent overlay mesh for the selected face region.
  private createAreaMeasurementOverlay(triangles: Vector3[][]): any | null {
    if (!this.moduloThree || !triangles.length) return null;

    const group = new this.moduloThree.Group();
    group.name = 'measurement-area-overlay';
    group.renderOrder = 10001;
    group.frustumCulled = false;

    const geometry = new this.moduloThree.BufferGeometry();
    const positions: number[] = [];
    for (const triangle of triangles) {
      if (triangle.length < 3) continue;
      for (const point of triangle) {
        positions.push(point.x, point.y, point.z);
      }
    }

    const indices: number[] = [];
    for (let index = 0; index < positions.length / 3; index += 3) {
      indices.push(index, index + 1, index + 2);
    }

    geometry.setAttribute('position', new this.moduloThree.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const fillMaterial = new this.moduloThree.MeshBasicMaterial({
      color: new this.moduloThree.Color(this.measurementSelectionColor),
      transparent: true,
      opacity: 0.42,
      depthTest: false,
      depthWrite: false,
      side: this.moduloThree.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });

    const fillMesh = new this.moduloThree.Mesh(geometry, fillMaterial);
    fillMesh.renderOrder = 10001;
    fillMesh.frustumCulled = false;
    group.add(fillMesh);

    const outline = this.createAreaMeasurementOutline(triangles);
    if (outline) group.add(outline);

    return group;
  }

  // Creates an outline for the selected face region so the selection remains visible.
  private createAreaMeasurementOutline(triangles: Vector3[][]): any | null {
    if (!this.moduloThree || !triangles.length) return null;

    type AreaEdgeInfo = {
      count: number;
      start: Vector3;
      end: Vector3;
    };

    const edges = new Map<string, AreaEdgeInfo>();

    for (const triangle of triangles) {
      if (triangle.length < 3) continue;

      const triangleEdges: Array<[Vector3, Vector3]> = [
        [triangle[0], triangle[1]],
        [triangle[1], triangle[2]],
        [triangle[2], triangle[0]],
      ];

      for (const [start, end] of triangleEdges) {
        const key = this.getOrderedEdgeKey(start, end);
        const existing = edges.get(key);
        if (existing) {
          existing.count += 1;
          continue;
        }

        edges.set(key, {
          count: 1,
          start: start.clone(),
          end: end.clone(),
        });
      }
    }

    const positions: number[] = [];
    for (const edge of edges.values()) {
      if (edge.count !== 1) continue;
      positions.push(edge.start.x, edge.start.y, edge.start.z, edge.end.x, edge.end.y, edge.end.z);
    }

    if (!positions.length) return null;

    const geometry = new this.moduloThree.BufferGeometry();
    geometry.setAttribute('position', new this.moduloThree.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();

    const material = new this.moduloThree.LineBasicMaterial({
      color: new this.moduloThree.Color(this.measurementSelectionColor),
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
    });

    const lines = new this.moduloThree.LineSegments(geometry, material);
    lines.renderOrder = 10002;
    lines.frustumCulled = false;
    return lines;
  }

  // Builds a stable key for an edge regardless of its direction.
  private getOrderedEdgeKey(first: Vector3, second: Vector3): string {
    const firstKey = this.getPointKey(first);
    const secondKey = this.getPointKey(second);
    return firstKey <= secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
  }

  // Removes a face overlay and disposes its resources.
  private removeAreaMeasurementFace(selection: MeasurementFaceSelection): void {
    this.measurementOverlayGroup?.remove(selection.overlay);
    this.disposeMeasurementOverlay(selection.overlay);
  }

  // Clears all face selections and their overlays.
  private clearAreaMeasurementSelections(): void {
    for (const selection of this.measurementFaceSelections.values()) {
      this.removeAreaMeasurementFace(selection);
    }

    this.measurementFaceSelections.clear();
    this.areaMeasurementSummary.set(null);
  }

  // Clears the active length selection anchors and their overlay.
  private clearLengthMeasurementSelections(): void {
    this.measurementLengthAnchors.clear();
    this.removeLengthMeasurementOverlay();
    this.lengthMeasurementSummary.set(null);
    this.clearLengthEdgeMeasurement();
  }

  // Updates the aggregate area summary from the current face selections.
  private updateAreaMeasurementSummary(): void {
    if (!this.measurementFaceSelections.size) {
      this.areaMeasurementSummary.set(null);
      return;
    }

    let totalArea = 0;
    const objectKeys = new Set<string>();
    const selections = Array.from(this.measurementFaceSelections.values())
      .map((selection) => ({
        key: selection.key,
        modelId: selection.modelId,
        localId: selection.localId,
        itemId: selection.itemId,
        label: selection.label,
        area: selection.area,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    for (const selection of this.measurementFaceSelections.values()) {
      totalArea += selection.area;
      objectKeys.add(`${selection.modelId}:${selection.localId}`);
    }

    this.areaMeasurementSummary.set({
      totalArea,
      selectedFaceCount: this.measurementFaceSelections.size,
      selectedObjectCount: objectKeys.size,
      selections,
    });

  }

  // Updates the active length summary and rebuilds the overlay line.
  private updateLengthMeasurementSummary(): void {
    const anchors = Array.from(this.measurementLengthAnchors.values());
    if (!anchors.length) {
      this.lengthMeasurementSummary.set(null);
      this.removeLengthMeasurementOverlay();
      return;
    }

    const normalizedAnchors = anchors.map((anchor) => ({ ...anchor }));
    const distance =
      normalizedAnchors.length >= 2
        ? this.getDistanceBetweenAnchors(normalizedAnchors[0], normalizedAnchors[1])
        : null;

    this.lengthMeasurementSummary.set({
      distance,
      anchorCount: normalizedAnchors.length,
      anchors: normalizedAnchors,
    });

    this.updateLengthMeasurementOverlay(normalizedAnchors);
  }

  // Updates the edge-based length summary and rebuilds its overlay.
  private updateLengthEdgeMeasurementSummary(): void {
    if (this.lengthEdgeSelection) {
      const distance = this.getDistanceBetweenEdgePoints(this.lengthEdgeSelection);
      if (!Number.isFinite(distance)) {
        this.lengthEdgeMeasurementSummary.set(null);
        this.removeLengthEdgeMeasurementOverlay();
        return;
      }
      this.lengthEdgeMeasurementSummary.set({
        distance,
        edge: { ...this.lengthEdgeSelection },
        isPinned: true,
      });
      this.updateLengthEdgeMeasurementOverlay(this.lengthEdgeSelection);
      return;
    }

    if (this.lengthEdgePreview) {
      const distance = this.getDistanceBetweenEdgePoints(this.lengthEdgePreview);
      if (!Number.isFinite(distance)) {
        this.lengthEdgeMeasurementSummary.set(null);
        this.removeLengthEdgeMeasurementOverlay();
        return;
      }
      this.lengthEdgeMeasurementSummary.set({
        distance,
        edge: { ...this.lengthEdgePreview },
        isPinned: false,
      });
      this.updateLengthEdgeMeasurementOverlay(this.lengthEdgePreview);
      return;
    }

    this.lengthEdgeMeasurementSummary.set(null);
    this.removeLengthEdgeMeasurementOverlay();
  }

  // Rebuilds the overlay line and markers for the current length measurement.
  private updateLengthMeasurementOverlay(anchors: MeasurementLengthAnchor[]): void {
    if (!this.moduloThree || !this.measurementOverlayGroup) return;

    this.removeLengthMeasurementOverlay();

    if (!anchors.length) return;

    const group = new this.moduloThree.Group();
    group.name = 'measurement-length-overlay';
    group.renderOrder = 10002;
    group.frustumCulled = false;

    const sphereRadius = this.getMeasurementMarkerRadius(anchors);

    for (const anchor of anchors) {
      const marker = this.createLengthMeasurementMarker(anchor, sphereRadius);
      if (marker) group.add(marker);
    }

    if (anchors.length >= 2) {
      const line = this.createLengthMeasurementLine(anchors[0], anchors[1]);
      if (line) group.add(line);
    }

    this.measurementOverlayGroup.add(group);
    this.lengthMeasurementOverlay = group;
  }

  // Rebuilds the overlay line and markers for an edge-based length measurement.
  private updateLengthEdgeMeasurementOverlay(edge: MeasurementLengthEdge): void {
    if (!this.moduloThree || !this.measurementOverlayGroup) return;

    this.removeLengthEdgeMeasurementOverlay();

    const group = new this.moduloThree.Group();
    group.name = 'measurement-length-edge-overlay';
    group.renderOrder = 10002;
    group.frustumCulled = false;

    const startAnchor = {
      ...edge.start,
      label: edge.label,
      localId: edge.localId,
      itemId: edge.itemId,
      modelId: edge.modelId,
    } as MeasurementLengthAnchor;
    const endAnchor = {
      ...edge.end,
      label: edge.label,
      localId: edge.localId,
      itemId: edge.itemId,
      modelId: edge.modelId,
    } as MeasurementLengthAnchor;
    const sphereRadius = Math.max(this.getDistanceBetweenEdgePoints(edge) * 0.015, 0.035);

    const startMarker = this.createLengthMeasurementMarker(startAnchor, sphereRadius);
    if (startMarker) group.add(startMarker);

    const endMarker = this.createLengthMeasurementMarker(endAnchor, sphereRadius);
    if (endMarker) group.add(endMarker);

    const line = this.createLengthMeasurementLine(startAnchor, endAnchor);
    if (line) group.add(line);

    this.measurementOverlayGroup.add(group);
    this.lengthEdgeMeasurementOverlay = group;
  }

  // Removes the active length overlay group from the scene.
  private removeLengthMeasurementOverlay(): void {
    if (!this.lengthMeasurementOverlay) return;

    this.measurementOverlayGroup?.remove(this.lengthMeasurementOverlay);
    this.disposeMeasurementOverlay(this.lengthMeasurementOverlay);
    this.lengthMeasurementOverlay = null;
  }

  // Removes the active edge overlay group from the scene.
  private removeLengthEdgeMeasurementOverlay(): void {
    if (!this.lengthEdgeMeasurementOverlay) return;

    this.measurementOverlayGroup?.remove(this.lengthEdgeMeasurementOverlay);
    this.disposeMeasurementOverlay(this.lengthEdgeMeasurementOverlay);
    this.lengthEdgeMeasurementOverlay = null;
  }

  // Disposes geometry and material associated with a measurement overlay.
  private disposeMeasurementOverlay(overlay: any): void {
    if (!overlay) return;

    if (typeof overlay.traverse === 'function') {
      overlay.traverse((child: any) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) {
          for (const material of child.material) material?.dispose?.();
          return;
        }
        child.material?.dispose?.();
      });
    }

    overlay.geometry?.dispose?.();
    overlay.material?.dispose?.();
  }

  // Builds a readable label for a measured object.
  private getMeasurementEntityLabel(modelId: string, localId: number): string {
    const registro = this.registrosArbol.get(localId);
    const baseLabel = [registro?.ifcClass, registro?.name].filter((value) => !!value && value !== '-').join(' ');
    if (baseLabel.trim()) return baseLabel.trim();

    const fallbackModel = this.getModelById(modelId);
    const modelLabel = fallbackModel?.name ?? fallbackModel?.userData?.name ?? '';
    if (modelLabel) return `${modelLabel} #${localId}`;

    return `Elemento ${localId}`;
  }

  // Builds a stable key for a length measurement anchor.
  private getMeasurementLengthAnchorKey(hit: MeasurementLengthHit): string {
    return `${hit.modelId}:${hit.localId}:${hit.itemId}:${hit.point.x.toFixed(4)},${hit.point.y.toFixed(4)},${hit.point.z.toFixed(4)}`;
  }

  // Returns true when two length anchors belong to the same object.
  private isSameMeasurementObject(anchor: MeasurementLengthAnchor, hit: MeasurementLengthHit): boolean {
    return anchor.modelId === hit.modelId && anchor.localId === hit.localId;
  }

  // Creates a cloned point to avoid sharing mutable raycast vectors.
  private clonePoint(point: Vector3 | undefined): Vector3 {
    if (!this.moduloThree || !point) return point as Vector3;
    return point.clone?.() ?? new this.moduloThree.Vector3(point.x, point.y, point.z);
  }

  // Returns the distance between two measurement anchors.
  private getDistanceBetweenAnchors(first: MeasurementLengthAnchor, second: MeasurementLengthAnchor): number {
    if (!this.moduloThree) return Number.NaN;

    const start = new this.moduloThree.Vector3(first.x, first.y, first.z);
    const end = new this.moduloThree.Vector3(second.x, second.y, second.z);
    return start.distanceTo(end);
  }

  // Returns the distance between the endpoints of an edge-based measurement.
  private getDistanceBetweenEdgePoints(edge: MeasurementLengthEdge): number {
    if (!this.moduloThree) return Number.NaN;

    const start = new this.moduloThree.Vector3(edge.start.x, edge.start.y, edge.start.z);
    const end = new this.moduloThree.Vector3(edge.end.x, edge.end.y, edge.end.z);
    return start.distanceTo(end);
  }

  // Creates a marker mesh for a length measurement anchor.
  private createLengthMeasurementMarker(anchor: MeasurementLengthAnchor, radius: number): any | null {
    if (!this.moduloThree) return null;

    const geometry = new this.moduloThree.SphereGeometry(radius, 16, 16);
    const material = new this.moduloThree.MeshBasicMaterial({
      color: new this.moduloThree.Color(this.measurementSelectionColor),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const marker = new this.moduloThree.Mesh(geometry, material);
    marker.position.set(anchor.x, anchor.y, anchor.z);
    marker.renderOrder = 10003;
    marker.frustumCulled = false;
    return marker;
  }

  // Creates the line connecting the current pair of length anchors.
  private createLengthMeasurementLine(first: MeasurementLengthAnchor, second: MeasurementLengthAnchor): any | null {
    if (!this.moduloThree) return null;

    const start = new this.moduloThree.Vector3(first.x, first.y, first.z);
    const end = new this.moduloThree.Vector3(second.x, second.y, second.z);
    const geometry = new this.moduloThree.BufferGeometry().setFromPoints([
      start,
      end,
    ]);
    const distance = start.distanceTo(end);
    const dashSize = Math.max(distance * 0.08, 0.15);
    const gapSize = Math.max(dashSize * 0.6, 0.08);
    const material = new this.moduloThree.LineDashedMaterial({
      color: new this.moduloThree.Color(this.measurementSelectionColor),
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      dashSize,
      gapSize,
    });
    const line = new this.moduloThree.Line(geometry, material);
    line.computeLineDistances();
    line.renderOrder = 10002;
    line.frustumCulled = false;
    return line;
  }

  // Chooses a radius that keeps the length markers readable in different model scales.
  private getMeasurementMarkerRadius(anchors: MeasurementLengthAnchor[]): number {
    if (!anchors.length) return 0.04;

    const firstAnchor = anchors[0];
    const secondAnchor = anchors[1];
    if (!firstAnchor || !secondAnchor) return 0.04;

    const distance = this.getDistanceBetweenAnchors(firstAnchor, secondAnchor);
    if (!Number.isFinite(distance) || distance <= 0) return 0.04;

    return Math.max(distance * 0.015, 0.035);
  }

  // Switches the highlighter tint used while measurement mode is active.
  private async applyMeasurementSelectionStyle(enabled: boolean): Promise<void> {
    if (!this.resaltador || !this.moduloThree) return;

    const currentDefinition = this.resaltador.config?.selectMaterialDefinition;
    const nextColor = new this.moduloThree.Color(enabled ? this.measurementSelectionColor : this.defaultSelectionColor);
    const nextDefinition = {
      ...(currentDefinition ?? {
        opacity: 1,
        transparent: false,
        renderedFaces: 0,
      }),
      color: nextColor,
    };

    this.resaltador.config.selectMaterialDefinition = nextDefinition;
    this.resaltador.styles.set(this.resaltador.config.selectName, nextDefinition);

    if (typeof this.resaltador.updateColors === 'function') {
      await this.resaltador.updateColors();
    }
  }

  // Computes the area of a polygon by triangulating it from the first point.
  private computePolygonArea(facePoints: Vector3[]): number {
    if (!this.moduloThree || facePoints.length < 3) return 0;

    const origin = facePoints[0];
    const edgeA = new this.moduloThree.Vector3();
    const edgeB = new this.moduloThree.Vector3();
    const cross = new this.moduloThree.Vector3();
    let area = 0;

    for (let index = 1; index < facePoints.length - 1; index += 1) {
      edgeA.copy(facePoints[index]).sub(origin);
      edgeB.copy(facePoints[index + 1]).sub(origin);
      cross.crossVectors(edgeA, edgeB);
      area += 0.5 * cross.length();
    }

    return area;
  }

  // Returns visible model objects that can be used as raycast targets.
  private getInteractableModelObjects(): any[] {
    return this.getLoadedModels()
      .filter((model) => {
        const modelId = this.getModelId(model);
        return model?.object?.visible && (!modelId || !this.hiddenModelIds.has(modelId));
      })
      .map((model) => model.object)
      .filter(Boolean);
  }

  // Calculates the first world-space intersection point from pointer coordinates.
  private obtenerPuntoInterseccion(
    pointerPosition: { x: number; y: number },
    objects: any[],
  ): Vector3 | null {
    if (!this.moduloThree || !objects.length) return null;

    const camera = this.mundo?.camera?.three;
    if (!camera) return null;

    const raycaster = new this.moduloThree.Raycaster();
    const pointer = new this.moduloThree.Vector2(pointerPosition.x, pointerPosition.y);
    raycaster.setFromCamera(pointer, camera);

    let closestPoint: Vector3 | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const object of objects) {
      try {
        const intersections = raycaster.intersectObject(object, true);
        const firstValidIntersection = intersections.find(
          (intersection) =>
            !!intersection?.point &&
            typeof intersection.distance === 'number' &&
            Number.isFinite(intersection.distance),
        );

        if (!firstValidIntersection || firstValidIntersection.distance >= closestDistance) continue;
        closestDistance = firstValidIntersection.distance;
        closestPoint = firstValidIntersection.point.clone?.() ?? firstValidIntersection.point;
      } catch {
        // Ignore malformed geometries and continue with the next object.
        continue;
      }
    }

    return closestPoint;
  }

  // Keeps the local selection cache aligned with the highlighter selection.
  private updateSelectionFromMap(selectionMap: Record<string, Set<number>>): void {
    this.selectedModelItems = this.cloneSelectionMap(selectionMap);
    this.seleccionActual.set(this.cloneSelectionMap(selectionMap));
    this.activeModelId = this.resolveActiveModelIdFromSelection(selectionMap) ?? this.activeModelId;
    this.syncModelVisualGuides();
    void this.refreshSelectionFilter();
    void this.applyPersistentTransparencyForActiveModel();
    void this.updateSelectedElementInformation();
  }

  // Loads the first selected element information into the properties panels.
  private async updateSelectedElementInformation(): Promise<void> {
    const firstSelection = this.getFirstSelectedElement();

    if (!firstSelection) {
      this.informacionSeleccionada.set(null);
      return;
    }

    const model = this.getModelById(firstSelection.modelId);
    if (!model) return;

    try {
      const { informacion, esfera } = await this.construirInformacionSeleccionada(model, firstSelection.localId);
      this.cacheSeleccion.set(`click-${firstSelection.localId}`, { info: informacion, sphere: esfera });
      this.informacionSeleccionada.set(informacion);
    } catch (error) {
      console.warn('Could not update selected element information:', error);
    }
  }

  // Applies visibility to the selected model items.
  private async applyVisibilityToSelectedElements(visible: boolean): Promise<void> {
    await this.applyVisibilityToSelection(this.getActiveModelSelectionMap(this.selectedModelItems), visible);
  }

  // Applies opacity to the selected model items.
  private async applyOpacityToSelectedElements(opacity: number): Promise<void> {
    await this.applyOpacityToSelection(this.getActiveModelSelectionMap(this.selectedModelItems), opacity);
  }

  // Applies visibility to every known element outside the current selection.
  private async applyVisibilityToNotSelectedElements(visible: boolean): Promise<void> {
    await this.applyVisibilityToSelection(await this.getNotSelectedModelItemMap(), visible);
  }

  // Applies opacity to every known element outside the current selection.
  private async applyOpacityToNotSelectedElements(opacity: number): Promise<void> {
    await this.applyOpacityToSelection(await this.getNotSelectedModelItemMap(), opacity);
  }

  // Applies visibility to a model item map and refreshes fragments.
  private async applyVisibilityToSelection(selectionMap: Record<string, Set<number>>, visible: boolean): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const [modelId, localIdSet] of Object.entries(selectionMap)) {
      const model = this.getModelById(modelId);
      const localIds = Array.from(localIdSet);
      if (!model || !localIds.length) continue;

      tasks.push(model.setVisible(localIds, visible));
      if (visible && model.resetOpacity) tasks.push(model.resetOpacity(localIds));
    }

    await Promise.all(tasks);
    this.fragmentos?.core?.update?.(true);
    await this.refreshSelectionFilter();
  }

  // Applies opacity to a model item map and refreshes fragments.
  private async applyOpacityToSelection(selectionMap: Record<string, Set<number>>, opacity: number): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const [modelId, localIdSet] of Object.entries(selectionMap)) {
      const model = this.getModelById(modelId);
      const localIds = Array.from(localIdSet);
      if (!model || !localIds.length) continue;

      tasks.push(model.setVisible(localIds, true));
      if (model.setOpacity) tasks.push(model.setOpacity(localIds, opacity));
    }

    await Promise.all(tasks);
    this.fragmentos?.core?.update?.(true);
    await this.refreshSelectionFilter();
  }

  // Restores visibility and opacity for a single model.
  private async resetModelVisibility(model: any): Promise<void> {
    await model.resetVisible?.();
    await model.resetOpacity?.(undefined);
    const modelId = this.getModelId(model);
    if (modelId) await this.applyPersistentTransparencyForModel(modelId);
  }

  // Saves persistent transparency for the active model and reapplies it.
  private async setActiveModelTransparency(localIds: number[], opacity: number): Promise<void> {
    const activeModel = this.getActiveModel();
    const activeModelId = this.getModelId(activeModel);
    if (!activeModel || !activeModelId || !localIds.length) return;

    this.modelTransparencyState.set(activeModelId, {
      opacity,
      localIds: new Set(localIds),
    });

    await this.applyPersistentTransparencyForModel(activeModelId);
  }

  // Clears persistent transparency for the active model.
  private clearActiveModelTransparencyState(): void {
    const activeModelId = this.getModelId(this.getActiveModel());
    if (!activeModelId) return;

    this.modelTransparencyState.delete(activeModelId);
    const activeModel = this.getModelById(activeModelId);
    void activeModel?.resetOpacity?.(undefined);
  }

  // Reapplies persistent transparency for the active model, when any.
  private async applyPersistentTransparencyForActiveModel(): Promise<void> {
    const activeModelId = this.getModelId(this.getActiveModel());
    if (!activeModelId) return;
    await this.applyPersistentTransparencyForModel(activeModelId);
  }

  // Reapplies persistent transparency for a given model.
  private async applyPersistentTransparencyForModel(modelId: string): Promise<void> {
    const model = this.getModelById(modelId);
    const state = this.modelTransparencyState.get(modelId);
    if (!model || !state) return;

    const localIds = Array.from(state.localIds);
    if (!localIds.length) return;

    await model.resetOpacity?.(undefined);
    await model.setOpacity?.(localIds, state.opacity);
    this.fragmentos?.core?.update?.(true);
  }

  // Creates a selection map for every known element not currently selected.
  private async getNotSelectedModelItemMap(): Promise<Record<string, Set<number>>> {
    const result: Record<string, Set<number>> = {};
    const activeModel = this.getActiveModel();
    const activeModelId = this.getModelId(activeModel);
    if (!activeModel || !activeModelId) return result;

    const knownLocalIds = await this.getKnownElementLocalIds(activeModel, activeModelId);
    const selectedItems = this.selectedModelItems[activeModelId] ?? new Set<number>();
    result[activeModelId] = new Set(knownLocalIds.filter((localId) => !selectedItems.has(localId)));

    return result;
  }

  // Returns the local IDs known by the active B5D tree model.
  private async getKnownElementLocalIds(model: any, modelId: string): Promise<number[]> {
    const activeTreeModelId = this.getModelId(this.modeloCargado);
    const localIds =
      activeTreeModelId && activeTreeModelId === modelId ? Array.from(this.registrosArbol.keys()) : [];
    if (localIds.length) return localIds;

    // Avoid querying stale fragment models that may still exist in the list map
    // while the worker has already dropped their internal model reference.
    return [];
  }

  // Moves the selected elements so their center reaches the clicked point.
  private async moveSelectionToPoint(selectionMap: Record<string, Set<number>>, targetPoint: Vector3): Promise<void> {
    const boundingBox = await this.getSelectionBoundingBox(selectionMap);
    if (!boundingBox || boundingBox.isEmpty()) return;

    const center = boundingBox.getCenter(new this.moduloThree!.Vector3());
    const movement = targetPoint.clone().sub(center);
    this.applyMovementAxis(movement);

    if (movement.lengthSq() === 0) return;
    await this.moveSelectionByVector(selectionMap, movement);
  }

  // Applies the active axis constraint to a movement vector.
  private applyMovementAxis(movement: Vector3): void {
    if (!this.activeMovementAxis) return;

    if (this.activeMovementAxis !== 'x') movement.x = 0;
    if (this.activeMovementAxis !== 'y') movement.y = 0;
    if (this.activeMovementAxis !== 'z') movement.z = 0;
  }

  // Applies a transform translation to every selected model item.
  private async moveSelectionByVector(selectionMap: Record<string, Set<number>>, movement: Vector3): Promise<void> {
    for (const [modelId, localIdSet] of Object.entries(selectionMap)) {
      const model = this.getModelById(modelId);
      const localIds = Array.from(localIdSet);
      if (!model || !localIds.length) continue;

      const transformIds = await model.getGlobalTranformsIdsOfItems(localIds);
      const transforms: Map<number, FragmentTransform> = await model.getGlobalTransforms(transformIds);
      const requests: unknown[] = [];

      for (const [transformId, transform] of transforms) {
        const transformKey = this.getTransformKey(modelId, transformId);
        if (!this.originalMovedTransforms.has(transformKey)) {
          this.originalMovedTransforms.set(transformKey, this.cloneFragmentTransform(transform));
        }

        const nextTransform = this.cloneFragmentTransform(transform);
        nextTransform.position = [
          nextTransform.position[0] + movement.x,
          nextTransform.position[1] + movement.y,
          nextTransform.position[2] + movement.z,
        ];

        requests.push({
          type: 10,
          localId: transformId,
          data: nextTransform,
        });
      }

      if (requests.length) await model.edit(requests);
    }

    this.fragmentos?.core?.update?.(true);
    this.syncModelVisualGuides();
  }

  // Restores movement for every transform linked to a selection map.
  private async restoreMovementForSelection(selectionMap: Record<string, Set<number>>): Promise<void> {
    const transformKeys: string[] = [];

    for (const [modelId, localIdSet] of Object.entries(selectionMap)) {
      const model = this.getModelById(modelId);
      const localIds = Array.from(localIdSet);
      if (!model || !localIds.length) continue;

      const transformIds = await model.getGlobalTranformsIdsOfItems(localIds);
      transformKeys.push(...transformIds.map((transformId: number) => this.getTransformKey(modelId, transformId)));
    }

    await this.restoreMovementForKeys(transformKeys);
  }

  // Restores movement for the provided transform keys.
  private async restoreMovementForKeys(transformKeys: string[]): Promise<void> {
    const requestsByModel = new Map<string, unknown[]>();

    for (const transformKey of transformKeys) {
      const originalTransform = this.originalMovedTransforms.get(transformKey);
      if (!originalTransform) continue;

      const { modelId, transformId } = this.parseTransformKey(transformKey);
      const requests = requestsByModel.get(modelId) ?? [];
      requests.push({
        type: 10,
        localId: transformId,
        data: this.cloneFragmentTransform(originalTransform),
      });
      requestsByModel.set(modelId, requests);
    }

    for (const [modelId, requests] of requestsByModel) {
      const model = this.getModelById(modelId);
      if (!model || !requests.length) continue;
      await model.edit(requests);
    }

    for (const transformKey of transformKeys) {
      this.originalMovedTransforms.delete(transformKey);
    }

    this.fragmentos?.core?.update?.(true);
    this.syncModelVisualGuides();
  }

  // Frames the camera from a direction around the model center.
  private async setModelViewFromDirection(x: number, y: number, z: number): Promise<void> {
    const boundingBox = this.getActiveModelBoundingBox() ?? this.getFullModelBoundingBox();
    const sphere = this.getBoundingSphere(boundingBox);
    const center = this.getOrbitPivot(sphere?.center ?? null);
    const radius = sphere?.radius && Number.isFinite(sphere.radius) ? sphere.radius : 10;
    const direction = new this.moduloThree!.Vector3(x, y, z).normalize();
    const distance = Math.max(radius * 2.4, 10);
    const position = center.clone().add(direction.multiplyScalar(distance));

    await this.mundo?.camera?.controls?.setOrbitPoint?.(center.x, center.y, center.z);
    await this.mundo?.camera?.controls?.setLookAt(
      position.x,
      position.y,
      position.z,
      center.x,
      center.y,
      center.z,
      true,
    );
  }

  // Focuses the camera on the provided bounding box.
  private async focusBoundingBox(boundingBox: Box3 | null): Promise<void> {
    const sphere = this.getBoundingSphere(boundingBox);
    if (!sphere) {
      await this.restablecerVista();
      return;
    }

    this.setOrbitPivot(sphere.center);
    await this.mundo?.camera?.controls?.setOrbitPoint?.(sphere.center.x, sphere.center.y, sphere.center.z);
    await this.enfocarEsfera(this.mundo, sphere);
  }

  // Builds a bounding sphere from a model bounding box.
  private getBoundingSphere(boundingBox: Box3 | null): Sphere | null {
    if (!boundingBox || boundingBox.isEmpty() || !this.moduloThree) return null;
    return boundingBox.getBoundingSphere(new this.moduloThree.Sphere());
  }

  // Gets the bounding box for the active highlighter selection.
  private async getSelectedElementsBoundingBox(): Promise<Box3 | null> {
    return this.getSelectionBoundingBox(this.getActiveModelSelectionMap(this.selectedModelItems));
  }

  // Gets the bounding box for a selection map.
  private async getSelectionBoundingBox(selectionMap: Record<string, Set<number>>): Promise<Box3 | null> {
    if (!this.moduloThree) return null;

    const boundingBox = new this.moduloThree.Box3();

    for (const [modelId, localIdSet] of Object.entries(selectionMap)) {
      const model = this.getModelById(modelId);
      const localIds = Array.from(localIdSet);
      if (!model || !localIds.length || !model.getBBoxes) continue;

      const modelBoundingBox = await model.getBBoxes(localIds);
      if (modelBoundingBox && !modelBoundingBox.isEmpty()) boundingBox.union(modelBoundingBox);
    }

    return boundingBox.isEmpty() ? null : boundingBox;
  }

  // Gets the bounding box that contains every loaded model.
  private getFullModelBoundingBox(): Box3 | null {
    if (!this.moduloThree) return null;

    const boundingBox = new this.moduloThree.Box3();

    for (const model of this.getLoadedModels()) {
      let modelBoundingBox = model.getFullBBox?.();
      if (!modelBoundingBox || modelBoundingBox.isEmpty()) {
        modelBoundingBox = this.getObjectBoundingBox(model.object);
      }
      if (modelBoundingBox && !modelBoundingBox.isEmpty()) boundingBox.union(modelBoundingBox);
    }

    return boundingBox.isEmpty() ? null : boundingBox;
  }

  // Rebuilds model grid and axis overlays from current model bounds.
  private syncModelVisualGuides(): void {
    if (!this.moduloThree || !this.mundo?.scene?.three) return;

    const boundingBox = this.getActiveModelBoundingBox() ?? this.getFullModelBoundingBox();
    if (!boundingBox || boundingBox.isEmpty()) return;

    const center = boundingBox.getCenter(new this.moduloThree.Vector3());
    const size = boundingBox.getSize(new this.moduloThree.Vector3());
    const horizontalSize = Math.max(size.x, size.z, 1);
    const gridSize = Math.max(horizontalSize * 1.15, 2);
    const axisLength = Math.max(Math.min(horizontalSize * 0.01, 14), 1.25);

    this.setOrbitPivot(center);
    this.removeModelVisualGuides();
    this.modelGridHelper = this.createModelGrid(gridSize, center, boundingBox.min.y);
    this.modelAxesOverlay = this.createModelAxesOverlay(center, axisLength);

    this.mundo.scene.three.add(this.modelGridHelper);
    this.mundo.scene.three.add(this.modelAxesOverlay);
  }

  // Removes custom model guides from the scene.
  private removeModelVisualGuides(): void {
    if (!this.mundo?.scene?.three) return;

    if (this.modelGridHelper) {
      this.mundo.scene.three.remove(this.modelGridHelper);
      this.disposeObject3D(this.modelGridHelper);
      this.modelGridHelper = null;
    }

    if (this.modelAxesOverlay) {
      this.mundo.scene.three.remove(this.modelAxesOverlay);
      this.disposeObject3D(this.modelAxesOverlay);
      this.modelAxesOverlay = null;
    }
  }

  // Creates a finite grid placed slightly below the model base.
  private createModelGrid(size: number, center: Vector3, modelBottomY: number): any {
    const divisions = Math.max(8, Math.min(80, Math.round(size)));
    const grid = new this.moduloThree!.GridHelper(size, divisions, 0x7a838f, 0x414953);

    grid.position.set(center.x, modelBottomY - 0.03, center.z);
    grid.renderOrder = 12;

    const materialList = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of materialList) {
      material.transparent = true;
      material.opacity = 0.72;
      material.depthWrite = false;
    }

    return grid;
  }

  // Creates short axis arrows that remain visible through model geometry.
  private createModelAxesOverlay(center: Vector3, axisLength: number): any {
    const axisGroup = new this.moduloThree!.Group();
    axisGroup.renderOrder = 1000;

    axisGroup.add(this.createAxisArrow(center, new this.moduloThree!.Vector3(1, 0, 0), axisLength, 0xff5f5f));
    axisGroup.add(this.createAxisArrow(center, new this.moduloThree!.Vector3(0, 1, 0), axisLength, 0x5fff7d));
    axisGroup.add(this.createAxisArrow(center, new this.moduloThree!.Vector3(0, 0, 1), axisLength, 0x4da3ff));

    return axisGroup;
  }

  // Creates one highlighted axis arrow.
  private createAxisArrow(origin: Vector3, direction: Vector3, length: number, color: number): any {
    const arrowGroup = new this.moduloThree!.Group();
    const normalizedDirection = direction.clone().normalize();
    const shaftLength = Math.max(length * 0.72, 0.25);
    const headLength = Math.max(length * 0.28, 0.2);
    const shaftRadius = Math.max(length * 0.018, 0.03);
    const headRadius = shaftRadius * 2.6;

    const material = new this.moduloThree!.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const shaftGeometry = new this.moduloThree!.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 12);
    const shaft = new this.moduloThree!.Mesh(shaftGeometry, material);
    shaft.position.set(0, shaftLength * 0.5, 0);
    shaft.renderOrder = 1001;

    const headGeometry = new this.moduloThree!.ConeGeometry(headRadius, headLength, 16);
    const head = new this.moduloThree!.Mesh(headGeometry, material);
    head.position.set(0, shaftLength + headLength * 0.5, 0);
    head.renderOrder = 1001;

    arrowGroup.add(shaft);
    arrowGroup.add(head);

    const up = new this.moduloThree!.Vector3(0, 1, 0);
    arrowGroup.quaternion.setFromUnitVectors(up, normalizedDirection);
    arrowGroup.position.copy(origin);
    arrowGroup.renderOrder = 1001;

    return arrowGroup;
  }

  // Gets a world bounding box from a model object fallback.
  private getObjectBoundingBox(object: any): Box3 | null {
    if (!this.moduloThree || !object) return null;

    const box = new this.moduloThree.Box3();
    box.setFromObject(object);
    return box.isEmpty() ? null : box;
  }

  // Disposes geometry and materials for helper objects.
  private disposeObject3D(object: any): void {
    object?.traverse?.((child: any) => {
      child.geometry?.dispose?.();

      if (Array.isArray(child.material)) {
        child.material.forEach((material: any) => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
  }

  // Stores the orbit pivot used for camera orbit and reset actions.
  private setOrbitPivot(pivot: Vector3): void {
    this.orbitPivot = pivot.clone();
  }

  // Resolves the active orbit pivot, creating it from a fallback if needed.
  private getOrbitPivot(fallback: Vector3 | null): Vector3 {
    if (this.orbitPivot) return this.orbitPivot.clone();

    if (fallback) {
      this.setOrbitPivot(fallback);
      return fallback.clone();
    }

    return new this.moduloThree!.Vector3(0, 0, 0);
  }

  // Returns a defensive copy of the selected model item map.
  private getSelectedModelItemMap(): Record<string, Set<number>> {
    return this.cloneSelectionMap(this.selectedModelItems);
  }

  // Returns only the selected items that belong to the active model.
  private getActiveModelSelectionMap(selectionMap: Record<string, Set<number>>): Record<string, Set<number>> {
    const activeModelId = this.resolveActiveModelIdFromSelection(selectionMap);
    if (!activeModelId) return {};
    if (this.hiddenModelIds.has(activeModelId)) return {};

    const activeItems = selectionMap[activeModelId] ?? new Set<number>();
    return { [activeModelId]: new Set(activeItems) };
  }

  // Resolves which model should be considered active for scoped operations.
  private resolveActiveModelIdFromSelection(selectionMap: Record<string, Set<number>>): string | null {
    if (this.activeModelId && selectionMap[this.activeModelId]?.size) return this.activeModelId;

    for (const [modelId, localIds] of Object.entries(selectionMap)) {
      if (localIds.size) return modelId;
    }

    return this.activeModelId;
  }

  // Clones a model item map without sharing mutable sets.
  private cloneSelectionMap(selectionMap: Record<string, Set<number>>): Record<string, Set<number>> {
    const clone: Record<string, Set<number>> = {};

    for (const [modelId, localIdSet] of Object.entries(selectionMap ?? {})) {
      clone[modelId] = new Set(localIdSet);
    }

    return clone;
  }

  // Returns whether a selection map has at least one element.
  private hasSelectedItems(selectionMap: Record<string, Set<number>>): boolean {
    return Object.values(selectionMap).some((localIdSet) => localIdSet.size > 0);
  }

  // Returns the first selected item to populate the properties panels.
  private getFirstSelectedElement(): { modelId: string; localId: number } | null {
    const scopedSelection = this.getActiveModelSelectionMap(this.selectedModelItems);
    for (const [modelId, localIdSet] of Object.entries(scopedSelection)) {
      const [localId] = localIdSet;
      if (typeof localId === 'number') return { modelId, localId };
    }

    for (const [modelId, localIdSet] of Object.entries(this.selectedModelItems)) {
      const [localId] = localIdSet;
      if (typeof localId === 'number') return { modelId, localId };
    }

    return null;
  }

  // Returns the model currently active for scoped model actions.
  private getActiveModel(): any | null {
    if (this.activeModelId) {
      const model = this.getModelById(this.activeModelId);
      if (model && !this.hiddenModelIds.has(this.activeModelId)) return model;
    }

    const primaryModelId = this.getModelId(this.modeloCargado);
    if (this.modeloCargado && (!primaryModelId || !this.hiddenModelIds.has(primaryModelId))) {
      return this.modeloCargado;
    }

    return this.getLoadedModels().find((model) => {
      const modelId = this.getModelId(model);
      return modelId ? !this.hiddenModelIds.has(modelId) : true;
    }) ?? null;
  }

  // Returns the active model bounding box.
  private getActiveModelBoundingBox(): Box3 | null {
    const activeModel = this.getActiveModel();
    if (!activeModel) return null;

    const modelBoundingBox = activeModel.getFullBBox?.() ?? this.getObjectBoundingBox(activeModel.object);
    if (!modelBoundingBox || modelBoundingBox.isEmpty()) return null;
    return modelBoundingBox;
  }

  // Restricts highlighter selection to visible model items only.
  private async refreshSelectionFilter(): Promise<void> {
    if (!this.resaltador || !this.fragmentos?.list) return;

    const selectableMap: Record<string, Set<number>> = {};
    const staleModelIds = new Set<string>();

    for (const [modelId, model] of this.fragmentos.list) {
      const isVisibleModel = model?.object?.visible && !this.hiddenModelIds.has(modelId);
      if (!isVisibleModel) continue;

      let visibleIds: number[] = [];
      try {
        visibleIds = await this.getKnownElementLocalIds(model, modelId);
      } catch (error) {
        console.warn('Could not refresh selectable items for model visibility filtering.', {
          modelId,
          error,
        });
        staleModelIds.add(modelId);
        continue;
      }

      if (!Array.isArray(visibleIds) || !visibleIds.length) continue;
      selectableMap[modelId] = new Set(visibleIds);
    }

    for (const staleModelId of staleModelIds) {
      delete this.selectedModelItems[staleModelId];
      this.hiddenModelIds.delete(staleModelId);
      if (this.activeModelId === staleModelId) this.activeModelId = null;
    }

    if (staleModelIds.size) {
      this.modelosIfcCargados.update((models) =>
        models.filter((model) => !staleModelIds.has(model.id)),
      );
    }

    this.resaltador.selectable = {
      ...this.resaltador.selectable,
      select: selectableMap,
    };
  }

  // Removes current selection entries from a hidden model.
  private clearSelectionForModel(modelId: string): void {
    if (!this.selectedModelItems[modelId]?.size) return;

    const filterMap = {
      [modelId]: new Set(this.selectedModelItems[modelId]),
    };

    delete this.selectedModelItems[modelId];
    void this.resaltador?.clear?.('select', filterMap);
    this.updateSelectionFromMap(this.resaltador?.selection?.select ?? this.selectedModelItems);
  }

  // Returns every fragment model currently loaded.
  private getLoadedModels(): any[] {
    if (!this.fragmentos?.list) return [];
    return Array.from(this.fragmentos.list.values?.() ?? []).filter(Boolean);
  }

  // Updates loaded fragment models when the camera projection changes.
  private updateLoadedModelCameras(): void {
    const camera = this.mundo?.camera?.three;
    if (!camera) return;

    for (const model of this.getLoadedModels()) {
      model.useCamera?.(camera);
    }
  }

  // Finds a fragment model by its stable model ID.
  private getModelById(modelId: string): any | null {
    if (!this.fragmentos?.list) return null;
    return this.fragmentos.list.get?.(modelId) ?? this.getLoadedModels().find((model) => this.getModelId(model) === modelId) ?? null;
  }

  // Resolves the stable model ID used by the fragments highlighter.
  private getModelId(model: any): string | null {
    return model?.userData?.modelId ?? model?.modelId ?? model?.uuid ?? model?.id ?? null;
  }

  // Creates a stable map key for a moved transform.
  private getTransformKey(modelId: string, transformId: number): string {
    return `${modelId}::${transformId}`;
  }

  // Parses a stable moved transform key.
  private parseTransformKey(transformKey: string): { modelId: string; transformId: number } {
    const separatorIndex = transformKey.lastIndexOf('::');

    return {
      modelId: transformKey.slice(0, separatorIndex),
      transformId: Number(transformKey.slice(separatorIndex + 2)),
    };
  }

  // Clones a fragments transform without sharing array references.
  private cloneFragmentTransform(transform: FragmentTransform): FragmentTransform {
    return {
      ...transform,
      position: [...transform.position],
      xDirection: [...transform.xDirection],
      yDirection: [...transform.yDirection],
    };
  }

  private construirMapaTiposIfc(webIfc: Record<string, unknown>): Record<number, string> {
    const mapa: Record<number, string> = {};

    for (const llave in webIfc) {
      const valor = webIfc[llave];
      if (typeof valor === 'number') mapa[valor] = llave;
    }

    return mapa;
  }

  private async crearUrlTrabajadorFragmentos(): Promise<string> {
    const respuesta = await fetch('https://thatopen.github.io/engine_fragment/resources/worker.mjs');
    const blob = await respuesta.blob();
    const archivo = new File([blob], 'worker.mjs', { type: 'text/javascript' });

    return URL.createObjectURL(archivo);
  }

  private esperar(milisegundos: number): Promise<void> {
    return new Promise((resolver) => setTimeout(resolver, milisegundos));
  }

  private recolectarIdsNodos(nodos: NodoArbolIfc[]): string[] {
    const ids: string[] = [];

    const recorrer = (elementos: NodoArbolIfc[]): void => {
      for (const elemento of elementos) {
        ids.push(elemento.id);
        if (elemento.children.length) recorrer(elemento.children);
      }
    };

    recorrer(nodos);
    return ids;
  }

  private async construirArbolConReintentos(): Promise<boolean> {
    if (!this.modeloCargado) return false;

    for (let intento = 0; intento < 6; intento++) {
      try {
        const estructuraCruda = await this.modeloCargado.getSpatialStructure();

        await this.precargarRegistrosDesdeEstructura(this.modeloCargado, estructuraCruda);

        const arbol = this.construirArbolDesdeRegistros();
        this.datosArbol.set(arbol);

        const expandidos: Record<string, boolean> = {};
        const recorrer = (nodos: NodoArbolIfc[], profundidad = 0): void => {
          for (const nodo of nodos) {
            if (profundidad < 5) expandidos[nodo.id] = true;
            if (nodo.children.length) recorrer(nodo.children, profundidad + 1);
          }
        };

        recorrer(arbol);
        this.nodosExpandidos.set(expandidos);

        return true;
      } catch (error) {
        console.warn(`Reintento árbol IFC ${intento + 1}/6`, error);
        await this.esperar(200);
      }
    }

    return false;
  }

  private async precargarRegistrosDesdeEstructura(modelo: any, estructuraCruda: any): Promise<void> {
    const indiceEspacial = construirIndiceRutaEspacial(estructuraCruda);
    const localIds = recolectarLocalIdsEspaciales(estructuraCruda);

    this.registrosArbol.clear();
    if (!localIds.length) return;

    const tamanoBloque = 220;

    for (let indice = 0; indice < localIds.length; indice += tamanoBloque) {
      const bloque = localIds.slice(indice, indice + tamanoBloque);

      try {
        const [items, tipos, elevaciones] = await Promise.all([
          modelo.getItemsData(bloque, {
            attributesDefault: true,
            relations: {
              ContainedInStructure: {
                attributes: true,
                relations: true,
              },
            },
          }),
          typeof modelo.getItemsType === 'function' ? modelo.getItemsType(bloque) : Promise.resolve([]),
          Promise.all(bloque.map((localId) => this.obtenerElevacionInferiorElemento(modelo, localId))),
        ]);

        for (let posicion = 0; posicion < bloque.length; posicion++) {
          const localId = bloque[posicion];
          const item = items?.[posicion];

          if (!item || typeof localId !== 'number') continue;

          const tipoId = Array.isArray(tipos) ? tipos[posicion] : undefined;
          const claseIfc =
            typeof tipoId === 'number'
              ? this.mapaTiposIfc[tipoId] || `IFC_${tipoId}`
              : (
                  obtenerValorIfc(item?.type) ||
                  obtenerValorIfc(item?.entity) ||
                  obtenerValorIfc(item?.ObjectType) ||
                  'N/D'
                ).toUpperCase();

          const nombre = obtenerValorIfc(item?.Name) || '-';
          const tipoObjeto = obtenerValorIfc(item?.ObjectType) || '-';
          const ruta = indiceEspacial.get(localId);
          const registro: RegistroElemento = {
            localId,
            expressID:
              typeof item?.ExpressID === 'number'
                ? item.ExpressID
                : typeof item?.expressID === 'number'
                  ? item.expressID
                  : undefined,
            ifcClass: claseIfc,
            name: nombre,
            objectType: tipoObjeto,
            project: ruta?.project || 'Proyecto',
            site: ruta?.site || 'Sitio',
            building: ruta?.building || 'Edificio',
            storey: ruta?.storey || 'Sin nivel asignado',
            z: typeof elevaciones?.[posicion] === 'number' ? elevaciones[posicion] : 0,
          };

          if (!this.esRegistroEspacial(registro)) this.registrosArbol.set(localId, registro);
        }
      } catch (error) {
        console.warn('Error precargando registros del árbol:', error);
      }
    }
  }

  private construirArbolDesdeRegistros(): NodoArbolIfc[] {
    const raices = new Map<string, NodoArbolIfc>();

    for (const registro of this.registrosArbol.values()) {
      const proyecto = this.obtenerOCrearNodo(
        raices,
        `project-${registro.project}`,
        'Proyecto',
        registro.project,
        'spatial',
      );
      const sitio = this.obtenerOCrearNodo(
        this.mapaHijos(proyecto),
        `site-${registro.project}-${registro.site}`,
        'Sitio',
        registro.site,
        'spatial',
      );
      const edificio = this.obtenerOCrearNodo(
        this.mapaHijos(sitio),
        `building-${registro.project}-${registro.site}-${registro.building}`,
        'Edificio',
        registro.building,
        'spatial',
      );
      const nivel = this.obtenerOCrearNodo(
        this.mapaHijos(edificio),
        `storey-${registro.project}-${registro.site}-${registro.building}-${registro.storey}`,
        'Nivel del edificio',
        registro.storey,
        'spatial',
      );
      const categoria = this.mapearClaseIfcAGrupo(registro.ifcClass, registro.name, registro.objectType);
      const grupo = this.obtenerOCrearNodo(
        this.mapaHijos(nivel),
        `group-${nivel.id}-${categoria}`,
        categoria,
        categoria,
        'group',
      );

      grupo.children.push({
        id: `element-${registro.localId}`,
        type: this.obtenerEtiquetaTipo(registro.ifcClass, registro.name, registro.objectType),
        label: registro.name || registro.objectType || registro.ifcClass,
        kind: 'element',
        localId: registro.localId,
        expressID: registro.expressID,
        children: [],
      });
    }

    const arbol = Array.from(raices.values());
    this.ordenarArbol(arbol);

    return arbol;
  }

  private mapaHijos(nodo: NodoArbolIfc): Map<string, NodoArbolIfc> {
    const mapa = new Map<string, NodoArbolIfc>();
    for (const hijo of nodo.children) mapa.set(hijo.id, hijo);

    return {
      get: (id: string) => mapa.get(id),
      set: (id: string, valor: NodoArbolIfc) => {
        mapa.set(id, valor);
        nodo.children.push(valor);
        return mapa;
      },
      values: () => mapa.values(),
    } as Map<string, NodoArbolIfc>;
  }

  private obtenerOCrearNodo(
    mapa: Map<string, NodoArbolIfc>,
    id: string,
    tipo: string,
    etiqueta: string,
    clase: 'spatial' | 'group',
  ): NodoArbolIfc {
    const existente = mapa.get(id);
    if (existente) return existente;

    const nuevo: NodoArbolIfc = {
      id,
      type: tipo,
      label: etiqueta,
      kind: clase,
      children: [],
    };

    mapa.set(id, nuevo);
    return nuevo;
  }

  private ordenarArbol(nodos: NodoArbolIfc[]): void {
    nodos.sort((a, b) => {
      const jerarquia = { spatial: 0, group: 1, element: 2 };

      if (a.kind !== b.kind) return jerarquia[a.kind] - jerarquia[b.kind];
      return a.label.localeCompare(b.label, 'es');
    });

    for (const nodo of nodos) {
      if (nodo.children.length) this.ordenarArbol(nodo.children);
    }
  }

  private async obtenerElevacionInferiorElemento(modelo: any, localId: number): Promise<number> {
    const elevacionCacheada = this.cacheElevacionElementos.get(localId);
    if (typeof elevacionCacheada === 'number') return elevacionCacheada;

    try {
      const coleccionGeometria = await modelo.getItemsGeometry([localId]);
      const geometria = coleccionGeometria?.[0] ?? coleccionGeometria ?? [];
      const { caja } = this.construirCajaYEsferaDesdeGeometria(geometria);
      const elevacion = caja ? caja.min.z : 0;

      this.cacheElevacionElementos.set(localId, elevacion);
      return elevacion;
    } catch {
      this.cacheElevacionElementos.set(localId, 0);
      return 0;
    }
  }

  private construirCajaYEsferaDesdeGeometria(coleccionGeometria: any[]): {
    caja: Box3 | null;
    esfera: Sphere | null;
    dimensiones: { width: string; depth: string; height: string };
  } {
    const THREE = this.moduloThree;
    if (!THREE) {
      return { caja: null, esfera: null, dimensiones: { width: '-', depth: '-', height: '-' } };
    }

    const cajaGeneral = new THREE.Box3();
    let tieneGeometria = false;

    for (const datosMalla of coleccionGeometria ?? []) {
      const { positions, indices, normals, transform } = datosMalla;
      if (!(positions && indices && normals && transform)) continue;

      const geometria = new THREE.BufferGeometry();
      geometria.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometria.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometria.setIndex(Array.from(indices));
      geometria.computeBoundingBox();

      if (!geometria.boundingBox) {
        geometria.dispose();
        continue;
      }

      const cajaMalla = geometria.boundingBox.clone();
      cajaMalla.applyMatrix4(transform);

      if (!tieneGeometria) {
        cajaGeneral.copy(cajaMalla);
        tieneGeometria = true;
      } else {
        cajaGeneral.union(cajaMalla);
      }

      geometria.dispose();
    }

    if (!tieneGeometria) {
      return { caja: null, esfera: null, dimensiones: { width: '-', depth: '-', height: '-' } };
    }

    const tamano = cajaGeneral.getSize(new THREE.Vector3());
    const esfera = cajaGeneral.getBoundingSphere(new THREE.Sphere());

    return {
      caja: cajaGeneral,
      esfera,
      dimensiones: {
        width: `${tamano.x.toFixed(3)} m`,
        depth: `${tamano.y.toFixed(3)} m`,
        height: `${tamano.z.toFixed(3)} m`,
      },
    };
  }

  private async construirInformacionSeleccionada(
    modelo: any,
    localId: number,
  ): Promise<{ informacion: InformacionElementoSeleccionado; esfera: Sphere | null }> {
    let volumenRespaldo: number | null = null;

    try {
      if (typeof modelo.getItemsVolume === 'function') {
        const volumenCrudo = await modelo.getItemsVolume([localId]);

        if (typeof volumenCrudo === 'number' && Number.isFinite(volumenCrudo)) {
          volumenRespaldo = volumenCrudo;
        } else if (Array.isArray(volumenCrudo) && volumenCrudo.length > 0) {
          const volumen = Number(volumenCrudo[0]);
          if (Number.isFinite(volumen)) volumenRespaldo = volumen;
        }
      }
    } catch {
      volumenRespaldo = null;
    }

    const [[datos], [coleccionGeometria]] = await Promise.all([
      modelo.getItemsData([localId], {
        attributesDefault: true,
        relations: {
          IsDefinedBy: { attributes: true, relations: true },
          DefinesOcurrence: { attributes: true, relations: true },
          ContainedInStructure: { attributes: true, relations: true },
        },
      }),
      modelo.getItemsGeometry([localId]),
    ]);

    const { caja, esfera, dimensiones } = this.construirCajaYEsferaDesdeGeometria(
      coleccionGeometria ?? [],
    );

    const claseIfc = await this.obtenerClaseIfcRapida(modelo, localId);
    const { values: cantidades } = this.extraerCantidadesDesdeRelaciones(datos, localId);
    const registroCacheado = this.registrosArbol.get(localId);
    const areaBruta = this.elegirNumeroCantidad(cantidades, [/gross.*area/, /bruta/]);
    const areaNeta = this.elegirNumeroCantidad(cantidades, [/net.*area/, /neta/]);
    const areaTotal =
      this.elegirNumeroCantidad(cantidades, [/basequantities.*grossarea/, /area/i, /área/i]) ??
      areaBruta ??
      areaNeta;
    const volumenBruto = this.elegirNumeroCantidad(cantidades, [/gross.*volume/, /bruto/]);
    const volumenNeto = this.elegirNumeroCantidad(cantidades, [/net.*volume/, /neto/]);
    const volumenTotal =
      this.elegirNumeroCantidad(cantidades, [/basequantities.*grossvolume/, /volumen/, /volume/i]) ??
      volumenBruto ??
      volumenNeto ??
      volumenRespaldo;
    const longitud = this.elegirNumeroCantidad(cantidades, [/basequantities.*length/, /length/, /longitud/]);
    const perimetro = this.elegirNumeroCantidad(cantidades, [/basequantities.*grossperimeter/, /perimeter/, /perímetro/, /perimetro/]);
    const minimo = caja?.min;
    const maximo = caja?.max;
    const centro = caja?.getCenter(new (this.moduloThree as typeof import('three')).Vector3());
    const hayCantidadesIfc = Object.keys(cantidades).length > 0;

    const informacion: InformacionElementoSeleccionado = {
      expressID: obtenerValorIfc(datos?.ExpressID) || obtenerValorIfc(datos?.expressID) || '-',
      localId,
      globalId: obtenerValorIfc(datos?.GlobalId) || '-',
      ifcClass: claseIfc,
      name: obtenerValorIfc(datos?.Name) || registroCacheado?.name || '-',
      objectType: obtenerValorIfc(datos?.ObjectType) || registroCacheado?.objectType || '-',
      width: longitud !== null ? this.formatearValorConUnidad(longitud, 'm') : dimensiones.width,
      depth: dimensiones.depth,
      height: dimensiones.height,
      grossArea: this.formatearValorConUnidad(areaBruta, 'm²'),
      netArea: this.formatearValorConUnidad(areaNeta, 'm²'),
      totalArea: this.formatearValorConUnidad(areaTotal, 'm²'),
      grossVolume: this.formatearValorConUnidad(volumenBruto, 'm³'),
      netVolume: this.formatearValorConUnidad(volumenNeto, 'm³'),
      totalVolume: this.formatearValorConUnidad(volumenTotal, 'm³'),
      length: this.formatearValorConUnidad(longitud, 'm'),
      perimeter: this.formatearValorConUnidad(perimetro, 'm'),
      topElevation: maximo ? `${maximo.z.toFixed(6)} m` : '-',
      bottomElevation: minimo ? `${minimo.z.toFixed(6)} m` : '-',
      globalX: centro ? `${centro.x.toFixed(6)} m` : '-',
      globalY: centro ? `${centro.y.toFixed(6)} m` : '-',
      globalZ: centro ? `${centro.z.toFixed(6)} m` : '-',
      project: registroCacheado?.project || '-',
      building: registroCacheado?.building || '-',
      storey: registroCacheado?.storey || '-',
      layer: '-',
      quantities: cantidades,
      quantitiesMessage: hayCantidadesIfc
        ? ''
        : 'Este elemento no contiene cantidades IFC exportadas. Solo se muestran dimensiones geométricas y volumen de respaldo si está disponible.',
    };

    return { informacion, esfera };
  }

  private async obtenerClaseIfcRapida(modelo: any, localId: number): Promise<string> {
    try {
      if (typeof modelo.getItemsType === 'function') {
        const tipos = await modelo.getItemsType([localId]);
        const tipoId = Array.isArray(tipos) ? tipos[0] : tipos?.[localId] ?? tipos?.[0];

        if (typeof tipoId === 'number') return this.mapaTiposIfc[tipoId] || `IFC_${tipoId}`;
      }

      const [item] = await modelo.getItemsData([localId], { attributesDefault: true });

      return (
        obtenerValorIfc(item?.type) ||
        obtenerValorIfc(item?.entity) ||
        obtenerValorIfc(item?.ObjectType) ||
        'N/D'
      ).toUpperCase();
    } catch {
      return 'N/D';
    }
  }

  // Extracts IFC quantities from IsDefinedBy definitions for the selected element.
  private extraerCantidadesDesdeRelaciones(
    datosElemento: any,
    selectedLocalId: number,
  ): ExtractedIfcQuantities {
    const values: Record<string, string> = {};
    let visitedDefinitionNodes = new WeakSet<object>();

    const addValue = (group: string, name: string, value: unknown): void => {
      if (value === undefined || value === null || value === '') return;

      const key = group ? `${group}.${name}` : name;
      if (key in values) return;
      values[key] = String(value);
    };

    const extractScalar = (value: any): unknown => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
      if (Array.isArray(value)) return null;

      if (typeof value === 'object') {
        const keys = [
          'value',
          'wrappedValue',
          'Value',
          'NominalValue',
          'AreaValue',
          'VolumeValue',
          'LengthValue',
          'CountValue',
          'WeightValue',
          'TimeValue',
        ];

        for (const key of keys) {
          if (key in value && value[key] != null) return extractScalar(value[key]);
        }
      }

      return null;
    };

    const analyzeEntry = (
      entry: any,
      group: string,
    ): void => {
      if (!entry || typeof entry !== 'object') return;

      const name =
        obtenerValorIfc(entry?.Name) ||
        obtenerValorIfc(entry?.Description) ||
        obtenerValorIfc(entry?.LongName) ||
        'SinNombre';

      const scalar = extractScalar(entry);
      if (scalar === null) return;

      addValue(group, name, scalar);
    };

    const analyzeDefinition = (definition: any): void => {
      if (!definition || typeof definition !== 'object') return;

      const group = obtenerValorIfc(definition?.Name) || obtenerValorIfc(definition?.LongName) || 'IFC';

      if (Array.isArray(definition?.HasProperties)) {
        for (const property of definition.HasProperties) {
          analyzeEntry(property, group);
        }
      }

      if (Array.isArray(definition?.Quantities)) {
        for (const quantity of definition.Quantities) {
          analyzeEntry(quantity, group);
        }
      }
    };

    // Traverses only RelatingPropertyDefinition branches to avoid pulling sibling
    // element data from the full IfcRelDefinesByProperties relation graph.
    const analyzeRelatingDefinitionBranch = (
      definitionNode: any,
    ): void => {
      if (!definitionNode || typeof definitionNode !== 'object') return;
      if (visitedDefinitionNodes.has(definitionNode)) return;
      visitedDefinitionNodes.add(definitionNode);

      if (Array.isArray(definitionNode)) {
        for (let index = 0; index < definitionNode.length; index += 1) {
          analyzeRelatingDefinitionBranch(definitionNode[index]);
        }
        return;
      }

      analyzeDefinition(definitionNode);

      if (Array.isArray(definitionNode?.HasPropertySets)) {
        for (let index = 0; index < definitionNode.HasPropertySets.length; index += 1) {
          analyzeRelatingDefinitionBranch(definitionNode.HasPropertySets[index]);
        }
      }

      const candidateChildKeys = [
        'value',
        'Value',
        'Properties',
        'PropertySets',
        'PropertySetDefinitions',
        'Quantities',
        'HasProperties',
      ];

      for (const childKey of candidateChildKeys) {
        const childNode = definitionNode?.[childKey];
        if (!childNode || typeof childNode !== 'object') continue;

        analyzeRelatingDefinitionBranch(childNode);
      }
    };

    const selectedExpressId =
      obtenerValorIfc(datosElemento?.ExpressID) || obtenerValorIfc(datosElemento?.expressID) || '';
    const selectedGlobalId = obtenerValorIfc(datosElemento?.GlobalId) || '';
    const selectedLocalIdText = String(selectedLocalId);

    const relationMatchesSelectedElement = (
      relation: any,
    ): 'matched' | 'mismatch' | 'unknown' => {
      const relatedObjects = Array.isArray(relation?.RelatedObjects) ? relation.RelatedObjects : [];
      if (!relatedObjects.length) return 'unknown';

      let comparableIdentityFound = false;

      for (const relatedObject of relatedObjects) {
        const relatedExpressId =
          obtenerValorIfc(relatedObject?.ExpressID) ||
          obtenerValorIfc(relatedObject?.expressID) ||
          (typeof relatedObject === 'number' ? String(relatedObject) : '');
        const relatedGlobalId = obtenerValorIfc(relatedObject?.GlobalId);
        const relatedLocalId =
          obtenerValorIfc(relatedObject?.localId) ||
          obtenerValorIfc(relatedObject?.LocalId) ||
          (typeof relatedObject === 'number' ? String(relatedObject) : '');

        const hasComparableExpress = !!selectedExpressId && !!relatedExpressId;
        const hasComparableGlobal = !!selectedGlobalId && !!relatedGlobalId;
        const hasComparableLocal = !!relatedLocalId;
        if (hasComparableExpress || hasComparableGlobal || hasComparableLocal) {
          comparableIdentityFound = true;
        }

        const expressIdMatches =
          hasComparableExpress && relatedExpressId === selectedExpressId;
        const globalIdMatches = hasComparableGlobal && relatedGlobalId === selectedGlobalId;
        const localIdMatches = hasComparableLocal && relatedLocalId === selectedLocalIdText;

        if (expressIdMatches || globalIdMatches || localIdMatches) return 'matched';
      }

      if (!comparableIdentityFound) return 'unknown';
      return 'mismatch';
    };

    const relatedDefinitions = Array.isArray(datosElemento?.IsDefinedBy) ? datosElemento.IsDefinedBy : [];

    const processRelations = (skipMismatchedRelations: boolean): number => {
      let processedRelations = 0;

      for (let relationIndex = 0; relationIndex < relatedDefinitions.length; relationIndex += 1) {
        const relation = relatedDefinitions[relationIndex];
        const relationMatch = relationMatchesSelectedElement(relation);

        const directDefinitionShape =
          Array.isArray(relation?.HasProperties) ||
          Array.isArray(relation?.Quantities) ||
          Array.isArray(relation?.HasPropertySets) ||
          Array.isArray(relation?.PropertySets) ||
          Array.isArray(relation?.PropertySetDefinitions);
        const hasRelatingDefinition = !!relation?.RelatingPropertyDefinition || directDefinitionShape;

        if (skipMismatchedRelations && relationMatch === 'mismatch') continue;
        if (!hasRelatingDefinition) continue;

        processedRelations += 1;
        const definitionNode = relation?.RelatingPropertyDefinition ?? relation;
        analyzeRelatingDefinitionBranch(definitionNode);
      }

      return processedRelations;
    };

    const processedWithStrictFilter = processRelations(true);

    if (!Object.keys(values).length && processedWithStrictFilter === 0) {
      visitedDefinitionNodes = new WeakSet<object>();
      processRelations(false);
    }

    return { values };
  }

  private elegirNumeroCantidad(cantidades: Record<string, string>, patrones: RegExp[]): number | null {
    for (const [llave, valor] of Object.entries(cantidades)) {
      const normalizado = llave.toLowerCase();

      if (patrones.some((patron) => patron.test(normalizado))) {
        const numero = this.convertirNumeroPosible(valor);
        if (numero !== null) return numero;
      }
    }

    return null;
  }

  private convertirNumeroPosible(valor: unknown): number | null {
    if (valor === undefined || valor === null || valor === '') return null;
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;

    const texto = String(valor).trim();
    if (!texto) return null;

    const coincidencia = texto.replace(',', '.').match(/-?\d+(\.\d+)?/);
    if (!coincidencia) return null;

    const numero = Number(coincidencia[0]);
    return Number.isFinite(numero) ? numero : null;
  }

  private normalizarVolumenPosible(valor: unknown): number | null {
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    if (Array.isArray(valor) && valor.length > 0) return this.normalizarVolumenPosible(valor[0]);

    return this.convertirNumeroPosible(valor);
  }

  private formatearValorConUnidad(valor: unknown, unidad: string): string {
    if (valor === undefined || valor === null || valor === '') return '-';

    const numero = this.convertirNumeroPosible(valor);
    if (numero !== null) return `${numero.toFixed(3)} ${unidad}`;

    return `${String(valor)} ${unidad}`.trim();
  }

  private async enfocarEsfera(mundo: any, esfera: Sphere | null): Promise<void> {
    const controles = mundo?.camera?.controls;
    if (!controles || !esfera) return;

    await controles.fitToSphere(esfera, true);
    controles.setTarget(esfera.center.x, esfera.center.y, esfera.center.z, true);
  }

  private async resaltarPorLocalId(localId: number): Promise<void> {
    try {
      if (!this.resaltador || !this.modeloCargado || !this.fragmentos) return;

      let modeloId = this.modeloCargado?.userData?.modelId || this.modeloCargado?.uuid || this.modeloCargado?.id;

      if (!modeloId && this.fragmentos.list) {
        for (const [llave] of this.fragmentos.list) {
          modeloId = llave;
          break;
        }
      }

      if (!modeloId) return;
      if (this.resaltador.clear) await this.resaltador.clear();

      if (this.resaltador.highlightByID) {
        await this.resaltador.highlightByID('select', {
          [modeloId]: new Set([localId]),
        });
      }
    } catch (error) {
      console.warn('No se pudo resaltar el elemento:', error);
    }
  }

  private esRegistroEspacial(registro: RegistroElemento): boolean {
    const clase = registro.ifcClass.toUpperCase();
    const clasesEspaciales = new Set([
      'IFCPROJECT',
      'IFCSITE',
      'IFCBUILDING',
      'IFCBUILDINGSTOREY',
      'IFCSPACE',
    ]);

    if (clasesEspaciales.has(clase)) return true;

    const texto = `${registro.name} ${registro.objectType}`.toLowerCase();

    return (
      texto.includes('nivel') ||
      texto.includes('storey') ||
      texto.includes('planta') ||
      texto.includes('piso') ||
      texto.includes('edificio') ||
      texto.includes('building') ||
      texto.includes('proyecto') ||
      texto.includes('project') ||
      texto.includes('sitio') ||
      texto.includes('site')
    );
  }

  private mapearClaseIfcAGrupo(claseIfc: string, nombre: string, tipoObjeto: string): string {
    const clase = (claseIfc || '').toUpperCase();
    const nombreNormalizado = (nombre || '').toLowerCase();
    const tipoObjetoNormalizado = (tipoObjeto || '').toLowerCase();

    if (clase.includes('IFCCOVERING') || clase.includes('IFCROOF') || tipoObjetoNormalizado.includes('roof')) {
      return 'Cubiertas';
    }
    if (clase.includes('IFCBEAM') || nombreNormalizado.includes('viga')) return 'Vigas';
    if (clase.includes('IFCCOLUMN') || nombreNormalizado.includes('columna')) return 'Columnas';
    if (clase.includes('IFCFOOTING') || nombreNormalizado.includes('cimentación')) return 'Cimentación';
    if (clase.includes('IFCWALL') || nombreNormalizado.includes('muro')) return 'Muros';
    if (clase.includes('IFCSLAB') || nombreNormalizado.includes('losa')) return 'Losas';
    if (clase.includes('IFCPLATE')) return 'Placas';
    if (clase.includes('IFCMEMBER')) return 'Miembros';
    if (clase.includes('IFCWINDOW')) return 'Ventanas';
    if (clase.includes('IFCDOOR')) return 'Puertas';
    if (clase.includes('IFCRAILING')) return 'Barandales';
    if (clase.includes('IFCSTAIR')) return 'Escaleras';

    if (
      clase.includes('IFCPIPEFITTING') ||
      clase.includes('IFCFLOWFITTING') ||
      clase.includes('IFCFLOWSEGMENT') ||
      tipoObjetoNormalizado.includes('pipe') ||
      tipoObjetoNormalizado.includes('fitting')
    ) {
      return 'Instalaciones';
    }

    return 'Otros';
  }

  private obtenerEtiquetaTipo(claseIfc: string, nombre: string, tipoObjeto: string): string {
    const clase = claseIfc.toUpperCase();
    const nombreNormalizado = (nombre || '').toLowerCase();
    const tipoObjetoNormalizado = (tipoObjeto || '').toLowerCase();

    if (clase.includes('IFCCOVERING') || clase.includes('IFCROOF') || tipoObjetoNormalizado.includes('roof')) {
      return 'Cubierta';
    }
    if (clase.includes('IFCBEAM')) return 'Viga';
    if (clase.includes('IFCCOLUMN')) return 'Columna';
    if (clase.includes('IFCWALL')) return 'Muro';
    if (clase.includes('IFCSLAB')) return 'Losa';
    if (clase.includes('IFCFOOTING')) return 'Cimentación';
    if (clase.includes('IFCPLATE')) return 'Placa';
    if (clase.includes('IFCMEMBER')) return 'Miembro';
    if (clase.includes('IFCWINDOW')) return 'Ventana';
    if (clase.includes('IFCDOOR')) return 'Puerta';
    if (clase.includes('IFCRAILING')) return 'Barandal';
    if (clase.includes('IFCSTAIR')) return 'Escalera';

    if (
      clase.includes('IFCPIPEFITTING') ||
      clase.includes('IFCFLOWFITTING') ||
      clase.includes('IFCFLOWSEGMENT') ||
      tipoObjetoNormalizado.includes('pipe') ||
      tipoObjetoNormalizado.includes('fitting')
    ) {
      return 'Instalación';
    }

    return clase.replace('IFC', '') || nombreNormalizado || 'Elemento';
  }
}
