import { Component, Inject, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { BackendAuthService } from '../../services/backend-auth.service';
import { logB5dDebug } from '../../utils/debug/b5d-debug';
import { I18nService } from '../../utils/i18n/i18n.service';
import { LOGIN_SCREEN_TRANSLATIONS } from './login-screen.translations';

@Component({
  selector: 'app-login-screen',
  imports: [FormsModule],
  templateUrl: './login-screen.html',
  styleUrl: './login-screen.scss',
})
export class LoginScreen {
  readonly i18n = inject(I18nService);
  readonly loginScreenTranslations = LOGIN_SCREEN_TRANSLATIONS;
  username = '';
  password = '';
  cargando = signal(false);
  mensajeError = signal('');

  constructor(
    private readonly auth: BackendAuthService,
    private readonly router: Router,
    @Inject(PLATFORM_ID) private readonly platformId: object,
  ) {}

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      logB5dDebug('login-screen: checking session on init');
      const sesion = await firstValueFrom(this.auth.me());
      if (sesion.authenticated) {
        logB5dDebug('login-screen: authenticated, replacing history with /viewer');
        await this.replaceWithViewer();
      }
    } catch {
      logB5dDebug('login-screen: session check failed, staying on /login');
      // Ignora errores de sesion y permite iniciar sesion manualmente.
    }
  }

  async iniciarSesion(): Promise<void> {
    this.cargando.set(true);
    this.mensajeError.set('');

    try {
      logB5dDebug('login-screen: submitting login', {
        username: this.username.trim(),
      });
      const respuesta = await firstValueFrom(this.auth.login(this.username.trim(), this.password));
      if (respuesta.authenticated) {
        logB5dDebug('login-screen: login successful, replacing history with /viewer');
        await this.replaceWithViewer();
        return;
      }
      this.mensajeError.set(this.t('loginScreen.error.loginFailed'));
    } catch (error) {
      logB5dDebug('login-screen: login failed', error);
      const mensaje = this.extraerMensajeError(error);
      this.mensajeError.set(mensaje || this.t('loginScreen.error.invalidCredentials'));
    } finally {
      this.cargando.set(false);
    }
  }

  private extraerMensajeError(error: unknown): string {
    if (typeof error !== 'object' || error === null) return '';
    const value = error as { error?: { error?: string } };
    return value.error?.error ?? '';
  }

  private async replaceWithViewer(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    await this.router.navigateByUrl('/viewer', { replaceUrl: true });
  }

  t(key: string): string {
    return this.i18n.translateForComponent(this.loginScreenTranslations, key);
  }
}
