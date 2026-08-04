import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'viewer',
  },
  {
    path: 'login',
    loadComponent: () => import('./screens/login-screen/login-screen').then((m) => m.LoginScreen),
    canActivate: [guestGuard],
  },
  {
    path: 'viewer',
    loadComponent: () => import('./screens/viewer-screen/viewer-screen').then((m) => m.ViewerScreen),
    canActivate: [authGuard],
  },
  {
    path: '**',
    redirectTo: 'viewer',
  },
];
