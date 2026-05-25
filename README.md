# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.11.

## Development server

To start a local development server, run:

```bash
npm run start:local
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Backend API environments

The API base URL is managed in `src/environments`:

- `environment.ts`: local backend (`http://localhost:8000`)
- `environment.server.ts`: server IP placeholder (`http://SERVER_IP:8000`)
- `environment.private-vm.ts`: private VM placeholder (`http://PRIVATE_VM_IP:8000`)

Use the matching scripts:

```bash
npm run start:local
npm run start:server
npm run start:private-vm
```

Build targets:

```bash
npm run build
npm run build:server
npm run build:private-vm
```

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
