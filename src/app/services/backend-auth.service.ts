import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { CuotaUsuarioOrm, SesionBackendOrm } from '../types/b5d-orm';
import { logB5dDebug } from '../utils/debug/b5d-debug';

@Injectable({ providedIn: 'root' })
export class BackendAuthService {
  private readonly apiBaseUrl = environment.backendBaseUrl.replace(/\/+$/, '');
  private readonly requestOptions = { withCredentials: true };

  constructor(private readonly http: HttpClient) {}

  login(username: string, password: string): Observable<SesionBackendOrm> {
    logB5dDebug('backend-auth: login request', {
      username,
    });
    return this.http.post<SesionBackendOrm>(
      this.url('/api/auth/login/'),
      { username, password },
      this.requestOptions,
    );
  }

  logout(): Observable<SesionBackendOrm> {
    logB5dDebug('backend-auth: logout request');
    return this.http.post<SesionBackendOrm>(
      this.url('/api/auth/logout/'),
      {},
      this.requestOptions,
    );
  }

  me(): Observable<SesionBackendOrm> {
    logB5dDebug('backend-auth: me request');
    return this.http.get<SesionBackendOrm>(
      this.url('/api/auth/me/'),
      this.requestOptions,
    );
  }

  quota(): Observable<CuotaUsuarioOrm> {
    logB5dDebug('backend-auth: quota request');
    return this.http.get<CuotaUsuarioOrm>(
      this.url('/api/auth/quota/'),
      this.requestOptions,
    );
  }

  private url(path: string): string {
    return `${this.apiBaseUrl}${path}`;
  }
}
