import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import type {
  CatalogoB5DOrm,
  CatalogMetadataOrm,
  ConceptoB5DOrm,
  SaveB5DProyectPayloadOrm,
  GuardarProyectoB5DResponseOrm,
  CuantificacionB5DOrm,
  EliminarProyectoResponseOrm,
  WorkbookCellsLayerOrm,
  WorkbookCellChangeOrm,
  WorkbookCellUpdateResponseOrm,
  WorkbookColumnLayoutChangeOrm,
  WorkbookImagesLayerOrm,
  WorkbookLayoutLayerOrm,
  WorkbookLayoutUpdateResponseOrm,
  WorkbookLayersOrm,
  WorkbookMergesLayerOrm,
  WorkbookStylesLayerOrm,
  WorkbookSummaryOrm,
  WorkbookRowLayoutChangeOrm,
  ProyectoTrabajoOrm,
  ParametroB5DOrm,
  ResultadosOrm,
  VinculoConceptoBimOrm,
} from '../types/b5d-orm';

export interface ImportarProyectoPayload {
  archivo: File;
  nombre?: string;
  sincrono?: boolean;
}

export interface ImportarCatalogoAxaPayload {
  archivo: File;
  nombre: string;
  descripcion?: string;
  propiedad_tipo_bim?: string;
  grupo_cantidades_bim?: string;
  sincrono?: boolean;
}

export interface ImportarCatalogoMetadataAxaPayload {
  archivo: File;
}

export interface ImportarCostosCatalogoAxaPayload {
  archivo: File;
  conceptos_seleccionados: number[];
}

export interface ImportarParametrosXdbPayload {
  archivos: File[];
  tipo_parametro?: 'costo' | 'costo_porcentaje' | 'cantidad';
  modo_agrupacion?: 'hojas' | 'agrupadores';
}

export interface ImportarParametrosB5dPayload {
  archivos: File[];
}

export interface CrearCatalogoPayload {
  nombre: string;
  descripcion?: string;
  propiedad_tipo_bim?: string;
  grupo_cantidades_bim?: string;
  copiar_vinculos_desde_catalogo_id?: number | null;
}

export interface ImportarCatalogoAxaResponse {
  proyecto: ProyectoTrabajoOrm;
  catalogo?: CatalogoB5DOrm;
  catalog_metadata?: CatalogMetadataOrm | null;
  catalogos?: ResultadosOrm<CatalogoB5DOrm>;
  conceptos?: ResultadosOrm<ConceptoB5DOrm>;
  vinculos?: ResultadosOrm<VinculoConceptoBimOrm>;
}

export interface PrevisualizarCostosCatalogoAxaResponse {
  proyecto: ProyectoTrabajoOrm;
  catalogo: CatalogoB5DOrm;
  summary: {
    count: number;
    matched: number;
    unmatched: number;
    tipo: string;
  };
  preview: {
    resultados: Array<{
      firma: string;
      clave: string | null;
      descripcion: string | null;
      unidad_origen: string | null;
      catalogo_concepto_id: number | null;
      catalogo_clave: string | null;
      catalogo_descripcion: string | null;
      catalogo_unidad: string | null;
      precio_unitario_actual: number | null;
      precio_unitario_nuevo: number | null;
      cantidad_actual: number | null;
      cantidad_nueva: number | null;
      importe_actual: number | null;
      importe_nuevo: number | null;
      puede_importarse: boolean;
      motivo: string | null;
      seleccionado: boolean;
    }>;
  };
}

export interface ImportarCostosCatalogoAxaResponse {
  proyecto: ProyectoTrabajoOrm;
  catalogo: CatalogoB5DOrm;
  summary: {
    created: number;
    updated: number;
    skipped: number;
    rejected: number;
    failed: number;
    count: number;
    tipo: string;
  };
  preview: {
    count: number;
    matched: number;
    unmatched: number;
    resultados: Array<{
      firma: string;
      clave: string | null;
      descripcion: string | null;
      unidad_origen: string | null;
      catalogo_concepto_id: number | null;
      catalogo_clave: string | null;
      catalogo_descripcion: string | null;
      catalogo_unidad: string | null;
      precio_unitario_actual: number | null;
      precio_unitario_nuevo: number | null;
      cantidad_actual: number | null;
      cantidad_nueva: number | null;
      importe_actual: number | null;
      importe_nuevo: number | null;
      puede_importarse: boolean;
      motivo: string | null;
      seleccionado: boolean;
    }>;
    tipo: string;
  };
  conceptos: ResultadosOrm<ConceptoB5DOrm>;
}

