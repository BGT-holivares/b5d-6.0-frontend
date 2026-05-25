import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { NodoCuantificacion } from '../../types/quantity-take-off';
import type {
  ConceptoB5DOrm,
  ProyectoTrabajoOrm,
  VinculoConceptoBimOrm,
} from '../../types/b5d-orm';

type ObjetoIfc = {
  id: string;
  objectType: string;
  material: string;
  description: string;
  ifcName: string;
  properties: Record<string, unknown>[];
};

type VinculoPanel = {
  id: string;
  conceptoId: number | null;
  conceptCode: string;
  conceptDescription: string;
  objectType: string;
  ifcName: string;
  propertyKey: string;
  propertyLabel: string;
  conversionFactor: number;
  description: string;
};

type ConceptoFila = {
  id: number;
  level: number;
  clave: string;
  descripcion: string;
  unidad: string;
  linked: boolean;
};

@Component({
  selector: 'app-linking-panel',
  imports: [FormsModule],
  templateUrl: './linking-panel.html',
  styleUrl: './linking-panel.scss',
})
export class LinkingPanel {
  @Input() datosIfc: NodoCuantificacion | null = null;
  @Input() proyectoActivo: ProyectoTrabajoOrm | null = null;
  @Input() conceptosB5d: ConceptoB5DOrm[] = [];
  @Input() vinculosB5d: VinculoConceptoBimOrm[] = [];
  @Input() cargandoB5d = false;

  conceptoSeleccionadoId: number | null = null;
  idObjetoSeleccionado = '';
  llavePropiedadSeleccionada = '';
  vinculosLocales: VinculoPanel[] = [];

  get objetosIfc(): ObjetoIfc[] {
    if (!this.datosIfc) return [];

    return this.datosIfc.children.flatMap((categoria) =>
      categoria.children.map((tipoNodo) => {
        const nodoConPropiedades = tipoNodo as NodoCuantificacion & {
          properties?: Record<string, unknown>[];
        };

        return {
          id: tipoNodo.id,
          objectType: tipoNodo.name,
          material: '',
          description: categoria.name,
          ifcName: tipoNodo.name,
          properties: nodoConPropiedades.properties ?? [],
        };
      }),
    );
  }

  get conceptosEstructurados(): ConceptoFila[] {
    const conceptos = [...this.conceptosB5d];
    const hijosPorPadre = new Map<number | null, ConceptoB5DOrm[]>();
    const ids = new Set<number>(conceptos.map((concepto) => concepto.id));

    for (const concepto of conceptos) {
      const parentId =
        concepto.agrupador_padre_id && ids.has(concepto.agrupador_padre_id)
          ? concepto.agrupador_padre_id
          : null;
      const hijos = hijosPorPadre.get(parentId) ?? [];
      hijos.push(concepto);
      hijosPorPadre.set(parentId, hijos);
    }

    const linkedIds = this.idsConceptoConVinculo();
    const filas: ConceptoFila[] = [];
    const visitados = new Set<number>();

    const recorrer = (parentId: number | null, level: number): void => {
      const hijos = hijosPorPadre.get(parentId) ?? [];
      for (const concepto of hijos) {
        if (visitados.has(concepto.id)) continue;
        visitados.add(concepto.id);
        filas.push({
          id: concepto.id,
          level,
          clave: concepto.clave ?? '',
          descripcion: concepto.descripcion ?? '',
          unidad: concepto.unidad ?? '',
          linked: linkedIds.has(concepto.id),
        });
        recorrer(concepto.id, level + 1);
      }
    };

    recorrer(null, 0);
    for (const concepto of conceptos) {
      if (visitados.has(concepto.id)) continue;
      filas.push({
        id: concepto.id,
        level: 0,
        clave: concepto.clave ?? '',
        descripcion: concepto.descripcion ?? '',
        unidad: concepto.unidad ?? '',
        linked: linkedIds.has(concepto.id),
      });
    }

    return filas;
  }

