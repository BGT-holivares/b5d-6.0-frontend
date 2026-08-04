import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
})
export class ConfirmDialog {
  @Input() visible = false;
  @Input() title = '';
  @Input() message = '';
  @Input() confirmLabel = 'Eliminar';
  @Input() cancelLabel = 'Cancelar';
  @Input() confirmDisabled = false;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
}
