import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { installB5dLifecycleDiagnostics } from './app/utils/debug/b5d-debug';

installB5dLifecycleDiagnostics();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
