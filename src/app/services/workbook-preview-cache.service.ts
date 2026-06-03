import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BackendProyectosService } from './backend-proyectos.service';
import type { WorkbookLayersOrm, WorkbookSummaryOrm } from '../types/b5d-orm';

export type WorkbookCacheEntry = {
  workbook: any;
  sheetNames: string[];
  bytes: Uint8Array;
};

@Injectable({ providedIn: 'root' })
export class WorkbookPreviewCacheService {
  private readonly workbookByQuantification = new Map<string, WorkbookCacheEntry>();
  private readonly workbookLoadByQuantification = new Map<string, Promise<WorkbookCacheEntry>>();
  private readonly workbookSummaryByQuantification = new Map<string, WorkbookSummaryOrm>();
  private readonly workbookSummaryLoadByQuantification = new Map<string, Promise<WorkbookSummaryOrm>>();
  private readonly workbookLayersBySheet = new Map<string, WorkbookLayersOrm>();
  private readonly workbookLayersLoadBySheet = new Map<string, Promise<WorkbookLayersOrm>>();
  private readonly workbookImageDataUriByKey = new Map<string, string>();
  private readonly workbookImageLoadByKey = new Map<string, Promise<string>>();
  private readonly documentBySheet = new Map<string, string>();
  private readonly workbookImageCacheStoragePrefix = 'b5d-workbook-image:';

  constructor(private readonly backendProyectos: BackendProyectosService) {}

  async getWorkbook(projectId: number, quantificationId: number): Promise<WorkbookCacheEntry> {
    const key = this.quantificationKey(projectId, quantificationId);
    const cachedWorkbook = this.workbookByQuantification.get(key);
    if (cachedWorkbook) return cachedWorkbook;

    const pendingLoad = this.workbookLoadByQuantification.get(key);
    if (pendingLoad) return pendingLoad;

    const loadPromise = (async (): Promise<WorkbookCacheEntry> => {
      const workbookArrayBuffer = await firstValueFrom(
        this.backendProyectos.descargarLibroExcelCuantificacion(projectId, quantificationId),
      );
      const xlsxModule = await import('xlsx');
      const workbook = xlsxModule.read(workbookArrayBuffer, {
        type: 'array',
        bookFiles: true,
        cellStyles: true,
        cellFormula: true,
        cellText: true,
      });
      const sheetNames = [...(workbook.SheetNames ?? [])];
      const bytes = new Uint8Array(workbookArrayBuffer);
      const cacheEntry = { workbook, sheetNames, bytes };
      this.workbookByQuantification.set(key, cacheEntry);
      return cacheEntry;
    })();

    this.workbookLoadByQuantification.set(key, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.workbookLoadByQuantification.delete(key);
    }
  }

  async getWorkbookSummary(projectId: number, quantificationId: number): Promise<WorkbookSummaryOrm> {
    const key = this.quantificationKey(projectId, quantificationId);
    const cachedSummary = this.workbookSummaryByQuantification.get(key);
    if (cachedSummary) return cachedSummary;

    const pendingLoad = this.workbookSummaryLoadByQuantification.get(key);
    if (pendingLoad) return pendingLoad;

    const loadPromise = firstValueFrom(this.backendProyectos.obtenerResumenLibroExcelCuantificacion(projectId, quantificationId));
    this.workbookSummaryLoadByQuantification.set(key, loadPromise);
    try {
      const summary = await loadPromise;
      this.workbookSummaryByQuantification.set(key, summary);
      return summary;
    } finally {
      this.workbookSummaryLoadByQuantification.delete(key);
    }
  }

  async getWorkbookSheetLayers(projectId: number, quantificationId: number, sheetIndex: number): Promise<WorkbookLayersOrm> {
    const key = this.sheetKey(projectId, quantificationId, sheetIndex);
    const cachedLayers = this.workbookLayersBySheet.get(key);
    if (cachedLayers) return cachedLayers;

    const pendingLoad = this.workbookLayersLoadBySheet.get(key);
    if (pendingLoad) return pendingLoad;

    const loadPromise = firstValueFrom(
      this.backendProyectos.obtenerCapasHojaExcelCuantificacion(projectId, quantificationId, sheetIndex),
    );
    this.workbookLayersLoadBySheet.set(key, loadPromise);
    try {
      const layers = await loadPromise;
      this.workbookLayersBySheet.set(key, layers);
      return layers;
    } finally {
      this.workbookLayersLoadBySheet.delete(key);
    }
  }

