export interface UsuarioSesionOrm {
  id: number;
  username: string;
  email: string;
  is_staff: boolean;
  is_superuser: boolean;
  permissions: string[];
}

export interface SesionBackendOrm {
  authenticated: boolean;
  user: UsuarioSesionOrm | null;
}

export interface CuotaUsuarioOrm {
  active_projects: number;
  active_projects_limit: number;
  uploads_today: number;
  uploads_per_day_limit: number;
  storage_used_bytes: number;
  storage_limit_bytes: number;
}

export interface ProyectoTrabajoOrm {
  id: number;
  nombre: string;
  estado: string;
  mensaje_error: string;
  total_registros: number;
  registros_importados: number;
  archivo_original: string;
  archivo_exportado: string | null;
  url_descarga: string | null;
  fecha_creacion: string | null;
  fecha_actualizacion: string | null;
  fecha_expiracion: string | null;
  ifc_nombre_archivo: string | null;
  ifc_tamano_bytes: number | null;
  ifc_fecha_referencia: string | null;
}

export interface ConceptoB5DOrm {
  id: number;
  identificador_original: number | null;
  catalogo_id: number | null;
  clave: string | null;
  clave_secundaria: string | null;
  descripcion: string | null;
  es_agrupador: boolean;
  agrupador_padre_id: number | null;
  unidad: string | null;
  orden: number | null;
  costo?: number | null;
  costo_mn?: number | null;
  costo_me?: number | null;
  porcentaje_padre?: number | null;
  optimistic_lock_field?: number | null;
  gc_record?: number | null;
}

export interface VinculoConceptoBimOrm {
  id: number;
  identificador_original: number | null;
  concepto_id: number | null;
  tipo_objeto_bim: string | null;
  material_bim: string | null;
  propiedad_cantidad_bim: string | null;
  factor_conversion: number | null;
  descripcion: string | null;
  optimistic_lock_field?: number | null;
  gc_record?: number | null;
}

export interface CatalogoB5DOrm {
  id: number;
  identificador_original: number | null;
  nombre: string | null;
  descripcion: string | null;
  grupo_cantidades_bim?: string | null;
  propiedad_tipo_bim?: string | null;
  catalogo_externo?: string | null;
  optimistic_lock_field?: number | null;
  gc_record?: number | null;
}

export interface CuantificacionB5DOrm {
  id: number;
  identificador_original: number | null;
  tipo: number | null;
  nombre: string | null;
  descripcion: string | null;
  fecha: string | null;
  grupo: string | null;
  comentarios: string | null;
  calculada: boolean;
  tiene_libro_excel: boolean;
  libro_excel?: string | null;
  LibroExcel?: string | null;
  libroExcel?: string | null;
  Libro_Excel?: string | null;
}

export type TipoComparacionParametroOrm = 'clave_exacta' | 'clave_parcial' | 'descripcion_parcial';
export type TipoParametroOrm = 'costo' | 'cantidad';

export interface ParametroB5DOrm {
  id: number;
  identificador_original: number | null;
  clave: string | null;
  descripcion: string | null;
  tipo_comparacion: TipoComparacionParametroOrm;
  tipo_parametro: TipoParametroOrm;
  tipo_edificacion: string | null;
  unidad: string | null;
  minimo: number | null;
  maximo: number | null;
  promedio: number | null;
  activo: boolean;
  optimistic_lock_field?: number | null;
  gc_record?: number | null;
}

export interface ConceptoB5DDraftOrm {
  id: number | null;
  catalogo_id: number | null;
  clave: string | null;
  clave_secundaria: string | null;
  descripcion: string | null;
  costo?: number | null;
  costo_mn?: number | null;
  costo_me?: number | null;
  es_agrupador: boolean;
  agrupador_padre_id: number | null;
  unidad: string | null;
  orden: number | null;
  optimistic_lock_field?: number | null;
  gc_record?: number | null;
}

export interface VinculoConceptoBimDraftOrm {
  id: string | null;
  identificador_original: number | null;
  concepto_id: number | null;
  tipo_objeto_bim: string | null;
  material_bim: string | null;
  propiedad_cantidad_bim: string | null;
  factor_conversion: number | null;
  descripcion: string | null;
  optimistic_lock_field?: number | null;
  gc_record?: number | null;
}

export interface SaveB5DProyectPayloadOrm {
  catalogo_activo_id?: number | null;
  conceptos: ConceptoB5DDraftOrm[];
  vinculos: VinculoConceptoBimDraftOrm[];
}

export interface GuardarProyectoB5DResponseOrm {
  proyecto: ProyectoTrabajoOrm;
  catalogos?: ResultadosOrm<CatalogoB5DOrm>;
  conceptos: ResultadosOrm<ConceptoB5DOrm>;
  vinculos: ResultadosOrm<VinculoConceptoBimOrm>;
}

