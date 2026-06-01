import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  CatalogoB5DOrm,
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

export interface EditarConceptoPayload {
  clave?: string | null;
  clave_secundaria?: string | null;
  descripcion?: string | null;
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
  tipo_parametro?: 'costo' | 'cantidad';
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
