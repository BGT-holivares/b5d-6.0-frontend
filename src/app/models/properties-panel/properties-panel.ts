import { Component, Input, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { InformacionElementoSeleccionado } from '../../types/ifc';
import { I18nService } from '../../utils/i18n/i18n.service';
import { PROPERTIES_PANEL_TRANSLATIONS } from './properties-panel.translations';

type PestanaPropiedades = 'properties' | 'location' | 'classification' | 'relations' | 'quantities';
type FilaPropiedad = [string, string | number];

@Component({
  selector: 'app-properties-panel',
  imports: [NgTemplateOutlet],
  templateUrl: './properties-panel.html',
  styleUrl: './properties-panel.scss',
})
export class PropertiesPanel {
  readonly i18n = inject(I18nService);
  readonly propertiesPanelTranslations = PROPERTIES_PANEL_TRANSLATIONS;

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

  readonly pestanas: { id: PestanaPropiedades; etiquetaKey: string }[] = [
    { id: 'properties', etiquetaKey: 'propertiesPanel.tab.properties' },
    { id: 'location', etiquetaKey: 'propertiesPanel.tab.location' },
    { id: 'classification', etiquetaKey: 'propertiesPanel.tab.classification' },
    { id: 'relations', etiquetaKey: 'propertiesPanel.tab.relations' },
    { id: 'quantities', etiquetaKey: 'propertiesPanel.tab.quantities' },
  ];

  t(key: string): string {
    return this.i18n.translateForComponent(this.propertiesPanelTranslations, key);
  }

  alternarSeccion(llave: string): void {
    this.seccionesAbiertas[llave] = !this.seccionesAbiertas[llave];
  }

  filasIdentidad(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      [this.t('propertiesPanel.field.expressId'), informacion.expressID],
      [this.t('propertiesPanel.field.localId'), informacion.localId],
      [this.t('propertiesPanel.field.globalId'), informacion.globalId],
      [this.t('propertiesPanel.field.ifcClass'), informacion.ifcClass],
      [this.t('propertiesPanel.field.name'), informacion.name],
      [this.t('propertiesPanel.field.objectType'), informacion.objectType],
    ];
  }

  filasGeometria(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      [this.t('propertiesPanel.field.boundingBoxLength'), informacion.width],
      [this.t('propertiesPanel.field.boundingBoxWidth'), informacion.depth],
      [this.t('propertiesPanel.field.boundingBoxHeight'), informacion.height],
      [this.t('propertiesPanel.field.totalArea'), informacion.totalArea],
      [this.t('propertiesPanel.field.grossArea'), informacion.grossArea],
      [this.t('propertiesPanel.field.netArea'), informacion.netArea],
      [this.t('propertiesPanel.field.totalVolume'), informacion.totalVolume],
      [this.t('propertiesPanel.field.grossVolume'), informacion.grossVolume],
      [this.t('propertiesPanel.field.netVolume'), informacion.netVolume],
      [this.t('propertiesPanel.field.perimeter'), informacion.perimeter],
      [this.t('propertiesPanel.field.length'), informacion.length],
    ];
  }

  filasUbicacion(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      [this.t('propertiesPanel.field.project'), informacion.project],
      [this.t('propertiesPanel.field.building'), informacion.building],
      [this.t('propertiesPanel.field.storey'), informacion.storey],
      [this.t('propertiesPanel.field.topElevation'), informacion.topElevation],
      [this.t('propertiesPanel.field.bottomElevation'), informacion.bottomElevation],
      [this.t('propertiesPanel.field.globalX'), informacion.globalX],
      [this.t('propertiesPanel.field.globalY'), informacion.globalY],
      [this.t('propertiesPanel.field.globalZ'), informacion.globalZ],
    ];
  }

  filasClasificacion(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      [this.t('propertiesPanel.field.ifcClass'), informacion.ifcClass],
      [this.t('propertiesPanel.field.layer'), informacion.layer],
      [this.t('propertiesPanel.field.objectType'), informacion.objectType],
    ];
  }

  filasRelaciones(): FilaPropiedad[] {
    const informacion = this.informacionSeleccionada;
    if (!informacion) return [];

    return [
      [this.t('propertiesPanel.field.globalId'), informacion.globalId],
      [this.t('propertiesPanel.field.name'), informacion.name],
      [this.t('propertiesPanel.field.ifcClass'), informacion.ifcClass],
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
