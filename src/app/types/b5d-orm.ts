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
