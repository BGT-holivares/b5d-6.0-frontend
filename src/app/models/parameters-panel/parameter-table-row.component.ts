import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { ParametroB5DOrm } from '../../types/b5d-orm';
import type { TableColumnDefinition } from '../../utils/table-view/table-view';

@Component({
  selector: 'tr[b5dParameterRow]',
  standalone: true,
  templateUrl: './parameter-table-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'b5d-parameters-panel__selectable',
    '[class.b5d-parameters-panel__selectable--striped]': 'isStriped',
  },
})
export class ParameterTableRowComponent {
  @Input() row: ParametroB5DOrm | null = null;
  @Input() columns: TableColumnDefinition<ParametroB5DOrm>[] = [];
  @Input() saving = false;
  @Input() rowIndex = 0;

  get isStriped(): boolean {
    return this.rowIndex % 2 === 1;
  }

  onNumericChange(columnKey: 'minimo' | 'maximo' | 'promedio' | 'sigma', value: unknown): void {
    if (!this.row) return;
    const normalized = String(value ?? '').trim();
    const numericValue = Number(normalized.replace(',', '.'));
    const mutableRow = this.row as unknown as Record<string, number | null>;
    mutableRow[columnKey] = normalized && Number.isFinite(numericValue) ? numericValue : null;
  }
}
