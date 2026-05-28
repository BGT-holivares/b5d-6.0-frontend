import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { I18nService } from '../../utils/i18n/i18n.service';
import type { ProyectoTrabajoOrm, UsuarioSesionOrm } from '../../types/b5d-orm';
import { FLOAT_FILE_TAB_TRANSLATIONS } from './float-file-tab.translations';

@Component({
  selector: 'app-float-file-tab',
  imports: [],
  templateUrl: './float-file-tab.html',
  styleUrl: './float-file-tab.scss',
})
export class FloatFileTab {
  @Input() usuarioSesion: UsuarioSesionOrm | null = null;
  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Output() archivoSeleccionado = new EventEmitter<File>();
  @Output() abrirB5dSolicitado = new EventEmitter<void>();
  @Output() guardarB5dSolicitado = new EventEmitter<void>();
  @Output() loginSolicitado = new EventEmitter<void>();
  @Output() logoutSolicitado = new EventEmitter<void>();
  @Output() closePanel = new EventEmitter<void>();
  @Output() toggleLanguage = new EventEmitter<void>();

  readonly i18n = inject(I18nService);
  readonly floatFileTabTranslations = FLOAT_FILE_TAB_TRANSLATIONS;

  // Processes the selected IFC file from the file panel input.
  manejarCambioArchivo(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0];

    if (archivo) this.archivoSeleccionado.emit(archivo);
    entrada.value = '';
  }
}
