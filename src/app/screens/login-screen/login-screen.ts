import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { BackendAuthService } from '../../services/backend-auth.service';

@Component({
  selector: 'app-login-screen',
  imports: [FormsModule],
  templateUrl: './login-screen.html',
  styleUrl: './login-screen.scss',
})
export class LoginScreen {
  username = '';
  password = '';
  cargando = signal(false);
  mensajeError = signal('');

  constructor(
    private readonly auth: BackendAuthService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const sesion = await firstValueFrom(this.auth.me());
      if (sesion.authenticated) {
        await this.router.navigate(['/viewer']);
      }
    } catch {
      // Ignora errores de sesion y permite iniciar sesion manualmente.
    }
  }

  async iniciarSesion(): Promise<void> {
    this.cargando.set(true);
    this.mensajeError.set('');

    try {
      const respuesta = await firstValueFrom(this.auth.login(this.username.trim(), this.password));
      if (respuesta.authenticated) {
        await this.router.navigate(['/viewer']);
        return;
      }
      this.mensajeError.set('No se pudo iniciar sesion.');
    } catch (error) {
      const mensaje = this.extraerMensajeError(error);
      this.mensajeError.set(mensaje || 'Credenciales invalidas.');
    } finally {
      this.cargando.set(false);
    }
  }

  private extraerMensajeError(error: unknown): string {
    if (typeof error !== 'object' || error === null) return '';
    const value = error as { error?: { error?: string } };
    return value.error?.error ?? '';
  }
}
