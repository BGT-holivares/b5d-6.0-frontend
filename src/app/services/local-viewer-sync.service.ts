import { Inject, Injectable, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { createRandomId } from '../utils/random-id';
import { logB5dDebug } from '../utils/debug/b5d-debug';
import type { InformacionElementoSeleccionado } from '../types/ifc';
import type { ElementoIfcB5D } from '../types/quantity-take-off';

export type LocalViewerSyncMessage =
  | {
      kind: 'ifc-file';
      file: File;
    }
  | {
      kind: 'ifc-clear';
    }
  | {
      kind: 'ifc-elements';
      ifcElements: ElementoIfcB5D[];
    }
  | {
      kind: 'ifc-selection';
      localIds: number[];
      selectedElementInfo: InformacionElementoSeleccionado | null;
    }
  | {
      kind: 'viewer-lighting';
      enabled: boolean;
    };

@Injectable({ providedIn: 'root' })
export class LocalViewerSyncService implements OnDestroy {
  private readonly channelName = 'b5d-local-viewer-sync';
  private readonly instanceId = createRandomId('tab');
  private readonly messageSubject = new Subject<LocalViewerSyncMessage>();
  private readonly broadcastChannelInstance: BroadcastChannel | null;

  readonly messages$ = this.messageSubject.asObservable();

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    if (!isPlatformBrowser(platformId) || typeof BroadcastChannel === 'undefined') {
      this.broadcastChannelInstance = null;
      logB5dDebug('local-viewer-sync: initialized', {
        instanceId: this.instanceId,
        channelName: this.channelName,
        hasBroadcastChannel: false,
      });
      return;
    }

    this.broadcastChannelInstance = new BroadcastChannel(this.channelName);
    logB5dDebug('local-viewer-sync: initialized', {
      instanceId: this.instanceId,
      channelName: this.channelName,
      hasBroadcastChannel: true,
    });
    this.broadcastChannelInstance.addEventListener('message', (event: MessageEvent<LocalViewerSyncMessage>) => {
      const message = event.data;
      if (!message) return;
      logB5dDebug('local-viewer-sync: message received', {
        kind: message.kind,
        sourceId: (message as LocalViewerSyncMessage & { sourceId?: string }).sourceId ?? null,
      });
      this.messageSubject.next(message);
    });
  }

  // Broadcasts an IFC file to the other browser tabs connected to the same local channel.
  broadcastIfcFile(file: File): void {
    logB5dDebug('local-viewer-sync: broadcast ifc-file', {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
    this.broadcastMessage({
      kind: 'ifc-file',
      file,
    });
  }

  // Broadcasts that the current IFC file was unloaded in another browser tab.
  broadcastIfcClear(): void {
    logB5dDebug('local-viewer-sync: broadcast ifc-clear');
    this.broadcastMessage({
      kind: 'ifc-clear',
    });
  }

  // Broadcasts the IFC rows mirrored from the viewer so control windows can stay data-only.
  broadcastIfcElements(ifcElements: ElementoIfcB5D[]): void {
    logB5dDebug('local-viewer-sync: broadcast ifc-elements', {
      count: ifcElements.length,
    });
    this.broadcastMessage({
      kind: 'ifc-elements',
      ifcElements: [...ifcElements],
    });
  }

  // Broadcasts the current IFC selection to the other browser tabs connected to the same local channel.
  broadcastSelection(localIds: number[], selectedElementInfo: InformacionElementoSeleccionado | null): void {
    logB5dDebug('local-viewer-sync: broadcast ifc-selection', {
      count: localIds.length,
      hasSelectedElementInfo: !!selectedElementInfo,
    });
    this.broadcastMessage({
      kind: 'ifc-selection',
      localIds: [...new Set(localIds)].filter((localId) => Number.isInteger(localId) && localId > 0),
      selectedElementInfo: selectedElementInfo ? { ...selectedElementInfo } : null,
    });
  }

  // Broadcasts the optional viewer lighting preset state to the other browser tabs.
  broadcastModelLighting(enabled: boolean): void {
    logB5dDebug('local-viewer-sync: broadcast viewer-lighting', {
      enabled,
    });
    this.broadcastMessage({
      kind: 'viewer-lighting',
      enabled,
    });
  }

  // Closes the browser channel when the service is destroyed.
  ngOnDestroy(): void {
    this.broadcastChannelInstance?.close();
    this.messageSubject.complete();
  }

  private broadcastMessage(message: LocalViewerSyncMessage): void {
    if (!this.broadcastChannelInstance) return;
    this.broadcastChannelInstance.postMessage({
      ...message,
      sourceId: this.instanceId,
    } as LocalViewerSyncMessage & { sourceId: string });
  }
}
