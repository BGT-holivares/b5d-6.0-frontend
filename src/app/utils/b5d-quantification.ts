import type {
  ElementoIfcB5D,
  FilaCantidadB5D,
  NodoCuantificacion,
  UnidadCantidad,
} from '../types/quantity-take-off';

export class CuantificadorB5D {
  cuantificar(elementos: ElementoIfcB5D[]): FilaCantidadB5D[] {
    return elementos.map((elemento) => {
      const clase = elemento.ifcClass.toUpperCase();
      let cantidad = elemento.count ?? 1;
      let unidad: UnidadCantidad = 'pza';

      if (clase.includes('WALL') || clase.includes('SLAB') || clase.includes('COVERING')) {
        cantidad = elemento.area ?? elemento.count ?? 1;
        unidad = elemento.area ? 'm2' : 'pza';
      } else if (clase.includes('BEAM') || clase.includes('PIPE')) {
        cantidad = elemento.length ?? elemento.count ?? 1;
        unidad = elemento.length ? 'm' : 'pza';
      } else if (clase.includes('COLUMN') || clase.includes('FOOTING')) {
        cantidad = elemento.volume ?? elemento.count ?? 1;
        unidad = elemento.volume ? 'm3' : 'pza';
      }

      return {
        id: `b5d-${elemento.localId}`,
        elementId: elemento.localId,
        expressID: elemento.expressID,
        ifcClass: elemento.ifcClass,
        elementName: elemento.name,
        objectType: elemento.objectType,
        project: elemento.project,
        site: elemento.site,
        building: elemento.building,
        storey: elemento.storey,
        category: elemento.category,
        elementType: elemento.elementType,
        quantity: cantidad,
        unit: unidad,
        source: 'RULE',
        amount: 0,
      };
    });
  }

  construirArbolPanel(filas: FilaCantidadB5D[]): NodoCuantificacion {
    const raiz: NodoCuantificacion = {
      id: 'b5d-root',
      type: 'root',
      name: 'Cuantificación B5D',
      quantity: 0,
      children: [],
    };

    const mapaCategorias = new Map<string, NodoCuantificacion>();

    for (const fila of filas) {
      const categoria = this.limpiarTexto(fila.category) || this.limpiarTexto(fila.ifcClass) || 'Otros';
      const tipo =
        this.limpiarTexto(fila.elementType) ||
        this.limpiarTexto(fila.elementName) ||
        this.limpiarTexto(fila.objectType) ||
        'Sin tipo';
      const cantidad = Number(fila.quantity ?? 1);
      const unidad = fila.unit || 'pza';

      let nodoCategoria = mapaCategorias.get(categoria);

      if (!nodoCategoria) {
        nodoCategoria = {
          id: `cat-${categoria}`,
          type: 'ifcType',
          name: categoria,
          quantity: 0,
          children: [],
        };

        mapaCategorias.set(categoria, nodoCategoria);
        raiz.children.push(nodoCategoria);
      }

      let nodoTipo = nodoCategoria.children.find(
        (nodo) => nodo.name === tipo && nodo.unit === unidad,
      );

      if (!nodoTipo) {
        nodoTipo = {
          id: `type-${categoria}-${tipo}-${unidad}`,
          type: 'concept',
          name: tipo,
          description: unidad,
          unit: unidad,
          quantity: 0,
          children: [],
        };

        nodoCategoria.children.push(nodoTipo);
      }

      nodoTipo.quantity += cantidad;
      nodoCategoria.quantity += cantidad;
      raiz.quantity += cantidad;

      const nodoConPropiedades = nodoTipo as NodoCuantificacion & {
        properties?: Record<string, unknown>[];
      };
      nodoConPropiedades.properties = nodoConPropiedades.properties ?? [];
      nodoConPropiedades.properties.push({
        localId: fila.elementId,
        name: fila.elementName || 'Sin nombre',
        ifcClass: fila.ifcClass || 'N/D',
        storey: fila.storey || 'Sin nivel',
        objectType: fila.objectType || 'N/D',
        quantity: cantidad,
        unit: unidad,
      });
    }

    raiz.children.sort((a, b) => a.name.localeCompare(b.name, 'es'));

    for (const categoria of raiz.children) {
      categoria.children.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }

    return raiz;
  }

  private limpiarTexto(valor?: string): string {
    return valor && valor.trim() && valor !== 'N/D' ? valor.trim() : '';
  }
}
