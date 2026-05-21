import { Component, Input } from '@angular/core';
import type { InformacionElementoSeleccionado } from '../../types/ifc';

type ParameterRow = {
  key: string;
  value: string | number;
};

@Component({
  selector: 'app-parameters-panel',
  imports: [],
  templateUrl: './parameters-panel.html',
  styleUrl: './parameters-panel.scss',
})
export class ParametersPanel {
  @Input() informacionSeleccionada: InformacionElementoSeleccionado | null = null;

  // Returns the selected element data as a simple parameter table.
  get rows(): ParameterRow[] {
    const information = this.informacionSeleccionada;
    if (!information) return [];

    return [
      { key: 'ExpressID', value: information.expressID },
      { key: 'Local ID', value: information.localId },
      { key: 'GlobalId', value: information.globalId },
      { key: 'IFC Class', value: information.ifcClass },
      { key: 'Name', value: information.name },
      { key: 'ObjectType', value: information.objectType },
      { key: 'Project', value: information.project },
      { key: 'Building', value: information.building },
      { key: 'Storey', value: information.storey },
      { key: 'Layer', value: information.layer },
    ];
  }
}
