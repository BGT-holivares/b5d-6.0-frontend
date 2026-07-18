import { HttpInterceptorFn, HttpXsrfTokenExtractor } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../environments/environment';

function isMutatingMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method.toUpperCase());
}

export const backendCsrfInterceptor: HttpInterceptorFn = (req, next) => {
  const backendBaseUrl = environment.backendBaseUrl.replace(/\/+$/, '');
  const isBackendRequest = req.url.startsWith('/api/') || (backendBaseUrl.length > 0 && req.url.startsWith(backendBaseUrl));

  if (!isMutatingMethod(req.method) || !isBackendRequest) {
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
