import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import type { ParametroB5DOrm } from '../../types/b5d-orm';
import type { TableColumnDefinition } from '../../utils/table-view/table-view';

@Component({
  selector: 'tr[b5dParameterRow]',
  standalone: true,
  templateUrl: './parameter-table-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'b5d-parameters-panel__selectable',
  },
})
export class ParameterTableRowComponent {
  @Input() row: ParametroB5DOrm | null = null;
  @Input() columns: TableColumnDefinition<ParametroB5DOrm>[] = [];
  @Input() editing = false;
  @Input() saving = false;

  getDisplayValue(columnKey: string): string {
    const parameterRow = this.row;
    if (!parameterRow) return '-';
    if (columnKey === 'activo') return parameterRow.activo ? 'Sí' : 'No';
    if (columnKey === 'clave') return (parameterRow.clave ?? '').trim() || '-';
    if (columnKey === 'descripcion') return (parameterRow.descripcion ?? '').trim() || '-';
    if (columnKey === 'tipo_comparacion') {
      if (parameterRow.tipo_comparacion === 'clave_exacta') return 'Clave exacta';
      if (parameterRow.tipo_comparacion === 'clave_parcial') return 'Clave parcial';
      return 'Descripción parcial';
    }
    if (columnKey === 'tipo_parametro') {
      if (parameterRow.tipo_parametro === 'cantidad') return 'Cantidades';
      if (parameterRow.tipo_parametro === 'costo') return 'Costos';
      return 'Costo %';
    }
    if (columnKey === 'tipo_edificacion') return (parameterRow.tipo_edificacion ?? '').trim() || '-';
    if (columnKey === 'unidad') return (parameterRow.unidad ?? '').trim() || '-';
    if (columnKey === 'minimo') return parameterRow.minimo == null ? '-' : String(parameterRow.minimo);
    if (columnKey === 'maximo') return parameterRow.maximo == null ? '-' : String(parameterRow.maximo);
    if (columnKey === 'promedio') return parameterRow.promedio == null ? '-' : String(parameterRow.promedio);
    return '-';
  }

  onNumericChange(columnKey: 'minimo' | 'maximo' | 'promedio', value: unknown): void {
    if (!this.row) return;
    const normalized = String(value ?? '').trim();
    const numericValue = Number(normalized.replace(',', '.'));
    const mutableRow = this.row as unknown as Record<string, number | null>;
    mutableRow[columnKey] = normalized && Number.isFinite(numericValue) ? numericValue : null;
  }
}
