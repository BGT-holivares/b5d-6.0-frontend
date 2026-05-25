import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  ConceptoB5DOrm,
  CuantificacionB5DOrm,
  EliminarProyectoResponseOrm,
  ProyectoTrabajoOrm,
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