export interface ImportarParametrosXdbResponse {
  proyecto: ProyectoTrabajoOrm;
  summary: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    count: number;
    tipo_parametro: string;
  };
  parametros: ResultadosOrm<ParametroB5DOrm>;
}

export interface PrevisualizarParametrosXdbResponse {
  proyecto: ProyectoTrabajoOrm;
  summary: {
    count: number;
    tipo_parametro: string;
  };
  preview: {
    resultados: Array<{
      firma: string;
      clave: string;
      descripcion: string;
      tipo_parametro: string;
      unidad: string | null;
      minimo: number | null;
      maximo: number | null;
      promedio: number | null;
      cantidad_conceptos: number;
      cantidad_origenes: number;
      origenes: string[];
    }>;
  };
}

export interface ImportarParametrosB5dResponse {
  proyecto: ProyectoTrabajoOrm;
  summary: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    count: number;
    tipo_parametro: string;
  };
  parametros: ResultadosOrm<ParametroB5DOrm>;
}

export interface PrevisualizarParametrosB5dResponse {
  proyecto: ProyectoTrabajoOrm;
  summary: {
    count: number;
    tipo_parametro: string;
  };
  preview: {
    resultados: Array<{
      firma: string;
      clave: string;
      descripcion: string;
      tipo_parametro: string;
      unidad: string | null;
      minimo: number | null;
      maximo: number | null;
      promedio: number | null;
      cantidad_conceptos: number;
      cantidad_origenes: number;
      origenes: string[];
    }>;
  };
}

export interface EditarConceptoPayload {
  clave?: string | null;
  clave_secundaria?: string | null;
  descripcion?: string | null;
  precio_unitario?: number | null;
  cantidad?: number | null;
  es_agrupador?: boolean;
  unidad?: string | null;
  orden?: number | null;
}

export interface ActualizarIfcMetadataPayload {
  ifc_nombre_archivo: string;
  ifc_tamano_bytes: number;
}

export interface CrearParametroPayload {
  clave?: string | null;
  descripcion?: string | null;
  tipo_comparacion?: 'clave_exacta' | 'clave_parcial' | 'descripcion_parcial';
  tipo_parametro?: 'costo' | 'costo_porcentaje' | 'cantidad';
  tipo_edificacion?: string | null;
  unidad?: string | null;
  minimo?: number | null;
  maximo?: number | null;
  promedio?: number | null;
  activo?: boolean;
}

export type ActualizarParametroPayload = Partial<CrearParametroPayload>;

@Injectable({ providedIn: 'root' })
export class BackendProyectosService {
  private readonly apiBaseUrl = environment.backendBaseUrl.replace(/\/+$/, '');
  private readonly requestOptions = { withCredentials: true };

  constructor(private readonly http: HttpClient) {}

  listarProyectos(): Observable<ResultadosOrm<ProyectoTrabajoOrm>> {
    return this.http.get<ResultadosOrm<ProyectoTrabajoOrm>>(
      this.url('/api/proyectos/'),
      this.requestOptions,
    );
  }

  importarProyecto(payload: ImportarProyectoPayload): Observable<ProyectoTrabajoOrm> {
    const formData = new FormData();
    formData.append('archivo', payload.archivo);
    if (payload.nombre) {
      formData.append('nombre', payload.nombre);
    }
    if (payload.sincrono) {
      formData.append('sincrono', '1');
    }
    return this.http.post<ProyectoTrabajoOrm>(
      this.url('/api/proyectos/importar/'),
      formData,
      this.requestOptions,
    );
  }

  importarCatalogoAxa(proyectoId: number, payload: ImportarCatalogoAxaPayload): Observable<ImportarCatalogoAxaResponse> {
    const formData = new FormData();
    formData.append('archivo', payload.archivo);
    formData.append('nombre', payload.nombre);
    if (payload.descripcion) {
      formData.append('descripcion', payload.descripcion);
    }
    if (payload.propiedad_tipo_bim) {
      formData.append('propiedad_tipo_bim', payload.propiedad_tipo_bim);
    }
    if (payload.grupo_cantidades_bim) {
      formData.append('grupo_cantidades_bim', payload.grupo_cantidades_bim);
    }
    if (payload.sincrono) {
      formData.append('sincrono', '1');
    }
    return this.http.post<ImportarCatalogoAxaResponse>(
      this.url(`/api/proyectos/${proyectoId}/catalogos/importar-axa/`),
      formData,
      this.requestOptions,
    );
  }