  get vinculosRelacionados(): VinculoPanel[] {
    const conceptosPorId = new Map<number, ConceptoB5DOrm>();
    for (const concepto of this.conceptosB5d) {
      conceptosPorId.set(concepto.id, concepto);
    }

    const desdeBackend = this.vinculosB5d.map((vinculo) => {
      const concepto = vinculo.concepto_id != null ? conceptosPorId.get(vinculo.concepto_id) : null;
      return {
        id: `db-${vinculo.id}`,
        conceptoId: vinculo.concepto_id,
        conceptCode: concepto?.clave ?? '',
        conceptDescription: concepto?.descripcion ?? '',
        objectType: vinculo.tipo_objeto_bim ?? '',
        ifcName: vinculo.tipo_objeto_bim ?? '',
        propertyKey: vinculo.propiedad_cantidad_bim ?? '',
        propertyLabel: vinculo.propiedad_cantidad_bim ?? '',
        conversionFactor: vinculo.factor_conversion ?? 1,
        description: vinculo.descripcion ?? '',
      } satisfies VinculoPanel;
    });

    return [...desdeBackend, ...this.vinculosLocales];
  }

  get opcionesPropiedad(): string[] {
    const objeto = this.objetosIfc.find((item) => item.id === this.idObjetoSeleccionado);
    if (!objeto) return [];

    const llaves = new Set<string>([
      'quantity',
      'area',
      'grossArea',
      'netArea',
      'volume',
      'grossVolume',
      'netVolume',
      'length',
      'perimeter',
    ]);

    for (const propiedad of objeto.properties) {
      for (const llave of Object.keys(propiedad)) {
        if (!['localId', 'name', 'ifcClass', 'storey', 'objectType'].includes(llave)) {
          llaves.add(llave);
        }
      }

      const cantidades = propiedad['quantities'];
      if (cantidades && typeof cantidades === 'object') {
        for (const llave of Object.keys(cantidades)) llaves.add(llave);
      }
    }

    return Array.from(llaves).sort((a, b) => a.localeCompare(b, 'es'));
  }

  seleccionarObjeto(id: string): void {
    this.idObjetoSeleccionado = id;
    this.llavePropiedadSeleccionada = '';
  }

  seleccionarConcepto(id: number): void {
    this.conceptoSeleccionadoId = id;
  }

  isObjetoVinculado(objetoIfc: ObjetoIfc): boolean {
    const linkedObjectTypes = new Set(
      this.vinculosRelacionados
        .map((vinculo) => this.normalizarTexto(vinculo.objectType))
        .filter((valor) => !!valor),
    );
    return linkedObjectTypes.has(this.normalizarTexto(objetoIfc.objectType));
  }

  indentation(level: number): string {
    return `${10 + level * 18}px`;
  }

  agregarVinculo(): void {
    const concepto = this.conceptosB5d.find((item) => item.id === this.conceptoSeleccionadoId);
    const objeto = this.objetosIfc.find((item) => item.id === this.idObjetoSeleccionado);

    if (!concepto || !objeto || !this.llavePropiedadSeleccionada) return;

    this.vinculosLocales = [
      ...this.vinculosLocales,
      {
        id: `link-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        conceptoId: concepto.id,
        conceptCode: concepto.clave ?? '',
        conceptDescription: concepto.descripcion ?? '',
        objectType: objeto.objectType,
        ifcName: objeto.ifcName,
        propertyKey: this.llavePropiedadSeleccionada,
        propertyLabel: this.llavePropiedadSeleccionada,
        conversionFactor: 1,
        description: objeto.description,
      },
    ];
  }

  private idsConceptoConVinculo(): Set<number> {
    const ids = new Set<number>();
    for (const vinculo of this.vinculosB5d) {
      if (vinculo.concepto_id != null) {
        ids.add(vinculo.concepto_id);
      }
    }
    for (const vinculo of this.vinculosLocales) {
      if (vinculo.conceptoId != null) {
        ids.add(vinculo.conceptoId);
      }
    }
    return ids;
  }

  private normalizarTexto(valor: string | null): string {
    return (valor ?? '').trim().toLowerCase();
  }
}
