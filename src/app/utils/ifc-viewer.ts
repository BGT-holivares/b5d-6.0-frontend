import { Inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Box3, Sphere } from 'three';
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
  private modeloCargado: any = null;
  private nombreArchivoPendiente = '';
  private urlTrabajador = '';
  private moduloThree: typeof import('three') | null = null;
  private mapaTiposIfc: Record<number, string> = {};
  private registrosArbol = new Map<number, RegistroElemento>();
  private cacheSeleccion = new Map<string, ValorCacheSeleccion>();
  private cacheElevacionElementos = new Map<number, number>();

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
    mundo.camera = new OBC.SimpleCamera(componentes);

    componentes.init();

    mundo.scene.setup();
    mundo.scene.three.background = new THREE.Color(0x1f2937);

    await mundo.camera.controls.setLookAt(12, 10, 12, 0, 0, 0);
    mundo.camera.controls.minDistance = 0.5;
    mundo.camera.controls.maxDistance = 2000;

    const grillas = componentes.get(OBC.Grids);
    grillas.create(mundo);

    const ejes = new THREE.AxesHelper(5);
    mundo.scene.three.add(ejes);

    const fragmentos = componentes.get(OBC.FragmentsManager);
    this.fragmentos = fragmentos;

    this.urlTrabajador = await this.crearUrlTrabajadorFragmentos();
    await fragmentos.init(this.urlTrabajador);

    mundo.camera.controls.addEventListener('update', () => {
      fragmentos.core.update();
    });

    fragmentos.list.onItemSet.add(({ value: modelo }: any) => {
      this.modeloCargado = modelo;
      modelo.useCamera(mundo.camera.three);
      mundo.scene.three.add(modelo.object);

      const modeloId = modelo.uuid || modelo.id || crypto.randomUUID();
      modelo.userData = {
        ...modelo.userData,
        modelId: modeloId,
      };

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
    });

    const raycasters = componentes.get(OBC.Raycasters);
    raycasters.get(mundo);

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
    if (this.urlTrabajador) URL.revokeObjectURL(this.urlTrabajador);
    if (this.componentes) this.componentes.dispose();

    this.componentes = null;
    this.mundo = null;
    this.cargadorIfc = null;
    this.fragmentos = null;
    this.resaltador = null;
    this.modeloCargado = null;
    this.urlTrabajador = '';
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
        this.fragmentos.core.update(true);

        this.modelosIfcCargados.update((modelos) =>
          modelos.map((modeloIfc) =>
            modeloIfc.id === modeloId ? { ...modeloIfc, visible: modelo.object.visible } : modeloIfc,
          ),
        );

        break;
      }
    }
  }

  async seleccionarElementoDesdeArbol(localId: number): Promise<void> {
    if (!this.modeloCargado || !this.mundo) return;

    try {
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

  async desplazarIzquierda(): Promise<void> {
    await this.mundo?.camera?.controls?.truck(-1, 0, true);
  }

  async desplazarDerecha(): Promise<void> {
    await this.mundo?.camera?.controls?.truck(1, 0, true);
  }

  async desplazarArriba(): Promise<void> {
    await this.mundo?.camera?.controls?.truck(0, 1, true);
  }

  async desplazarAbajo(): Promise<void> {
    await this.mundo?.camera?.controls?.truck(0, -1, true);
  }

  async rotarIzquierda(): Promise<void> {
    await this.mundo?.camera?.controls?.rotate(0.2, 0, true);
  }

  async rotarDerecha(): Promise<void> {
    await this.mundo?.camera?.controls?.rotate(-0.2, 0, true);
  }

  async restablecerVista(): Promise<void> {
    await this.mundo?.camera?.controls?.setLookAt(12, 10, 12, 0, 0, 0, true);
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
