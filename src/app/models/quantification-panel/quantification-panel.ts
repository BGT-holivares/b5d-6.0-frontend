import { Component, Input } from '@angular/core';
import { ResizableTableDirective } from '../../directives/resizable-table/resizable-table.directive';
import type { NodoCuantificacion } from '../../types/quantity-take-off';

@Component({
  selector: 'app-quantification-panel',
  imports: [ResizableTableDirective],
  templateUrl: './quantification-panel.html',
  styleUrl: './quantification-panel.scss',
})
export class QuantificationPanel {
  @Input() datos: NodoCuantificacion | null = null;
}
