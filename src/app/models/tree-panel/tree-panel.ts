import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { NodoArbolIfc } from '../../types/ifc';

type NodoVisible = {
  nodo: NodoArbolIfc;
  nivel: number;
};

@Component({
  selector: 'app-tree-panel',
  imports: [],
  templateUrl: './tree-panel.html',
  styleUrl: './tree-panel.scss',
})
export class TreePanel {
  @Input() visible = false;
  @Input() datosArbol: NodoArbolIfc[] = [];
  @Input() nodosExpandidos: Record<string, boolean> = {};
  @Input() localIdSeleccionado: number | null = null;

  @Output() alternarNodo = new EventEmitter<string>();
  @Output() seleccionarElemento = new EventEmitter<number>();

  get nodosVisibles(): NodoVisible[] {
    const resultado: NodoVisible[] = [];

    const recorrer = (nodos: NodoArbolIfc[], nivel: number): void => {
      for (const nodo of nodos) {
        resultado.push({ nodo, nivel });

        if (nodo.children.length && this.nodosExpandidos[nodo.id]) {
          recorrer(nodo.children, nivel + 1);
        }
      }
    };

    recorrer(this.datosArbol, 0);
    return resultado;
  }

  obtenerIcono(nodo: NodoArbolIfc): string {
    if (nodo.kind === 'spatial') return '□';
    if (nodo.kind === 'group') return '◇';
    return '▪';
  }

  manejarClickNodo(nodo: NodoArbolIfc): void {
    if (nodo.kind === 'element' && typeof nodo.localId === 'number') {
      this.seleccionarElemento.emit(nodo.localId);
      return;
    }

    if (nodo.children.length) this.alternarNodo.emit(nodo.id);
  }

  esSeleccionado(nodo: NodoArbolIfc): boolean {
    return (
      nodo.kind === 'element' &&
      typeof nodo.localId === 'number' &&
      nodo.localId === this.localIdSeleccionado
    );
  }

  obtenerSangria(nivel: number): string {
    return `${8 + nivel * 20}px`;
  }
}
