import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { NodoCuantificacion } from '../../types/quantity-take-off';

type ConceptoB5D = {
  code: string;
  description: string;
  unit: string;
  group: string;
};

type ObjetoIfc = {
  id: string;
  objectType: string;
  material: string;
  description: string;
  ifcName: string;
  properties: Record<string, unknown>[];
};

type VinculoB5D = {
  id: string;
  conceptCode: string;
  conceptDescription: string;
  objectType: string;
  ifcName: string;
  propertyKey: string;
  propertyLabel: string;
  conversionFactor: number;
  description: string;
};

@Component({
  selector: 'app-linking-panel',
  imports: [FormsModule],
  templateUrl: './linking-panel.html',
  styleUrl: './linking-panel.scss',
})
export class LinkingPanel {
  @Input() datos: NodoCuantificacion | null = null;

  codigoConceptoSeleccionado = '';
  idObjetoSeleccionado = '';
  llavePropiedadSeleccionada = '';
  vinculos: VinculoB5D[] = [];

  readonly conceptos: ConceptoB5D[] = [
    {
      code: 'CIM01-05',
      description: 'Cimbra común en cimentación',
      unit: 'm2',
      group: 'CIMENTACIONES',
    },
    {
      code: 'EC01-08',
      description: 'Concreto premezclado en estructura',
      unit: 'm3',
      group: 'ESTRUCTURA DE CONCRETO',
    },
    {
      code: 'ALB01-01',
      description: 'Castillo de sección de 15 x 15 cm',
      unit: 'm',
      group: 'ALBAÑILERÍA',
    },
  ];

  get objetosIfc(): ObjetoIfc[] {
    if (!this.datos) return [];

    return this.datos.children.flatMap((categoria) =>
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

  agregarVinculo(): void {
    const concepto = this.conceptos.find((item) => item.code === this.codigoConceptoSeleccionado);
    const objeto = this.objetosIfc.find((item) => item.id === this.idObjetoSeleccionado);

    if (!concepto || !objeto || !this.llavePropiedadSeleccionada) return;

    this.vinculos = [
      ...this.vinculos,
      {
        id: `link-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        conceptCode: concepto.code,
        conceptDescription: concepto.description,
        objectType: objeto.objectType,
        ifcName: objeto.ifcName,
        propertyKey: this.llavePropiedadSeleccionada,
        propertyLabel: this.llavePropiedadSeleccionada,
        conversionFactor: 1,
        description: objeto.description,
      },
    ];
  }
}
