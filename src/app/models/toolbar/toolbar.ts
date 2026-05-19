import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../utils/i18n/i18n.service';
import { ThemeService } from '../../utils/theme.service';
import type { FloatingPanelId } from '../../types/floating-panel';

type PestanaToolbar = 'home' | 'objects' | 'measurement' | 'tools' | 'view' | 'about';

@Component({
  selector: 'app-toolbar',
  imports: [CommonModule],
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.scss',
})
export class Toolbar {
  fileTabVisible = false;
  activeTab: PestanaToolbar = 'home';
  readonly floatingPanelOptions: { id: FloatingPanelId; icon: string; label: string }[] = [
    { id: 'tree', icon: 'T', label: 'Tree' },
    { id: 'quantification', icon: 'Q', label: 'Quantification' },
    { id: 'linking', icon: 'L', label: 'Linking' },
    { id: 'models', icon: 'M', label: 'Models' },
    { id: 'properties', icon: 'P', label: 'Properties' },
  ];

  readonly i18n = inject(I18nService);
  readonly temaVisual = inject(ThemeService);

  @Input() cargando = false;
  @Input() floatingPanelVisibility: Record<FloatingPanelId, boolean> = {
    tree: true,
    quantification: true,
    linking: true,
    models: true,
    properties: true,
  };

  @Output() archivoSeleccionado = new EventEmitter<File>();
  @Output() acercar = new EventEmitter<void>();
  @Output() alejar = new EventEmitter<void>();
  @Output() desplazarIzquierda = new EventEmitter<void>();
  @Output() desplazarDerecha = new EventEmitter<void>();
  @Output() desplazarArriba = new EventEmitter<void>();
  @Output() desplazarAbajo = new EventEmitter<void>();
  @Output() rotarIzquierda = new EventEmitter<void>();
  @Output() rotarDerecha = new EventEmitter<void>();
  @Output() restablecer = new EventEmitter<void>();
  @Output() limpiarSeleccion = new EventEmitter<void>();
  @Output() expandirArbol = new EventEmitter<void>();
  @Output() colapsarArbol = new EventEmitter<void>();
  @Output() cuantificarB5D = new EventEmitter<void>();
  @Output() toggleFloatingPanel = new EventEmitter<FloatingPanelId>();

  // Procesa el archivo seleccionado desde el input del visor.
  manejarCambioArchivo(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0];

    if (archivo) this.archivoSeleccionado.emit(archivo);
    entrada.value = '';
  }

  // Muestra u oculta las acciones del menú Archivo.
  toggleFileTab(): void {
    this.fileTabVisible = !this.fileTabVisible;
  }

  // Cambia la pestaña activa de la barra tipo ribbon.
  updateTab(pestana: PestanaToolbar): void {
    this.activeTab = pestana;
    this.fileTabVisible = false;
  }

  // Devuelve una traducción corta para usarla desde el template.
  translate(llave: string): string {
    return this.i18n.translate(llave);
  }

  // Returns the active visibility state for a floating panel option.
  isFloatingPanelVisible(panelId: FloatingPanelId): boolean {
    return this.floatingPanelVisibility[panelId];
  }
}
