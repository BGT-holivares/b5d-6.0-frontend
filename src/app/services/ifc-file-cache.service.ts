import { Injectable } from '@angular/core';

type PersistedIfcFileRecord = {
  projectId: number;
  fileName: string;
  fileType: string;
  fileBlob: Blob;
  updatedAt: number;
};

@Injectable({ providedIn: 'root' })
export class IfcFileCacheService {
  private readonly databaseName = 'b5d-ifc-file-cache';
  private readonly storeName = 'ifc-files';
  private readonly dbPromise = this.openDatabase();

  async save(projectId: number, file: File): Promise<void> {
    const db = await this.dbPromise;
    if (!db) return;

    const record: PersistedIfcFileRecord = {
      projectId,
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileBlob: file.slice(0, file.size, file.type || undefined),
      updatedAt: Date.now(),
    };

    await this.requestToPromise(db, 'readwrite', (store) => store.put(record));
  }

  async load(projectId: number): Promise<File | null> {
    const db = await this.dbPromise;
    if (!db) return null;

    const record = await this.requestToPromise<PersistedIfcFileRecord | undefined>(
      db,
      'readonly',
      (store) => store.get(projectId),
    );
    if (!record) return null;

    return new File([record.fileBlob], record.fileName || `project-${projectId}.ifc`, {
      type: record.fileType || 'application/octet-stream',
      lastModified: record.updatedAt,
    });
  }

  async clear(projectId: number): Promise<void> {
    const db = await this.dbPromise;
    if (!db) return;

    await this.requestToPromise(db, 'readwrite', (store) => store.delete(projectId));
  }

  private openDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);

    return new Promise((resolve) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'projectId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  private requestToPromise<T>(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, mode);
      const store = transaction.objectStore(this.storeName);
      const request = action(store);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('No se pudo leer la cache IFC.'));
    });
  }
}
