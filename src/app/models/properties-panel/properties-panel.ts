import { Component, Input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { InformacionElementoSeleccionado } from '../../types/ifc';

type PestanaPropiedades = 'properties' | 'location' | 'classification' | 'relations' | 'quantities';
type FilaPropiedad = [string, string | number];

@Component({
  selector: 'app-properties-panel',
  imports: [NgTemplateOutlet],
  templateUrl: './properties-panel.html',
  styleUrl: './properties-panel.scss',
})
export class PropertiesPanel {
  @Input() informacionSeleccionada: InformacionElementoSeleccionado | null = null;

  activeTab: PestanaPropiedades = 'properties';
  seccionesAbiertas: Record<string, boolean> = {
    identity: true,
    geometry: true,
    quantities: true,
    archicad: true,
    other: true,
    location: true,
    classification: true,
    relations: true,
  };

  readonly pestanas: { id: PestanaPropiedades; etiqueta: string }[] = [
    { id: 'properties', etiqueta: 'Propiedades' },
    { id: 'location', etiqueta: 'Localización' },
    { id: 'classification', etiqueta: 'Clasificación' },
    { id: 'relations', etiqueta: 'Relaciones' },
    { id: 'quantities', etiqueta: 'Cantidades' },
  ];

  alternarSeccion(llave: string): void {
    this.seccionesAbiertas[llave] = !this.seccionesAbiertas[llave];
  }

  filasIdentidad(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      ['ExpressID', informacion.expressID],
      ['Local ID', informacion.localId],
      ['GlobalId', informacion.globalId],
      ['IFC Class', informacion.ifcClass],
      ['Name', informacion.name],
      ['ObjectType', informacion.objectType],
    ];
  }

  filasGeometria(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      ['Bounding Box Length', informacion.width],
      ['Bounding Box Width', informacion.depth],
      ['Bounding Box Height', informacion.height],
      ['Área total', informacion.totalArea],
      ['Área bruta', informacion.grossArea],
      ['Área neta', informacion.netArea],
      ['Volumen total', informacion.totalVolume],
      ['Volumen bruto', informacion.grossVolume],
      ['Volumen neto', informacion.netVolume],
      ['Perímetro', informacion.perimeter],
      ['Longitud', informacion.length],
    ];
  }

  filasUbicacion(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      ['Project', informacion.project],
      ['Building', informacion.building],
      ['Storey', informacion.storey],
      ['Top Elevation', informacion.topElevation],
      ['Bottom Elevation', informacion.bottomElevation],
      ['Global X', informacion.globalX],
      ['Global Y', informacion.globalY],
      ['Global Z', informacion.globalZ],
    ];
  }

  filasClasificacion(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      ['IFC Class', informacion.ifcClass],
      ['Layer', informacion.layer],
      ['ObjectType', informacion.objectType],
    ];
  }

  filasRelaciones(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      ['GlobalId', informacion.globalId],
      ['Name', informacion.name],
      ['IFC Class', informacion.ifcClass],
    ];
  }

  filasCantidades(tipo: 'archicad' | 'base' | 'other'): FilaPropiedad[] {
    const cantidades = Object.entries(this.informacionSeleccionada?.quantities ?? {});

    return cantidades
      .filter(([llave]) => {
        const normalizada = llave.toLowerCase();
        const esArchiCAD = normalizada.includes('archicadquantities');
        const esBase = normalizada.includes('basequantities');

        if (tipo === 'archicad') return esArchiCAD;
        if (tipo === 'base') return esBase;
        return !esArchiCAD && !esBase;
      })
      .sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }
}