export interface ResultadosOrm<T> {
  resultados: T[];
}

export interface EliminarProyectoResponseOrm {
  eliminado: boolean;
}

export interface ErrorBackendOrm {
  error: string;
}

export interface WorkbookSummarySheetOrm {
  index: number;
  sheetId: number;
  name: string;
}

export interface WorkbookSummaryOrm {
  workbookSizeBytes: number;
  sheets: WorkbookSummarySheetOrm[];
}

export interface WorkbookCellOrm {
  address: string;
  row: number;
  col: number;
  value: string | number | boolean | null;
  formattedValue?: string | null;
  type: string;
  formula?: string | null;
  styleId?: number | null;
}

export interface WorkbookColumnLayoutOrm {
  min: number;
  max: number;
  width?: number | null;
  widthPx?: number | null;
  hidden?: boolean;
  styleId?: number | null;
}

export interface WorkbookRowLayoutOrm {
  row: number;
  heightPt?: number | null;
  heightPx?: number | null;
  hidden?: boolean;
  styleId?: number | null;
}

export interface WorkbookLayoutOrm {
  rows: WorkbookRowLayoutOrm[];
  columns: WorkbookColumnLayoutOrm[];
  maxRow: number;
  maxCol: number;
  defaultRowHeightPt?: number | null;
  defaultRowHeightPx?: number | null;
  defaultColumnWidth?: number | null;
  defaultColumnWidthPx?: number | null;
}

export interface WorkbookMergeOrm {
  range: string;
  startAddress: string;
  endAddress: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  rowSpan: number;
  colSpan: number;
}

export interface WorkbookStyleBorderSideOrm {
  style?: string | null;
  color?: string | null;
}

export interface WorkbookStyleOrm {
  fill?: {
    type?: string | null;
    color?: string | null;
    backgroundColor?: string | null;
  } | null;
  font?: {
    name?: string | null;
    size?: number | null;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    color?: string | null;
  } | null;
  alignment?: {
    horizontal?: string | null;
    vertical?: string | null;
    wrapText?: boolean;
  } | null;
  border?: {
    left?: WorkbookStyleBorderSideOrm | null;
    right?: WorkbookStyleBorderSideOrm | null;
    top?: WorkbookStyleBorderSideOrm | null;
    bottom?: WorkbookStyleBorderSideOrm | null;
    diagonal?: WorkbookStyleBorderSideOrm | null;
  } | null;
  numberFormat?: string | null;
}

export interface WorkbookImageOrm {
  id: string;
  contentType: string;
  anchor: {
    type: 'oneCellAnchor' | 'twoCellAnchor';
    from: {
      row: number;
      col: number;
      rowOffsetPx: number;
      colOffsetPx: number;
    };
    to?: {
      row: number;
      col: number;
      rowOffsetPx: number;
      colOffsetPx: number;
    } | null;
  };
  widthPx?: number | null;
  heightPx?: number | null;
}

export interface WorkbookSheetRefOrm {
  index: number;
  name: string;
}

export interface WorkbookCellsLayerOrm {
  sheet: WorkbookSheetRefOrm;
  cells: WorkbookCellOrm[];
}

export interface WorkbookLayoutLayerOrm {
  sheet: WorkbookSheetRefOrm;
  layout: WorkbookLayoutOrm;
}

export interface WorkbookStylesLayerOrm {
  sheet: WorkbookSheetRefOrm;
  styles: Record<string, WorkbookStyleOrm>;
}

export interface WorkbookMergesLayerOrm {
  sheet: WorkbookSheetRefOrm;
  merges: WorkbookMergeOrm[];
}

export interface WorkbookImagesLayerOrm {
  sheet: WorkbookSheetRefOrm;
  images: WorkbookImageOrm[];
}

export interface WorkbookLayersOrm {
  sheet: WorkbookSummarySheetOrm;
  cells: WorkbookCellOrm[];
  layout: WorkbookLayoutOrm;
  styles: Record<string, WorkbookStyleOrm>;
  merges: WorkbookMergeOrm[];
  images: WorkbookImageOrm[];
}

export interface WorkbookCellChangeOrm {
  address?: string;
  row?: number;
  col?: number;
  value: string | number | boolean | null;
  type?: string | null;
  formula?: string | null;
  styleId?: number | null;
}

export interface WorkbookCellUpdateResponseOrm {
  updated: boolean;
  cuantificacion: CuantificacionB5DOrm;
}

export interface WorkbookRowLayoutChangeOrm {
  row: number;
  heightPx?: number | null;
  heightPt?: number | null;
}

export interface WorkbookColumnLayoutChangeOrm {
  col: number;
  widthPx?: number | null;
  width?: number | null;
}

export interface WorkbookLayoutUpdateResponseOrm {
  updated: boolean;
  cuantificacion: CuantificacionB5DOrm;
}
