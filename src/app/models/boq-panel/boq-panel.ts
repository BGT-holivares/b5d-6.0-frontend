import { Component, Input } from '@angular/core';
import type { NodoCuantificacion } from '../../types/quantity-take-off';

type BoqRow = {
  id: string;
  name: string;
  type: string;
  level: number;
  unit: string;
  quantity: number;
};

@Component({
  selector: 'app-boq-panel',
  imports: [],
  templateUrl: './boq-panel.html',
  styleUrl: './boq-panel.scss',
})
export class BoqPanel {
  @Input() datos: NodoCuantificacion | null = null;

  // Builds a flattened bill of quantities table from the current quantity tree.
  get rows(): BoqRow[] {
    if (!this.datos) return [];

    const rows: BoqRow[] = [];
    const visitNode = (node: NodoCuantificacion, level: number): void => {
      rows.push({
        id: node.id,
        name: node.name,
        type: node.type,
        level,
        unit: node.unit ?? '-',
        quantity: node.quantity,
      });

      for (const child of node.children) visitNode(child, level + 1);
    };

    for (const child of this.datos.children) visitNode(child, 0);
    return rows;
  }

  // Returns the indentation used to keep hierarchy readable in the table.
  getIndentation(level: number): string {
    return `${8 + level * 18}px`;
  }
}
