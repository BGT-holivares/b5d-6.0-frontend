import type { NodoArbolIfc } from '../types/ifc';

export type RutaEspacial = {
  project: string;
  site: string;
  building: string;
  storey: string;
};

export type ElementoConElevacion = {
  localId: number;
  type: string;
  label: string;
  z: number;
};

export function obtenerValorIfc(atributo: unknown): string {
  if (atributo === undefined || atributo === null) return '';

  if (
    typeof atributo === 'string' ||
    typeof atributo === 'number' ||
    typeof atributo === 'boolean'
  ) {
    return String(atributo);
  }

  if (Array.isArray(atributo)) {
    return atributo.map(obtenerValorIfc).filter(Boolean).join(', ');
  }

  if (typeof atributo === 'object') {
    const registro = atributo as Record<string, unknown>;

    if ('value' in registro && registro['value'] != null) return String(registro['value']);
    if ('wrappedValue' in registro && registro['wrappedValue'] != null) {
      return String(registro['wrappedValue']);
    }
    if ('Value' in registro && registro['Value'] != null) return String(registro['Value']);
    if ('Name' in registro && registro['Name'] != null) return obtenerValorIfc(registro['Name']);
    if ('LongName' in registro && registro['LongName'] != null) {
      return obtenerValorIfc(registro['LongName']);
    }
  }

  return '';
}

function obtenerNombreNodo(nodo: any): string {
  return (
    obtenerValorIfc(nodo?.Name) ||
    obtenerValorIfc(nodo?.name) ||
    obtenerValorIfc(nodo?.LongName) ||
    obtenerValorIfc(nodo?.ObjectType) ||
    obtenerValorIfc(nodo?.type) ||
    'N/D'
  );
}

function obtenerTipoNodo(nodo: any): string {
  const tipo =
    nodo?.type ??
    nodo?.Type ??
    nodo?.ifcClass ??
    nodo?.class ??
    nodo?.constructor?.name ??
    '';

  return String(tipo)
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toUpperCase();
}

function obtenerLocalIdNodo(nodo: any): number | null {
  const localId = nodo?.localId ?? nodo?.LocalId ?? nodo?.expressID ?? nodo?.ExpressID;
  return typeof localId === 'number' ? localId : null;
}

function obtenerHijosNodo(nodo: any): any[] {
  const hijos = nodo?.children || nodo?.Children || nodo?.items || nodo?.Items || [];
  return Array.isArray(hijos) ? hijos : [];
}

function esProyecto(nodo: any): boolean {
  return obtenerTipoNodo(nodo).includes('PROJECT');
}

function esSitio(nodo: any): boolean {
  return obtenerTipoNodo(nodo).includes('SITE');
}

function esEdificio(nodo: any): boolean {
  const tipo = obtenerTipoNodo(nodo);
  return tipo.includes('BUILDING') && !tipo.includes('STOREY');
}

function esNivel(nodo: any): boolean {
  const tipo = obtenerTipoNodo(nodo);
  const nombre = obtenerNombreNodo(nodo).toUpperCase();

  return (
    tipo.includes('STOREY') ||
    tipo.includes('BUILDINGSTOREY') ||
    tipo.includes('BUILDING_STOREY') ||
    nombre.includes('NIVEL') ||
    nombre.includes('PISO') ||
    nombre.includes('PLANTA') ||
    nombre.includes('LEVEL')
  );
}

