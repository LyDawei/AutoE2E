import { BaseAdapter } from '../base-adapter.js';
import type {
  FrameworkDetectionResult,
  AdapterContext,
  ImportAlias,
  FrameworkType,
} from '../types.js';
import type { Route } from '../../analyzer/types.js';

/**
 * Angular framework adapter
 *
 * Handles Angular's routing system:
 * - Components in src/app/
 * - Route definitions in routing modules or route configs
 * - Standalone components with route configs (Angular 14+)
 * - Dynamic routes: :param
 * - Lazy-loaded routes via loadChildren/loadComponent
 * - Layout detection via router-outlet nesting
 */
export class AngularAdapter extends BaseAdapter {
  readonly name: FrameworkType = 'angular';
  readonly displayName = 'Angular';
  readonly pageExtensions = ['.ts', '.html'];

  readonly importAliases: ImportAlias[] = [
    { pattern: '@angular/', isInternal: true, replacement: '' },
    { pattern: '@/', replacement: 'src/' },
    { pattern: '~/', replacement: 'src/' },
  ];

  /**
   * Route file patterns that typically contain Angular route definitions
   */
  private readonly routeFilePatterns = [
    /\.routes\.ts$/,
    /-routing\.module\.ts$/,
  ];

  /**
   * Detect if this is an Angular project
   */
  async detect(ctx: AdapterContext): Promise<FrameworkDetectionResult> {
    const checks = {
      hasAngularJson: false,
      hasSrcApp: false,
      hasAngularDep: false,
      version: undefined as string | undefined,
    };

    // Run independent checks in parallel
    const [hasAngularJson, hasDotAngularJson, hasSrcApp, hasAngularDep] = await Promise.all([
      ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'angular.json')),
      ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, '.angular.json')),
      ctx.fileSource.isDirectory(this.joinPaths(ctx.projectRoot, 'src/app')),
      this.hasDependency(ctx, '@angular/core'),
    ]);

    checks.hasAngularJson = hasAngularJson || hasDotAngularJson;
    checks.hasSrcApp = hasSrcApp;
    checks.hasAngularDep = hasAngularDep;
    if (checks.hasAngularDep) {
      checks.version = await this.getDependencyVersion(ctx, '@angular/core');
    }

    // Determine confidence
    const indicators = [checks.hasAngularJson, checks.hasSrcApp, checks.hasAngularDep];
    const trueCount = indicators.filter(Boolean).length;

    if (trueCount === 3) {
      return {
        framework: 'angular',
        confidence: 'high',
        reason: 'Found angular.json, src/app/, and @angular/core dependency',
        version: checks.version,
      };
    }

    if (trueCount === 2) {
      return {
        framework: 'angular',
        confidence: 'medium',
        reason: `Found ${trueCount} of 3 Angular indicators`,
        version: checks.version,
      };
    }

    if (trueCount === 1) {
      return {
        framework: 'angular',
        confidence: 'low',
        reason: 'Found only one Angular indicator',
        version: checks.version,
      };
    }

    return {
      framework: null,
      confidence: 'none',
      reason: 'Not an Angular project',
    };
  }

  /**
   * Discover all routes in an Angular project
   *
   * Angular routes are defined in TypeScript files rather than via file-system conventions.
   * This adapter scans for route definition files and parses route configs from them.
   */
  async discoverRoutes(ctx: AdapterContext): Promise<Route[]> {
    const appDir = this.joinPaths(ctx.projectRoot, 'src/app');
    const routes: Route[] = [];

    if (!(await ctx.fileSource.isDirectory(appDir))) {
      return routes;
    }

    // Find all route definition files
    const routeFiles = await this.findRouteFiles(ctx, appDir);

    // Parse routes from all files in parallel
    const fileRoutesArray = await Promise.all(
      routeFiles.map((routeFile) => this.parseRoutesFromFile(ctx, routeFile))
    );
    routes.push(...fileRoutesArray.flat());

    // Also scan for component directories that follow Angular conventions
    // (feature modules with their own components)
    if (routes.length === 0) {
      await this.scanComponentDirectories(ctx, appDir, appDir, routes);
    }

    // Deduplicate by path
    const seen = new Set<string>();
    const deduplicated = routes.filter((route) => {
      if (seen.has(route.path)) return false;
      seen.add(route.path);
      return true;
    });

    return deduplicated.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Find all files that contain route definitions
   */
  private async findRouteFiles(ctx: AdapterContext, dir: string): Promise<string[]> {
    const routeFiles: string[] = [];
    await this.findRouteFilesRecursive(ctx, dir, routeFiles);
    return routeFiles;
  }

  /**
   * Recursively find route definition files
   */
  private async findRouteFilesRecursive(
    ctx: AdapterContext,
    dir: string,
    routeFiles: string[]
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await ctx.fileSource.readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = this.joinPaths(dir, entry);
      const isDir = await ctx.fileSource.isDirectory(fullPath);

      if (isDir) {
        // Skip node_modules and hidden directories
        if (!entry.startsWith('.') && entry !== 'node_modules') {
          await this.findRouteFilesRecursive(ctx, fullPath, routeFiles);
        }
      } else if (this.routeFilePatterns.some((pattern) => pattern.test(entry))) {
        routeFiles.push(fullPath);
      }
    }
  }

  /**
   * Parse route definitions from a TypeScript file
   *
   * Handles both:
   * - Modern standalone route configs: export const routes: Routes = [{ path: '...', component: ... }]
   * - Legacy routing modules: RouterModule.forRoot([{ path: '...', component: ... }])
   */
  private async parseRoutesFromFile(
    ctx: AdapterContext,
    filePath: string
  ): Promise<Route[]> {
    const routes: Route[] = [];

    let content: string;
    try {
      content = await ctx.fileSource.read(filePath);
    } catch {
      return routes;
    }

    // Compute file-level properties once
    const hasLayout = this.hasRouterOutlet(content);
    const hasFormHandler = this.hasFormHandlerInContent(content);
    const fileDir = this.getDirectoryFromPath(filePath);
    const relativeDir = this.getRelativePath(
      this.joinPaths(ctx.projectRoot),
      fileDir
    );
    const fileName = filePath.split('/').pop() || '';
    const group = this.extractFeatureModule(relativeDir);

    const routePattern = /\{\s*path:\s*['"`]([^'"`]*)['"`]/g;
    let match;

    while ((match = routePattern.exec(content)) !== null) {
      const routePath = match[1];

      if (routePath === '**') continue;

      const urlPath = routePath === '' ? '/' : '/' + routePath;

      routes.push({
        path: urlPath,
        directory: relativeDir,
        hasLayout,
        isAuthProtected: this.isAuthProtectedPath(urlPath),
        pageFiles: [fileName],
        isDynamic: urlPath.includes(':'),
        group,
        serverFiles: [],
        actions: [],
        apiMethods: [],
        hasFormHandler,
        hasApiEndpoint: false,
      });
    }

    return routes;
  }

  private hasRouterOutlet(content: string): boolean {
    return content.includes('router-outlet') || content.includes('RouterOutlet');
  }

  private hasFormHandlerInContent(content: string): boolean {
    return (
      content.includes('FormGroup') ||
      content.includes('FormBuilder') ||
      content.includes('ngModel') ||
      content.includes('ReactiveFormsModule') ||
      content.includes('FormsModule')
    );
  }

  /**
   * Extract feature module name from directory path
   */
  private extractFeatureModule(dirPath: string): string | undefined {
    const parts = dirPath.split('/');
    // Look for feature module directories (e.g., src/app/admin, src/app/auth)
    const appIndex = parts.indexOf('app');
    if (appIndex >= 0 && appIndex < parts.length - 1) {
      return parts[appIndex + 1];
    }
    return undefined;
  }

  /**
   * Scan component directories for routes when no route files are found
   * Falls back to directory structure analysis
   */
  private async scanComponentDirectories(
    ctx: AdapterContext,
    dir: string,
    appDir: string,
    routes: Route[]
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await ctx.fileSource.readdir(dir);
    } catch {
      return;
    }

    const hasComponent = entries.some(
      (e) => e.endsWith('.component.ts') || e.endsWith('.component.html')
    );

    if (hasComponent) {
      const relativePath = this.getRelativePath(appDir, dir);
      // Skip the root app component
      if (relativePath && relativePath !== 'app') {
        const urlPath = '/' + relativePath.replace(/\\/g, '/');
        const isAuthProtected = this.isAuthProtectedPath(urlPath);
        const isDynamic = urlPath.includes(':');

        routes.push({
          path: urlPath,
          directory: this.getRelativePath(
            this.joinPaths(ctx.projectRoot),
            dir
          ),
          hasLayout: false,
          isAuthProtected,
          pageFiles: entries.filter(
            (e) => e.endsWith('.component.ts') || e.endsWith('.component.html')
          ),
          isDynamic,
          group: this.extractFeatureModule(relativePath),
          serverFiles: [],
          actions: [],
          apiMethods: [],
          hasFormHandler: false,
          hasApiEndpoint: false,
        });
      }
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const fullPath = this.joinPaths(dir, entry);
      const isDir = await ctx.fileSource.isDirectory(fullPath);
      if (isDir) {
        await this.scanComponentDirectories(ctx, fullPath, appDir, routes);
      }
    }
  }

  /**
   * Get relative path from base to target
   */
  private getRelativePath(from: string, to: string): string {
    const fromParts = from.split('/').filter(Boolean);
    const toParts = to.split('/').filter(Boolean);

    let commonLength = 0;
    while (
      commonLength < fromParts.length &&
      commonLength < toParts.length &&
      fromParts[commonLength] === toParts[commonLength]
    ) {
      commonLength++;
    }

    return toParts.slice(commonLength).join('/');
  }

  getRoutesDirectory(): string {
    return 'src/app';
  }

  isRouteFile(filePath: string): boolean {
    return (
      this.routeFilePatterns.some((pattern) => pattern.test(filePath)) ||
      filePath.endsWith('.component.ts') ||
      filePath.endsWith('.component.html')
    );
  }

  isLayoutFile(filePath: string): boolean {
    const fileName = filePath.split('/').pop() || '';
    return (
      fileName === 'app.component.ts' ||
      fileName === 'app.component.html' ||
      fileName.includes('layout.component') ||
      fileName.includes('shell.component')
    );
  }

  protected getLoginPagePaths(_routesDir: string, pattern: string): string[] {
    const paths: string[] = [];
    const baseName = pattern.replace(/\//g, '-');

    // Standard Angular component locations
    paths.push(`src/app/${pattern}/${baseName}.component.ts`);
    paths.push(`src/app/${pattern}/${baseName}.component.html`);
    paths.push(`src/app/auth/${pattern}/${baseName}.component.ts`);
    paths.push(`src/app/auth/${pattern}/${baseName}.component.html`);

    // Standalone component with inline template
    paths.push(`src/app/${pattern}.component.ts`);
    paths.push(`src/app/auth/${pattern}.component.ts`);

    return paths;
  }

  protected pathToRoute(pathPattern: string): string {
    return '/' + pathPattern;
  }
}

/**
 * Factory function to create an Angular adapter
 */
export function createAngularAdapter(): AngularAdapter {
  return new AngularAdapter();
}
