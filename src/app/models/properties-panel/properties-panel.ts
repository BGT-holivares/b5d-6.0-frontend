import { Component, Input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { InformacionElementoSeleccionado } from '../../types/ifc';
import { classifyInfrastructureElement } from '../../utils/ifc-infrastructure-translator'

type PestanaPropiedades =
  | 'properties'
  | 'location'
  | 'classification'
  | 'relations'
  | 'quantities';

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
    identity: true, // Identity section visibility
    geometry: true, // Geometry section visibility
    quantities: true, // Base quantities section visibility
    archicad: true, // ArchiCAD quantities section visibility
    other: true, // Other IFC quantities section visibility
    location: true, // Location section visibility
    classification: true, // Classification section visibility
    relations: true, // Relations section visibility
    infrastructure: true, // Infrastructure section visibility
  };

  readonly pestanas: { id: PestanaPropiedades; etiqueta: string }[] = [
    { id: 'properties', etiqueta: 'Propiedades' },
    { id: 'location', etiqueta: 'Localización' },
    { id: 'classification', etiqueta: 'Clasificación' },
    { id: 'relations', etiqueta: 'Relaciones' },
    { id: 'quantities', etiqueta: 'Cantidades' },
  ];

  /**
   * Toggles a collapsible section.
   */

  alternarSeccion(llave: string): void {
    this.seccionesAbiertas[llave] = !this.seccionesAbiertas[llave];
  }
/**
   * Returns infrastructure classification for the selected IFC element.
   */
  clasificacionInfraestructura() {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return null;

    return classifyInfrastructureElement(
  informacion.ifcClass,
  informacion.name,
  informacion.objectType
  );
  }

  /**
   * Returns infrastructure-related rows.
   */
  filasInfraestructura(): FilaPropiedad[] {
    const infraestructura = this.clasificacionInfraestructura();
    if (!infraestructura) return [];

    return [
      ['Categoría de infraestructura', infraestructura.category],
      ['Tipo de infraestructura', infraestructura.type],
      ['Unidad sugerida', infraestructura.defaultUnit],
    ];
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