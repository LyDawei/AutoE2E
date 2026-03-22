import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AngularAdapter } from '../../../src/frameworks/angular/adapter.js';
import { LocalFileSource } from '../../../src/frameworks/file-source.js';
import type { AdapterContext } from '../../../src/frameworks/types.js';

describe('AngularAdapter', () => {
  let tempDir: string;
  let adapter: AngularAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoe2e-angular-test-'));
    adapter = new AngularAdapter();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createContext(): AdapterContext {
    return {
      fileSource: new LocalFileSource(tempDir),
      projectRoot: '',
    };
  }

  function writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  describe('detect', () => {
    it('returns high confidence with all indicators', async () => {
      writeFile('angular.json', '{}');
      writeFile('src/app/app.component.ts', 'export class AppComponent {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@angular/core': '^17.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('angular');
      expect(result.confidence).toBe('high');
    });

    it('detects .angular.json', async () => {
      writeFile('.angular.json', '{}');
      writeFile('src/app/app.component.ts', 'export class AppComponent {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@angular/core': '^17.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.confidence).toBe('high');
    });

    it('returns medium confidence with 2 indicators', async () => {
      writeFile('angular.json', '{}');
      writeFile('src/app/app.component.ts', 'export class AppComponent {}');
      writeFile('package.json', JSON.stringify({ dependencies: {} }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('angular');
      expect(result.confidence).toBe('medium');
    });

    it('returns low confidence with 1 indicator', async () => {
      writeFile('package.json', JSON.stringify({
        dependencies: { '@angular/core': '^17.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('angular');
      expect(result.confidence).toBe('low');
    });

    it('returns none for non-Angular project', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: {} }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBeNull();
      expect(result.confidence).toBe('none');
    });

    it('extracts version from package.json', async () => {
      writeFile('angular.json', '{}');
      writeFile('src/app/app.component.ts', 'export class AppComponent {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@angular/core': '^17.3.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.version).toBe('^17.3.0');
    });
  });

  describe('discoverRoutes', () => {
    it('discovers routes from app.routes.ts', async () => {
      writeFile('src/app/app.routes.ts', `
        import { Routes } from '@angular/router';
        export const routes: Routes = [
          { path: '', component: HomeComponent },
          { path: 'about', component: AboutComponent },
          { path: 'contact', component: ContactComponent },
        ];
      `);

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/', '/about', '/contact']);
    });

    it('discovers routes from routing module', async () => {
      writeFile('src/app/app-routing.module.ts', `
        const routes: Routes = [
          { path: '', component: HomeComponent },
          { path: 'dashboard', component: DashboardComponent },
        ];
        @NgModule({
          imports: [RouterModule.forRoot(routes)],
        })
        export class AppRoutingModule {}
      `);

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/', '/dashboard']);
    });

    it('handles dynamic routes with :param', async () => {
      writeFile('src/app/app.routes.ts', `
        export const routes: Routes = [
          { path: 'users/:id', component: UserDetailComponent },
        ];
      `);

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].path).toBe('/users/:id');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('skips wildcard routes', async () => {
      writeFile('src/app/app.routes.ts', `
        export const routes: Routes = [
          { path: '', component: HomeComponent },
          { path: '**', component: NotFoundComponent },
        ];
      `);

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/');
    });

    it('discovers routes from feature module routing files', async () => {
      writeFile('src/app/app.routes.ts', `
        export const routes: Routes = [
          { path: '', component: HomeComponent },
        ];
      `);
      writeFile('src/app/admin/admin-routing.module.ts', `
        const routes: Routes = [
          { path: 'admin', component: AdminComponent },
          { path: 'admin/users', component: AdminUsersComponent },
        ];
      `);

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/', '/admin', '/admin/users']);
    });

    it('detects auth-protected routes', async () => {
      writeFile('src/app/app.routes.ts', `
        export const routes: Routes = [
          { path: 'dashboard', component: DashboardComponent },
          { path: 'admin/settings', component: SettingsComponent },
        ];
      `);

      const routes = await adapter.discoverRoutes(createContext());

      const dashboardRoute = routes.find(r => r.path === '/dashboard');
      const adminRoute = routes.find(r => r.path === '/admin/settings');

      expect(dashboardRoute?.isAuthProtected).toBe(true);
      expect(adminRoute?.isAuthProtected).toBe(true);
    });

    it('falls back to component directory scanning', async () => {
      writeFile('src/app/home/home.component.ts', 'export class HomeComponent {}');
      writeFile('src/app/home/home.component.html', '<div>Home</div>');
      writeFile('src/app/about/about.component.ts', 'export class AboutComponent {}');
      writeFile('src/app/about/about.component.html', '<div>About</div>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/about', '/home']);
    });

    it('returns empty array when no src/app directory', async () => {
      writeFile('package.json', '{}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toEqual([]);
    });

    it('deduplicates routes by path', async () => {
      writeFile('src/app/app.routes.ts', `
        export const routes: Routes = [
          { path: 'home', component: HomeComponent },
        ];
      `);
      writeFile('src/app/features/feature.routes.ts', `
        export const routes: Routes = [
          { path: 'home', component: HomeComponent },
        ];
      `);

      const routes = await adapter.discoverRoutes(createContext());

      const homeRoutes = routes.filter(r => r.path === '/home');
      expect(homeRoutes).toHaveLength(1);
    });
  });

  describe('isRouteFile', () => {
    it('returns true for route definition files', () => {
      expect(adapter.isRouteFile('app.routes.ts')).toBe(true);
      expect(adapter.isRouteFile('app-routing.module.ts')).toBe(true);
      expect(adapter.isRouteFile('admin.routes.ts')).toBe(true);
      expect(adapter.isRouteFile('feature-routing.module.ts')).toBe(true);
    });

    it('returns true for component files', () => {
      expect(adapter.isRouteFile('home.component.ts')).toBe(true);
      expect(adapter.isRouteFile('home.component.html')).toBe(true);
    });

    it('returns false for other files', () => {
      expect(adapter.isRouteFile('app.module.ts')).toBe(false);
      expect(adapter.isRouteFile('app.service.ts')).toBe(false);
      expect(adapter.isRouteFile('utils.ts')).toBe(false);
    });
  });

  describe('isLayoutFile', () => {
    it('returns true for app component files', () => {
      expect(adapter.isLayoutFile('src/app/app.component.ts')).toBe(true);
      expect(adapter.isLayoutFile('src/app/app.component.html')).toBe(true);
    });

    it('returns true for layout component files', () => {
      expect(adapter.isLayoutFile('src/app/layout.component.ts')).toBe(true);
      expect(adapter.isLayoutFile('src/app/shell.component.ts')).toBe(true);
    });

    it('returns false for non-layout files', () => {
      expect(adapter.isLayoutFile('src/app/home.component.ts')).toBe(false);
      expect(adapter.isLayoutFile('src/app/app.module.ts')).toBe(false);
    });
  });

  describe('adapter properties', () => {
    it('has correct name', () => {
      expect(adapter.name).toBe('angular');
    });

    it('has correct displayName', () => {
      expect(adapter.displayName).toBe('Angular');
    });

    it('has correct routes directory', () => {
      expect(adapter.getRoutesDirectory()).toBe('src/app');
    });

    it('has correct page extensions', () => {
      expect(adapter.pageExtensions).toContain('.ts');
      expect(adapter.pageExtensions).toContain('.html');
    });

    it('has correct import aliases', () => {
      const aliases = adapter.importAliases;
      expect(aliases.some(a => a.pattern === '@angular/' && a.isInternal)).toBe(true);
      expect(aliases.some(a => a.pattern === '@/')).toBe(true);
    });
  });
});
