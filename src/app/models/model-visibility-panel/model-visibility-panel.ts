import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { ModeloIfcCargado } from '../../types/ifc';

@Component({
  selector: 'app-model-visibility-panel',
  imports: [],
  templateUrl: './model-visibility-panel.html',
  styleUrl: './model-visibility-panel.scss',
})
export class ModelVisibilityPanel {
  @Input() modelos: ModeloIfcCargado[] = [];

  @Output() alternar = new EventEmitter<string>();
}