export function construirIndiceRutaEspacial(estructuraCruda: any): Map<number, RutaEspacial> {
  const indice = new Map<number, RutaEspacial>();
  const raices = Array.isArray(estructuraCruda)
    ? estructuraCruda
    : estructuraCruda
      ? [estructuraCruda]
      : [];

  const recorrer = (nodo: any, ruta: RutaEspacial): void => {
    if (!nodo || typeof nodo !== 'object') return;

    const nombre = obtenerNombreNodo(nodo);
    const siguienteRuta: RutaEspacial = { ...ruta };

    if (esProyecto(nodo)) siguienteRuta.project = nombre !== 'N/D' ? nombre : 'Proyecto';
    if (esSitio(nodo)) siguienteRuta.site = nombre !== 'N/D' ? nombre : 'Sitio';
    if (esEdificio(nodo)) siguienteRuta.building = nombre !== 'N/D' ? nombre : 'Edificio';
    if (esNivel(nodo)) {
      siguienteRuta.storey = nombre !== 'N/D' ? nombre : 'Sin nivel asignado';
    }

    const localId = obtenerLocalIdNodo(nodo);
    if (localId !== null) indice.set(localId, siguienteRuta);

    for (const hijo of obtenerHijosNodo(nodo)) {
      recorrer(hijo, siguienteRuta);
    }
  };

  for (const raiz of raices) {
    recorrer(raiz, {
      project: 'Proyecto',
      site: 'Sitio',
      building: 'Edificio',
      storey: 'Sin nivel asignado',
    });
  }

  return indice;
}

export function recolectarLocalIdsEspaciales(estructuraCruda: any): number[] {
  const ids = new Set<number>();
  const raices = Array.isArray(estructuraCruda)
    ? estructuraCruda
    : estructuraCruda
      ? [estructuraCruda]
      : [];

  const recorrer = (nodo: any): void => {
    if (!nodo || typeof nodo !== 'object') return;

    const localId = obtenerLocalIdNodo(nodo);
    if (localId !== null) ids.add(localId);

    for (const hijo of obtenerHijosNodo(nodo)) {
      recorrer(hijo);
    }
  };

  for (const raiz of raices) recorrer(raiz);
  return Array.from(ids);
}

function normalizarElevacionNivel(elevacion: number, tolerancia = 0.5): number {
  return Math.round(elevacion / tolerancia) * tolerancia;
}

function formatearNombreNivel(elevacion: number): string {
  return `Nivel ${elevacion.toFixed(2)} m`;
}

export function construirArbolNivelesPorElevacion(elementos: ElementoConElevacion[]): NodoArbolIfc[] {
  const niveles = new Map<number, ElementoConElevacion[]>();

  for (const elemento of elementos) {
    const elevacionNivel = normalizarElevacionNivel(elemento.z);
    const elementosNivel = niveles.get(elevacionNivel) ?? [];
    elementosNivel.push(elemento);
    niveles.set(elevacionNivel, elementosNivel);
  }

  return Array.from(niveles.entries())
    .sort(([elevacionA], [elevacionB]) => elevacionA - elevacionB)
    .map(([elevacion, elementosNivel]) => ({
      id: `storey-fallback-${elevacion}`,
      type: 'Nivel del edificio',
      label: formatearNombreNivel(elevacion),
      kind: 'spatial',
      children: construirGruposElementos(elementosNivel),
    }));
}

function construirGruposElementos(elementos: ElementoConElevacion[]): NodoArbolIfc[] {
  const grupos = new Map<string, ElementoConElevacion[]>();

  for (const elemento of elementos) {
    const nombreGrupo = elemento.type || 'N/D';
    const elementosGrupo = grupos.get(nombreGrupo) ?? [];
    elementosGrupo.push(elemento);
    grupos.set(nombreGrupo, elementosGrupo);
  }

  return Array.from(grupos.entries())
    .sort(([grupoA], [grupoB]) => grupoA.localeCompare(grupoB, 'es'))
    .map(([tipo, elementosGrupo]) => ({
      id: `group-${tipo}`,
      type: tipo,
      label: tipo,
      kind: 'group',
      children: elementosGrupo.map((elemento) => ({
        id: `element-${elemento.localId}`,
        type: elemento.type || 'N/D',
        label: elemento.label || elemento.type || 'N/D',
        kind: 'element',
        localId: elemento.localId,
        children: [],
      })),
    }));
}