  async getWorkbookImageDataUri(
    projectId: number,
    quantificationId: number,
    sheetIndex: number,
    imageId: string,
  ): Promise<string> {
    const key = this.imageKey(projectId, quantificationId, sheetIndex, imageId);
    const memoryValue = this.workbookImageDataUriByKey.get(key) ?? '';
    if (memoryValue) return memoryValue;

    const storageKey = `${this.workbookImageCacheStoragePrefix}${key}`;
    try {
      const localStorageValue = localStorage.getItem(storageKey) ?? '';
      if (localStorageValue.startsWith('data:image/')) {
        this.workbookImageDataUriByKey.set(key, localStorageValue);
        return localStorageValue;
      }
    } catch {
      // Ignores localStorage availability and quota errors.
    }

    const pendingLoad = this.workbookImageLoadByKey.get(key);
    if (pendingLoad) return pendingLoad;

    const loadPromise = (async (): Promise<string> => {
      const imageBlob = await firstValueFrom(
        this.backendProyectos.descargarImagenHojaExcelCuantificacion(projectId, quantificationId, sheetIndex, imageId),
      );
      const imageDataUri = await this.convertBlobToDataUri(imageBlob);
      if (!imageDataUri) return '';

      this.workbookImageDataUriByKey.set(key, imageDataUri);
      if (this.workbookImageDataUriByKey.size > 500) {
        const oldestKey = this.workbookImageDataUriByKey.keys().next().value;
        if (oldestKey) this.workbookImageDataUriByKey.delete(oldestKey);
      }
      try {
        localStorage.setItem(storageKey, imageDataUri);
      } catch {
        // Ignores localStorage availability and quota errors.
      }
      return imageDataUri;
    })();

    this.workbookImageLoadByKey.set(key, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.workbookImageLoadByKey.delete(key);
    }
  }

  getSheetDocument(projectId: number, quantificationId: number, sheetIndex: number): string | null {
    return this.documentBySheet.get(this.sheetKey(projectId, quantificationId, sheetIndex)) ?? null;
  }

  setSheetDocument(projectId: number, quantificationId: number, sheetIndex: number, htmlDocument: string): void {
    this.documentBySheet.set(this.sheetKey(projectId, quantificationId, sheetIndex), htmlDocument);
  }

  clearQuantification(projectId: number, quantificationId: number): void {
    const quantificationPrefix = this.quantificationKey(projectId, quantificationId);
    this.workbookByQuantification.delete(quantificationPrefix);
    this.workbookSummaryByQuantification.delete(quantificationPrefix);
    this.workbookLoadByQuantification.delete(quantificationPrefix);
    this.workbookSummaryLoadByQuantification.delete(quantificationPrefix);

    for (const sheetKey of Array.from(this.documentBySheet.keys())) {
      if (sheetKey.startsWith(`${quantificationPrefix}:`)) {
        this.documentBySheet.delete(sheetKey);
      }
    }
    for (const sheetKey of Array.from(this.workbookLayersBySheet.keys())) {
      if (sheetKey.startsWith(`${quantificationPrefix}:`)) {
        this.workbookLayersBySheet.delete(sheetKey);
      }
    }
    for (const sheetKey of Array.from(this.workbookLayersLoadBySheet.keys())) {
      if (sheetKey.startsWith(`${quantificationPrefix}:`)) {
        this.workbookLayersLoadBySheet.delete(sheetKey);
      }
    }

    for (const imageKey of Array.from(this.workbookImageDataUriByKey.keys())) {
      if (imageKey.startsWith(`${quantificationPrefix}:`)) {
        this.workbookImageDataUriByKey.delete(imageKey);
      }
    }
    for (const imageKey of Array.from(this.workbookImageLoadByKey.keys())) {
      if (imageKey.startsWith(`${quantificationPrefix}:`)) {
        this.workbookImageLoadByKey.delete(imageKey);
      }
    }

    const localStoragePrefix = `${this.workbookImageCacheStoragePrefix}${quantificationPrefix}:`;
    try {
      for (let itemIndex = localStorage.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const storageKey = localStorage.key(itemIndex) ?? '';
        if (storageKey.startsWith(localStoragePrefix)) {
          localStorage.removeItem(storageKey);
        }
      }
    } catch {
      // Ignores localStorage availability errors.
    }
  }

  private quantificationKey(projectId: number, quantificationId: number): string {
    return `${projectId}:${quantificationId}`;
  }

  private sheetKey(projectId: number, quantificationId: number, sheetIndex: number): string {
    return `${projectId}:${quantificationId}:${sheetIndex}`;
  }

  private imageKey(projectId: number, quantificationId: number, sheetIndex: number, imageId: string): string {
    return `${projectId}:${quantificationId}:${sheetIndex}:${imageId}`;
  }

  private convertBlobToDataUri(blobData: Blob): Promise<string> {
    return new Promise((resolve) => {
      if (!blobData || blobData.size <= 0) {
        resolve('');
        return;
      }

      const fileReader = new FileReader();
      fileReader.onload = () => {
        resolve(typeof fileReader.result === 'string' ? fileReader.result : '');
      };
      fileReader.onerror = () => resolve('');
      fileReader.readAsDataURL(blobData);
    });
  }
}
