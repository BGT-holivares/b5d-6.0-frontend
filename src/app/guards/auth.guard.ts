import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { BackendAuthService } from '../services/backend-auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(BackendAuthService);
  const router = inject(Router);

  return auth.me().pipe(
    map((sesion) => {
      if (sesion.authenticated) return true;
      return router.createUrlTree(['/login']);
    }),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};
