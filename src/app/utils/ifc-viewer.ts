import { Inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Box3, Sphere, Vector3 } from 'three';
import type {
  InformacionElementoSeleccionado,
  ModeloIfcCargado,
  NodoArbolIfc,
  ValorCacheSeleccion,
} from '../types/ifc';
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

@Injectable({ providedIn: 'root' })
export class VisorIfc {
  readonly cargando = signal(false);
  readonly informacionSeleccionada = signal<InformacionElementoSeleccionado | null>(null);
  readonly datosArbol = signal<NodoArbolIfc[]>([]);
  readonly nodosExpandidos = signal<Record<string, boolean>>({});
  readonly arbolVisible = signal(false);
  readonly modelosIfcCargados = signal<ModeloIfcCargado[]>([]);

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

    const [THREE, WEBIFC, OBC, OBCF] = await Promise.all([
      import('three'),
      import('web-ifc'),
      import('@thatopen/components'),
      import('@thatopen/components-front'),
    ]);

    this.moduloThree = THREE;
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
    this.contenedorVisor?.removeEventListener('pointerdown', this.handleAltPointerDown, true);
    this.removeModelVisualGuides();

    if (this.urlTrabajador) URL.revokeObjectURL(this.urlTrabajador);
    if (this.componentes) this.componentes.dispose();

    this.componentes = null;
    this.mundo = null;
    this.cargadorIfc = null;
    this.fragmentos = null;
    this.resaltador = null;
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

    try {
      if (this.resaltador?.clear) await this.resaltador.clear();
    } catch (error) {
      console.warn('No se pudo limpiar selección:', error);
    }
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
      const intersection =
        this.raycasterIfc?.castRayToObjects?.(interactableObjects, pointerPosition) ??
        (await this.raycasterIfc?.castRay?.({ position: pointerPosition, items: interactableObjects }));
      const targetPoint = intersection?.point as Vector3 | undefined;
      if (!targetPoint) return;

      await this.moveSelectionToPoint(selectionMap, targetPoint);
    } catch (error) {
      console.warn('Could not move selected elements:', error);
    } finally {
      if (controls) controls.enabled = previousControlsEnabled;
    }
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

  // Keeps the local selection cache aligned with the highlighter selection.
  private updateSelectionFromMap(selectionMap: Record<string, Set<number>>): void {
    this.selectedModelItems = this.cloneSelectionMap(selectionMap);
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

  // Returns the local IDs known by the B5D tree, falling back to model items.
  private async getKnownElementLocalIds(model: any, modelId: string): Promise<number[]> {
    const activeTreeModelId = this.getModelId(this.modeloCargado);
    const localIds =
      activeTreeModelId && activeTreeModelId === modelId ? Array.from(this.registrosArbol.keys()) : [];
    if (localIds.length) return localIds;

    if (!model?.getItemsIds) return [];

    const itemIds = await model.getItemsIds();
    return Array.from(itemIds);
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

    for (const [modelId, model] of this.fragmentos.list) {
      const isVisibleModel = model?.object?.visible && !this.hiddenModelIds.has(modelId);
      if (!isVisibleModel) continue;

      const visibleIds = await model.getItemsByVisibility?.(true);
      if (!Array.isArray(visibleIds) || !visibleIds.length) continue;
      selectableMap[modelId] = new Set(visibleIds);
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
    const cantidades = this.extraerCantidadesDesdeRelaciones(datos);
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

  private extraerCantidadesDesdeRelaciones(datosElemento: any): Record<string, string> {
    const resultado: Record<string, string> = {};
    const visitados = new WeakSet<object>();

    const agregarEntrada = (grupo: string, nombre: string, valor: unknown): void => {
      if (valor === undefined || valor === null || valor === '') return;

      const llave = grupo ? `${grupo}.${nombre}` : nombre;
      resultado[llave] = String(valor);
    };

    const escalar = (valor: any): unknown => {
      if (valor === undefined || valor === null) return undefined;
      if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
        return valor;
      }
      if (Array.isArray(valor)) return undefined;

      if (typeof valor === 'object') {
        const llaves = [
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

        for (const llave of llaves) {
          if (llave in valor && valor[llave] != null) return escalar(valor[llave]);
        }
      }

      return undefined;
    };

    const analizarEntrada = (entrada: any, grupo: string): void => {
      if (!entrada || typeof entrada !== 'object') return;

      const nombre =
        obtenerValorIfc(entrada?.Name) ||
        obtenerValorIfc(entrada?.Description) ||
        obtenerValorIfc(entrada?.LongName) ||
        'SinNombre';

      agregarEntrada(grupo, nombre, escalar(entrada));
    };

    const analizarDefinicion = (definicion: any): void => {
      if (!definicion || typeof definicion !== 'object') return;

      const grupo = obtenerValorIfc(definicion?.Name) || obtenerValorIfc(definicion?.LongName) || 'IFC';

      if (Array.isArray(definicion?.HasProperties)) {
        for (const propiedad of definicion.HasProperties) analizarEntrada(propiedad, grupo);
      }

      if (Array.isArray(definicion?.Quantities)) {
        for (const cantidad of definicion.Quantities) analizarEntrada(cantidad, grupo);
      }
    };

    const analizarProfundo = (nodo: any, grupoActual = 'IFC'): void => {
      if (!nodo || typeof nodo !== 'object') return;
      if (visitados.has(nodo)) return;

      visitados.add(nodo);

      if (Array.isArray(nodo)) {
        for (const item of nodo) analizarProfundo(item, grupoActual);
        return;
      }

      const grupoPosible = obtenerValorIfc(nodo?.Name) || obtenerValorIfc(nodo?.LongName) || grupoActual;

      if (nodo?.RelatingPropertyDefinition) {
        analizarDefinicion(nodo.RelatingPropertyDefinition);
        analizarProfundo(nodo.RelatingPropertyDefinition, grupoPosible);
      }

      if (Array.isArray(nodo?.HasProperties)) {
        for (const propiedad of nodo.HasProperties) {
          analizarEntrada(propiedad, grupoPosible);
          analizarProfundo(propiedad, grupoPosible);
        }
      }

      if (Array.isArray(nodo?.Quantities)) {
        for (const cantidad of nodo.Quantities) {
          analizarEntrada(cantidad, grupoPosible);
          analizarProfundo(cantidad, grupoPosible);
        }
      }

      for (const valor of Object.values(nodo)) {
        if (valor && typeof valor === 'object') analizarProfundo(valor, grupoPosible);
      }
    };

    const relacionados = Array.isArray(datosElemento?.IsDefinedBy) ? datosElemento.IsDefinedBy : [];

    for (const relacion of relacionados) {
      if (relacion?.RelatingPropertyDefinition) analizarDefinicion(relacion.RelatingPropertyDefinition);
      analizarProfundo(relacion, 'IFC');
    }

    return resultado;
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