  importarMetadataCatalogoAxa(
    proyectoId: number,
    catalogoId: number,
    payload: ImportarCatalogoMetadataAxaPayload,
  ): Observable<ImportarCatalogoAxaResponse> {
    const formData = new FormData();
    formData.append('archivo', payload.archivo);
    return this.http.post<ImportarCatalogoAxaResponse>(
      this.url(`/api/proyectos/${proyectoId}/catalogos/${catalogoId}/importar-metadata-axa/`),
      formData,
      this.requestOptions,
    );
  }

  previsualizarCostosCatalogoAxa(
    proyectoId: number,
    catalogoId: number,
    payload: ImportarCatalogoMetadataAxaPayload,
  ): Observable<PrevisualizarCostosCatalogoAxaResponse> {
    const formData = new FormData();
    formData.append('archivo', payload.archivo);
    return this.http.post<PrevisualizarCostosCatalogoAxaResponse>(
      this.url(`/api/proyectos/${proyectoId}/catalogos/${catalogoId}/previsualizar-costos-axa/`),
      formData,
      this.requestOptions,
    );
  }

  importarCostosCatalogoAxa(
    proyectoId: number,
    catalogoId: number,
    payload: ImportarCostosCatalogoAxaPayload,
  ): Observable<ImportarCostosCatalogoAxaResponse> {
    const formData = new FormData();
    formData.append('archivo', payload.archivo);
    for (const conceptoId of payload.conceptos_seleccionados) {
      formData.append('conceptos_seleccionados', String(conceptoId));
    }
    return this.http.post<ImportarCostosCatalogoAxaResponse>(
      this.url(`/api/proyectos/${proyectoId}/catalogos/${catalogoId}/importar-costos-axa/`),
      formData,
      this.requestOptions,
    );
  }

  importarParametrosDesdeXdb(
    proyectoId: number,
    payload: ImportarParametrosXdbPayload,
  ): Observable<ImportarParametrosXdbResponse> {
    const formData = new FormData();
    for (const archivo of payload.archivos) {
      formData.append('archivos', archivo);
    }
    if (payload.tipo_parametro) {
      formData.append('tipo_parametro', payload.tipo_parametro);
    }
    if (payload.modo_agrupacion) {
      formData.append('modo_agrupacion', payload.modo_agrupacion);
    }
    return this.http.post<ImportarParametrosXdbResponse>(
      this.url(`/api/proyectos/${proyectoId}/parametros/importar-xdb/`),
      formData,
      this.requestOptions,
    );
  }

  previsualizarParametrosDesdeXdb(
    proyectoId: number,
    payload: ImportarParametrosXdbPayload,
  ): Observable<PrevisualizarParametrosXdbResponse> {
    const formData = new FormData();
    for (const archivo of payload.archivos) {
      formData.append('archivos', archivo);
    }
    if (payload.tipo_parametro) {
      formData.append('tipo_parametro', payload.tipo_parametro);
    }
    if (payload.modo_agrupacion) {
      formData.append('modo_agrupacion', payload.modo_agrupacion);
    }
    return this.http.post<PrevisualizarParametrosXdbResponse>(
      this.url(`/api/proyectos/${proyectoId}/parametros/previsualizar-xdb/`),
      formData,
      this.requestOptions,
    );
  }

  importarParametrosDesdeB5d(
    proyectoId: number,
    payload: ImportarParametrosB5dPayload,
  ): Observable<ImportarParametrosB5dResponse> {
    const formData = new FormData();
    for (const archivo of payload.archivos) {
      formData.append('archivos', archivo);
    }
    return this.http.post<ImportarParametrosB5dResponse>(
      this.url(`/api/proyectos/${proyectoId}/parametros/importar-b5d/`),
      formData,
      this.requestOptions,
    );
  }

  previsualizarParametrosDesdeB5d(
    proyectoId: number,
    payload: ImportarParametrosB5dPayload,
  ): Observable<PrevisualizarParametrosB5dResponse> {
    const formData = new FormData();
    for (const archivo of payload.archivos) {
      formData.append('archivos', archivo);
    }
    return this.http.post<PrevisualizarParametrosB5dResponse>(
      this.url(`/api/proyectos/${proyectoId}/parametros/previsualizar-b5d/`),
      formData,
      this.requestOptions,
    );
  }

  crearCatalogo(proyectoId: number, payload: CrearCatalogoPayload): Observable<CatalogoB5DOrm | { catalogo: CatalogoB5DOrm }> {
    return this.http.post<CatalogoB5DOrm | { catalogo: CatalogoB5DOrm }>(
      this.url(`/api/proyectos/${proyectoId}/catalogos/`),
      payload,
      this.requestOptions,
    );
  }

  consultarEstadoProyecto(proyectoId: number): Observable<ProyectoTrabajoOrm> {
    return this.http.get<ProyectoTrabajoOrm>(
      this.url(`/api/proyectos/${proyectoId}/estado/`),
      this.requestOptions,
    );
  }

