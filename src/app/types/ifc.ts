import type { Sphere } from 'three';

export type InformacionElementoSeleccionado = {
  expressID: number | string;
  localId: number | string;
  globalId: string;
  ifcClass: string;
  name: string;
  objectType: string;
  width: string;
  depth: string;
  height: string;
  grossArea: string;
  netArea: string;
  totalArea: string;
  grossVolume: string;
  netVolume: string;
  totalVolume: string;
  length: string;
  perimeter: string;
  topElevation: string;
  bottomElevation: string;
  globalX: string;
  globalY: string;
  globalZ: string;
  project: string;
  building: string;
  storey: string;
  layer: string;
  quantities: Record<string, string>;
  quantitiesMessage: string;
};

export type ValorCacheSeleccion = {
  info: InformacionElementoSeleccionado;
  sphere: Sphere | null;
};

export type TipoNodoArbol = 'spatial' | 'group' | 'element';

export type NodoArbolIfc = {
  id: string;
  label: string;
  type: string;
  kind: TipoNodoArbol;
  localId?: number;
  expressID?: number;
  children: NodoArbolIfc[];
};

export type ModeloIfcCargado = {
  id: string;
  name: string;
  visible: boolean;
};
