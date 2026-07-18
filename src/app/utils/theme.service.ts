import { Injectable, signal } from '@angular/core';
import { getSafeLocalStorage } from './browser-storage';

type TemaB5D = 'light' | 'dark';

const LLAVE_TEMA = 'b5d-tema';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly tema = signal<TemaB5D>(this.obtenerTemaInicial());

  constructor() {
    this.aplicarTema(this.tema());
  }

  get modoOscuroActivo(): boolean {
    return this.tema() === 'dark';
  }

  // Alterna el tema visual y guarda la selección del usuario.
  alternarTema(): void {
    const siguienteTema: TemaB5D = this.tema() === 'dark' ? 'light' : 'dark';
    this.tema.set(siguienteTema);

    const storage = getSafeLocalStorage();
    if (storage) storage.setItem(LLAVE_TEMA, siguienteTema);
    this.aplicarTema(siguienteTema);
  }

  private obtenerTemaInicial(): TemaB5D {
    const storage = getSafeLocalStorage();
    if (!storage) return 'light';

    const temaGuardado = storage.getItem(LLAVE_TEMA);
    return temaGuardado === 'dark' ? 'dark' : 'light';
  }

  private aplicarTema(tema: TemaB5D): void {
    if (typeof document === 'undefined') return;

    document.documentElement.setAttribute('data-b5d-theme', tema);
  }
}
