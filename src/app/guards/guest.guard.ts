import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { map, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { BackendAuthService } from '../services/backend-auth.service';
import { logB5dDebug } from '../utils/debug/b5d-debug';

export const guestGuard: CanActivateFn = () => {
  const auth = inject(BackendAuthService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  logB5dDebug('guestGuard: calling /api/auth/me');
  return auth.me().pipe(
    map((sesion) => {
      logB5dDebug('guestGuard: response received', sesion);
      if (sesion.authenticated) {
        logB5dDebug('guestGuard: authenticated, redirecting to /viewer');
        return router.createUrlTree(['/viewer']);
      }
      logB5dDebug('guestGuard: unauthenticated, allowing /login');
      return true;
    }),
    catchError((error) => {
      logB5dDebug('guestGuard: error, allowing /login', error);
      return of(true);
    }),
  );
};
