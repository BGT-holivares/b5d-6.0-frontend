import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { ProyectoTrabajoOrm, UsuarioSesionOrm } from '../../types/b5d-orm';

@Component({
  selector: 'app-float-file-tab',
  imports: [],
  templateUrl: './float-file-tab.html',
  styleUrl: './float-file-tab.scss',
})
export class FloatFileTab {
  @Input() usuarioSesion: UsuarioSesionOrm | null = null;
  @Input() proyectoActivo: ProyectoTrabajoOrm | null = null;
  @Output() archivoSeleccionado = new EventEmitter<File>();
  @Output() abrirB5dSolicitado = new EventEmitter<void>();
  @Output() loginSolicitado = new EventEmitter<void>();
  @Output() logoutSolicitado = new EventEmitter<void>();
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