  listarConceptos(proyectoId: number): Observable<ResultadosOrm<ConceptoB5DOrm>> {
    return this.http.get<ResultadosOrm<ConceptoB5DOrm>>(
      this.url(`/api/proyectos/${proyectoId}/conceptos/`),
      this.requestOptions,
    );
  }

  listarVinculosBim(proyectoId: number): Observable<ResultadosOrm<VinculoConceptoBimOrm>> {
    return this.http.get<ResultadosOrm<VinculoConceptoBimOrm>>(
      this.url(`/api/proyectos/${proyectoId}/vinculos-bim/`),
      this.requestOptions,
    );
  }

  listarCuantificaciones(proyectoId: number): Observable<ResultadosOrm<CuantificacionB5DOrm>> {
    return this.http.get<ResultadosOrm<CuantificacionB5DOrm>>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/`),
      this.requestOptions,
    );
  }

  listarParametros(proyectoId: number): Observable<ResultadosOrm<ParametroB5DOrm>> {
    return this.http.get<ResultadosOrm<ParametroB5DOrm>>(
      this.url(`/api/proyectos/${proyectoId}/parametros/`),
      this.requestOptions,
    );
  }

  crearParametro(proyectoId: number, payload: CrearParametroPayload): Observable<ParametroB5DOrm> {
    return this.http.post<ParametroB5DOrm>(
      this.url(`/api/proyectos/${proyectoId}/parametros/crear/`),
      payload,
      this.requestOptions,
    );
  }

  actualizarParametro(
    proyectoId: number,
    parametroId: number,
    payload: ActualizarParametroPayload,
  ): Observable<ParametroB5DOrm> {
    return this.http.patch<ParametroB5DOrm>(
      this.url(`/api/proyectos/${proyectoId}/parametros/${parametroId}/`),
      payload,
      this.requestOptions,
    );
  }

  eliminarParametro(proyectoId: number, parametroId: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(
      this.url(`/api/proyectos/${proyectoId}/parametros/${parametroId}/eliminar/`),
      this.requestOptions,
    );
  }

  actualizarConcepto(
    proyectoId: number,
    conceptoId: number,
    payload: EditarConceptoPayload,
  ): Observable<ConceptoB5DOrm> {
    return this.http.patch<ConceptoB5DOrm>(
      this.url(`/api/proyectos/${proyectoId}/conceptos/${conceptoId}/`),
      payload,
      this.requestOptions,
    );
  }

  actualizarCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    payload: Partial<CuantificacionB5DOrm>,
  ): Observable<CuantificacionB5DOrm> {
    return this.http.patch<CuantificacionB5DOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/`),
      payload,
      this.requestOptions,
    );
  }

  eliminarCatalogo(proyectoId: number, catalogoId: number): Observable<GuardarProyectoB5DResponseOrm> {
    return this.http.delete<GuardarProyectoB5DResponseOrm>(
      this.url(`/api/proyectos/${proyectoId}/catalogos/${catalogoId}/`),
      this.requestOptions,
    );
  }

  descargarLibroExcelCuantificacion(proyectoId: number, cuantificacionId: number): Observable<ArrayBuffer> {
    return this.http.get(this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/`), {
      ...this.requestOptions,
      responseType: 'arraybuffer',
    });
  }

  subirLibroExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    archivoExcel: File,
  ): Observable<CuantificacionB5DOrm> {
    const formData = new FormData();
    formData.append('archivo', archivoExcel);
    return this.http.post<CuantificacionB5DOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/subir/`),
      formData,
      this.requestOptions,
    );
  }

  obtenerResumenLibroExcelCuantificacion(proyectoId: number, cuantificacionId: number): Observable<WorkbookSummaryOrm> {
    return this.http.get<WorkbookSummaryOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/resumen/`),
      this.requestOptions,
    );
  }

  obtenerCapasHojaExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    sheetIndex: number,
  ): Observable<WorkbookLayersOrm> {
    return this.http.get<WorkbookLayersOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/hojas/${sheetIndex}/capas/`),
      this.requestOptions,
    );
  }

  obtenerCeldasHojaExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    sheetIndex: number,
  ): Observable<WorkbookCellsLayerOrm> {
    return this.http.get<WorkbookCellsLayerOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/hojas/${sheetIndex}/celdas/`),
      this.requestOptions,
    );
  }

  actualizarCeldasHojaExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    sheetIndex: number,
    changes: WorkbookCellChangeOrm[],
  ): Observable<WorkbookCellUpdateResponseOrm> {
    return this.http.patch<WorkbookCellUpdateResponseOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/hojas/${sheetIndex}/celdas/`),
      { changes },
      this.requestOptions,
    );
  }

  actualizarLayoutHojaExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    sheetIndex: number,
    rows: WorkbookRowLayoutChangeOrm[],
    columns: WorkbookColumnLayoutChangeOrm[],
  ): Observable<WorkbookLayoutUpdateResponseOrm> {
    return this.http.patch<WorkbookLayoutUpdateResponseOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/hojas/${sheetIndex}/layout/`),
      { rows, columns },
      this.requestOptions,
    );
  }

  obtenerLayoutHojaExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    sheetIndex: number,
  ): Observable<WorkbookLayoutLayerOrm> {
    return this.http.get<WorkbookLayoutLayerOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/hojas/${sheetIndex}/layout/`),
      this.requestOptions,
    );
  }

  obtenerEstilosHojaExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    sheetIndex: number,
  ): Observable<WorkbookStylesLayerOrm> {
    return this.http.get<WorkbookStylesLayerOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/hojas/${sheetIndex}/estilos/`),
      this.requestOptions,
    );
  }

  obtenerMergesHojaExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    sheetIndex: number,
  ): Observable<WorkbookMergesLayerOrm> {
    return this.http.get<WorkbookMergesLayerOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/hojas/${sheetIndex}/merges/`),
      this.requestOptions,
    );
  }

  obtenerImagenesHojaExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    sheetIndex: number,
  ): Observable<WorkbookImagesLayerOrm> {
    return this.http.get<WorkbookImagesLayerOrm>(
      this.url(`/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/hojas/${sheetIndex}/imagenes/`),
      this.requestOptions,
    );
  }

  descargarImagenHojaExcelCuantificacion(
    proyectoId: number,
    cuantificacionId: number,
    sheetIndex: number,
    imageId: string,
  ): Observable<Blob> {
    return this.http.get(
      this.url(
        `/api/proyectos/${proyectoId}/cuantificaciones/${cuantificacionId}/libro-excel/hojas/${sheetIndex}/imagenes/${imageId}/`,
      ),
      {
        ...this.requestOptions,
        responseType: 'blob',
      },
    );
  }

  listarCatalogos(proyectoId: number): Observable<ResultadosOrm<CatalogoB5DOrm>> {
    return this.http.get<ResultadosOrm<CatalogoB5DOrm>>(
      this.url(`/api/proyectos/${proyectoId}/catalogos/`),
      this.requestOptions,
    );
  }

  actualizarIfcMetadata(
    proyectoId: number,
    payload: ActualizarIfcMetadataPayload,
  ): Observable<ProyectoTrabajoOrm> {
    return this.http.patch<ProyectoTrabajoOrm>(
      this.url(`/api/proyectos/${proyectoId}/ifc-metadata/`),
      payload,
      this.requestOptions,
    );
  }

  editarConcepto(
    proyectoId: number,
    conceptoId: number,
    payload: EditarConceptoPayload,
  ): Observable<ConceptoB5DOrm> {
    return this.http.patch<ConceptoB5DOrm>(
      this.url(`/api/proyectos/${proyectoId}/conceptos/${conceptoId}/`),
      payload,
      this.requestOptions,
    );
  }

  guardarProyecto(
    proyectoId: number,
    payload: SaveB5DProyectPayloadOrm,
  ): Observable<GuardarProyectoB5DResponseOrm> {
    return this.http.post<GuardarProyectoB5DResponseOrm>(
      this.url(`/api/proyectos/${proyectoId}/guardar/`),
      payload,
      this.requestOptions,
    );
  }

  exportarProyecto(proyectoId: number, sincrono = false): Observable<ProyectoTrabajoOrm> {
    const formData = new FormData();
    if (sincrono) {
      formData.append('sincrono', '1');
    }
    return this.http.post<ProyectoTrabajoOrm>(
      this.url(`/api/proyectos/${proyectoId}/exportar/`),
      formData,
      this.requestOptions,
    );
  }

  descargarProyecto(proyectoId: number): Observable<Blob> {
    return this.http.get(this.url(`/api/proyectos/${proyectoId}/descargar/`), {
      ...this.requestOptions,
      responseType: 'blob',
    });
  }

  eliminarProyecto(proyectoId: number): Observable<EliminarProyectoResponseOrm> {
    return this.http.delete<EliminarProyectoResponseOrm>(
      this.url(`/api/proyectos/${proyectoId}/`),
      this.requestOptions,
    );
  }

  private url(path: string): string {
    return `${this.apiBaseUrl}${path}`;
  }
}
