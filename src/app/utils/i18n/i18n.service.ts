import { Injectable, signal } from '@angular/core';
import { type B5DLanguage, type ComponentTranslations } from './translations';
import { getSafeLocalStorage } from '../browser-storage';

const LANGUAGE_KEY = 'b5d-language';

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly language = signal<B5DLanguage>(this.getInitialLanguage());

  // Returns a translated value for a key using the provided component dictionary.
  translateForComponent(componentTranslations: ComponentTranslations, key: string): string {
    const actualLanguage = this.language();
    return componentTranslations[actualLanguage][key] ?? componentTranslations['es-MX'][key] ?? key;
  }

  // Changes active language and stores preference in the browser
  changeLanguage(language: B5DLanguage): void {
    this.language.set(language);

    const storage = getSafeLocalStorage();
    if (storage) storage.setItem(LANGUAGE_KEY, language);
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }

  // Alterna entre los idiomas configurados para probar la traducción en pantalla.
  // Manual attention needed: add more language options here.
  toggleLanguage(): void {
    this.changeLanguage(this.language() === 'es-MX' ? 'en-US' : 'es-MX');
  }

  private getInitialLanguage(): B5DLanguage {
    const storage = getSafeLocalStorage();
    if (!storage) return 'es-MX';

    const storedLanguage = storage.getItem(LANGUAGE_KEY);
    if (storedLanguage === 'es-MX' || storedLanguage === 'en-US') {
      if (typeof document !== 'undefined') document.documentElement.lang = storedLanguage;
      return storedLanguage;
    }

    if (typeof document !== 'undefined') document.documentElement.lang = 'es-MX';
    return 'es-MX';
  }
}
