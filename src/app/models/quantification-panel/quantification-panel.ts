import { Component, Input } from '@angular/core';
import type { NodoCuantificacion } from '../../types/quantity-take-off';

@Component({
  selector: 'app-quantification-panel',
  imports: [],
  templateUrl: './quantification-panel.html',
  styleUrl: './quantification-panel.scss',
})
export class QuantificationPanel {
  @Input() datos: NodoCuantificacion | null = null;
}
