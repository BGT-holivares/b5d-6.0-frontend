import { HttpInterceptorFn, HttpXsrfTokenExtractor } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../environments/environment';

function isMutatingMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method.toUpperCase());
}

export const backendCsrfInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isMutatingMethod(req.method) || !req.url.startsWith(environment.backendBaseUrl)) {
    return next(req);
  }

  const token = inject(HttpXsrfTokenExtractor).getToken();
  if (!token) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: {
        'X-CSRFToken': token,
      },
    }),
  );
};
