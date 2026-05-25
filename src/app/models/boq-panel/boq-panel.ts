import { Component, Input } from '@angular/core';
import type { CuantificacionB5DOrm, ProyectoTrabajoOrm } from '../../types/b5d-orm';

@Component({
  selector: 'app-boq-panel',
  imports: [],
  templateUrl: './boq-panel.html',
  styleUrl: './boq-panel.scss',
})
export class BoqPanel {
  @Input() proyectoActivo: ProyectoTrabajoOrm | null = null;
  @Input() cuantificacionesB5d: CuantificacionB5DOrm[] = [];
  @Input() cargandoB5d = false;

  cuantificacionSeleccionadaId: number | null = null;

  get cuantificacionSeleccionada(): CuantificacionB5DOrm | null {
    if (this.cuantificacionSeleccionadaId == null) {
      return this.cuantificacionesB5d[0] ?? null;
    }
    return this.cuantificacionesB5d.find((item) => item.id === this.cuantificacionSeleccionadaId) ?? null;
  }

  seleccionarCuantificacion(id: number): void {
    this.cuantificacionSeleccionadaId = id;
  }

  get etiquetaTienePlantilla(): string {
    return this.cuantificacionSeleccionada?.tiene_libro_excel ? 'Si' : 'No';
  }
}
