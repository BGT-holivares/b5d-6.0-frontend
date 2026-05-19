export type UnidadCantidad = 'm' | 'm2' | 'm3' | 'pza';

export type FuenteCantidad = 'IFC' | 'GEOMETRY' | 'RULE' | 'MANUAL';

export type TipoNodoCuantificacion =
  | 'root'
  | 'project'
  | 'site'
  | 'building'
  | 'storey'
  | 'ifcType'
  | 'concept';

export interface NodoCuantificacion {
  id: string;
  type: TipoNodoCuantificacion;
  name: string;
  description?: string;
  unit?: string;
  quantity: number;
  children: NodoCuantificacion[];
}

export type ElementoIfcB5D = {
  localId: number;
  expressID?: number;
  ifcClass: string;
  name: string;
  objectType: string;
  project: string;
  site: string;
  building: string;
  storey: string;
  category: string;
  elementType: string;
  width?: number | null;
  height?: number | null;
  length?: number | null;
  area?: number | null;
  volume?: number | null;
  count?: number | null;
};

export type FilaCantidadB5D = {
  id: string;
  elementId: number;
  expressID?: number;
  ifcClass: string;
  elementName: string;
  objectType: string;
  project: string;
  site: string;
  building: string;
  storey: string;
  category: string;
  elementType: string;
  quantity: number;
  unit: UnidadCantidad;
  source: FuenteCantidad;
  amount?: number;
  properties?: Record<string, unknown>;
};
