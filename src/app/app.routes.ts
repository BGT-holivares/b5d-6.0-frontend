import { Routes } from '@angular/router';
import { ViewerScreen } from './screens/viewer-screen/viewer-screen';
import { LoginScreen } from './screens/login-screen/login-screen';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'viewer',
  },
  {
    path: 'login',
    component: LoginScreen,
  },
  {
    path: 'viewer',
    component: ViewerScreen,
    canActivate: [authGuard],
  },
  {
    path: '**',
    redirectTo: 'viewer',
  },
];
