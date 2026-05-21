import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-float-file-tab',
  imports: [],
  templateUrl: './float-file-tab.html',
  styleUrl: './float-file-tab.scss',
})
export class FloatFileTab {
  @Output() archivoSeleccionado = new EventEmitter<File>();
  @Output() closePanel = new EventEmitter<void>();
  @Output() toggleLanguage = new EventEmitter<void>();

  // Processes the selected IFC file from the file panel input.
  manejarCambioArchivo(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0];

    if (archivo) this.archivoSeleccionado.emit(archivo);
    entrada.value = '';
  }
}
