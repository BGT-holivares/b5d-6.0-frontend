import { Inject, Injectable, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';

export type LocalViewerSyncMessage =
  | {
      kind: 'ifc-file';
      file: File;
    }
  | {
      kind: 'ifc-selection';
      localIds: number[];
    };

@Injectable({ providedIn: 'root' })
export class LocalViewerSyncService implements OnDestroy {
  private readonly channelName = 'b5d-local-viewer-sync';
  private readonly instanceId = crypto.randomUUID();
  private readonly messageSubject = new Subject<LocalViewerSyncMessage>();
  private readonly broadcastChannelInstance: BroadcastChannel | null;

  readonly messages$ = this.messageSubject.asObservable();

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    if (!isPlatformBrowser(platformId) || typeof BroadcastChannel === 'undefined') {
      this.broadcastChannelInstance = null;
      return;
    }

    this.broadcastChannelInstance = new BroadcastChannel(this.channelName);
    this.broadcastChannelInstance.addEventListener('message', (event: MessageEvent<LocalViewerSyncMessage>) => {
      const message = event.data;
      if (!message) return;
      this.messageSubject.next(message);
    });
  }

  // Broadcasts an IFC file to the other browser tabs connected to the same local channel.
  broadcastIfcFile(file: File): void {
    this.broadcastMessage({
      kind: 'ifc-file',
      file,
    });
  }

  // Broadcasts the current IFC selection to the other browser tabs connected to the same local channel.
  broadcastSelection(localIds: number[]): void {
    this.broadcastMessage({
      kind: 'ifc-selection',
      localIds: [...new Set(localIds)].filter((localId) => Number.isInteger(localId) && localId > 0),
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
