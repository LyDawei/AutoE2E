import { BaseAdapter } from '../base-adapter.js';
import type {
  FrameworkDetectionResult,
  AdapterContext,
  ImportAlias,
  FrameworkType,
} from '../types.js';
import type { Route } from '../../analyzer/types.js';

/**
 * Router type for Next.js
 */
export type NextJsRouterType = 'app' | 'pages' | 'hybrid';

/**
 * Next.js framework adapter
 *
 * Handles both App Router and Pages Router:
 *
 * App Router (app/):
 * - Page files: page.tsx, page.ts, page.jsx, page.js
 * - Layout files: layout.tsx
 * - Route groups: (groupName)
 * - Dynamic routes: [param], [...slug], [[...slug]]
 *
 * Pages Router (pages/):
 * - Page files: index.tsx, [name].tsx
 * - Dynamic routes: [param], [...slug]
 * - No route groups support
 */
export class NextJsAdapter extends BaseAdapter {
  readonly name: FrameworkType;
  readonly displayName: string;
  readonly pageExtensions = ['.tsx', '.ts', '.jsx', '.js'];

  readonly importAliases: ImportAlias[] = [
    { pattern: '@/', replacement: 'src/' },
    { pattern: '~/', replacement: 'src/' },
    { pattern: 'next/', isInternal: true, replacement: '' },
  ];

  private routerType: NextJsRouterType;

  constructor(routerType: NextJsRouterType = 'hybrid') {
    super();
    this.routerType = routerType;

    // Set name and displayName based on router type
    if (routerType === 'app') {
      this.name = 'nextjs-app';
      this.displayName = 'Next.js (App Router)';
    } else if (routerType === 'pages') {
      this.name = 'nextjs-pages';
      this.displayName = 'Next.js (Pages Router)';
    } else {
      this.name = 'nextjs';
      this.displayName = 'Next.js';
    }
  }

  /**
   * Detect if this is a Next.js project
   */
  async detect(ctx: AdapterContext): Promise<FrameworkDetectionResult> {
    const checks = {
      hasNextConfig: false,
      hasAppDir: false,
      hasPagesDir: false,
      hasNextDep: false,
      version: undefined as string | undefined,
    };

    // Check for next.config.js/mjs/cjs/ts
    checks.hasNextConfig =
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'next.config.js'))) ||
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'next.config.mjs'))) ||
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'next.config.cjs'))) ||
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'next.config.ts')));

    // Check for app/ directory (App Router)
    checks.hasAppDir = await ctx.fileSource.isDirectory(
      this.joinPaths(ctx.projectRoot, 'app')
    );

    // Check for pages/ directory (Pages Router)
    checks.hasPagesDir = await ctx.fileSource.isDirectory(
      this.joinPaths(ctx.projectRoot, 'pages')
    );

    // Check package.json for next
    checks.hasNextDep = await this.hasDependency(ctx, 'next');
    if (checks.hasNextDep) {
      checks.version = await this.getDependencyVersion(ctx, 'next');
    }

    // Determine router type
    let routerType: NextJsRouterType | undefined;
    if (checks.hasAppDir && checks.hasPagesDir) {
      routerType = 'hybrid';
    } else if (checks.hasAppDir) {
      routerType = 'app';
    } else if (checks.hasPagesDir) {
      routerType = 'pages';
    }

    // Determine confidence
    const hasRouter = checks.hasAppDir || checks.hasPagesDir;
    const indicators = [checks.hasNextConfig, hasRouter, checks.hasNextDep];
    const trueCount = indicators.filter(Boolean).length;

    if (trueCount === 3) {
      return {
        framework: this.getFrameworkName(routerType),
        confidence: 'high',
        reason: `Found next.config, ${routerType} router, and next dependency`,
        routerType,
        version: checks.version,
      };
    }

    if (trueCount === 2) {
      return {
        framework: this.getFrameworkName(routerType),
        confidence: 'medium',
        reason: `Found ${trueCount} of 3 Next.js indicators`,
        routerType,
        version: checks.version,
      };
    }

    if (trueCount === 1) {
      return {
        framework: this.getFrameworkName(routerType),
        confidence: 'low',
        reason: 'Found only one Next.js indicator',
        routerType,
        version: checks.version,
      };
    }

    return {
      framework: null,
      confidence: 'none',
      reason: 'Not a Next.js project',
    };
  }

  private getFrameworkName(routerType?: NextJsRouterType): FrameworkType | null {
    if (!routerType) return null;
    if (routerType === 'hybrid') return 'nextjs';
    return routerType === 'app' ? 'nextjs-app' : 'nextjs-pages';
  }

  /**
   * Discover all routes in a Next.js project
   */
  async discoverRoutes(ctx: AdapterContext): Promise<Route[]> {
    const routes: Route[] = [];

    // Discover from both routers if hybrid
    if (this.routerType === 'app' || this.routerType === 'hybrid') {
      const appRoutes = await this.discoverAppRoutes(ctx);
      routes.push(...appRoutes);
    }

    if (this.routerType === 'pages' || this.routerType === 'hybrid') {
      const pagesRoutes = await this.discoverPagesRoutes(ctx);

      // For hybrid, only add pages routes that don't conflict with app routes
      if (this.routerType === 'hybrid') {
        const appPaths = new Set(routes.map(r => r.path));
        for (const route of pagesRoutes) {
          if (!appPaths.has(route.path)) {
            routes.push(route);
          }
        }
      } else {
        routes.push(...pagesRoutes);
      }
    }

    return routes.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Discover routes from App Router (app/)
   */
  private async discoverAppRoutes(ctx: AdapterContext): Promise<Route[]> {
    const appDir = this.joinPaths(ctx.projectRoot, 'app');
    const routes: Route[] = [];

    if (!(await ctx.fileSource.isDirectory(appDir))) {
      return routes;
    }

    await this.scanAppDirectory(ctx, appDir, appDir, routes);
    return routes;
  }

  private async scanAppDirectory(
    ctx: AdapterContext,
    dir: string,
    appRoot: string,
    routes: Route[]
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await ctx.fileSource.readdir(dir);
    } catch {
      return;
    }

    let hasPage = false;
    let hasLayout = false;
    const pageFiles: string[] = [];

    for (const entry of entries) {
      const fullPath = this.joinPaths(dir, entry);
      const isDir = await ctx.fileSource.isDirectory(fullPath);

      if (isDir) {
        // Skip api routes and private folders
        if (entry === 'api' || entry.startsWith('_')) {
          continue;
        }
        await this.scanAppDirectory(ctx, fullPath, appRoot, routes);
      } else {
        // Check for page files
        if (this.isAppPageFile(entry)) {
          hasPage = true;
          pageFiles.push(entry);
        } else if (this.isAppLayoutFile(entry)) {
          hasLayout = true;
        }
      }
    }

    if (hasPage) {
      const relativePath = this.getRelativePath(appRoot, dir);
      const urlPath = this.appDirectoryToUrlPath(relativePath);
      const group = this.extractRouteGroup(relativePath);
      const isAuthProtected = this.isAuthProtectedPath(relativePath);
      const isDynamic = urlPath.includes('[');

      routes.push({
        path: urlPath,
        directory: this.getRelativePath(ctx.projectRoot, dir),
        hasLayout,
        isAuthProtected,
        pageFiles,
        isDynamic,
        group,
        serverFiles: [],
        actions: [],
        apiMethods: [],
        hasFormHandler: false,
        hasApiEndpoint: false,
      });
    }
  }

  private isAppPageFile(fileName: string): boolean {
    return /^page\.(tsx?|jsx?|mdx?)$/.test(fileName);
  }

  private isAppLayoutFile(fileName: string): boolean {
    return /^layout\.(tsx?|jsx?)$/.test(fileName);
  }

  private appDirectoryToUrlPath(relativePath: string): string {
    if (!relativePath || relativePath === '.') {
      return '/';
    }

    const parts = relativePath.split('/');

    // Filter out route groups and handle special segments
    const filteredParts = parts
      .filter((part) => !part.startsWith('('))
      .filter((part) => !part.startsWith('@')); // Filter out parallel routes

    if (filteredParts.length === 0) {
      return '/';
    }

    return '/' + filteredParts.join('/');
  }

  /**
   * Discover routes from Pages Router (pages/)
   */
  private async discoverPagesRoutes(ctx: AdapterContext): Promise<Route[]> {
    const pagesDir = this.joinPaths(ctx.projectRoot, 'pages');
    const routes: Route[] = [];

    if (!(await ctx.fileSource.isDirectory(pagesDir))) {
      return routes;
    }

    await this.scanPagesDirectory(ctx, pagesDir, pagesDir, routes);
    return routes;
  }

  private async scanPagesDirectory(
    ctx: AdapterContext,
    dir: string,
    pagesRoot: string,
    routes: Route[]
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
        // Skip api routes
        if (entry === 'api') {
          continue;
        }
        await this.scanPagesDirectory(ctx, fullPath, pagesRoot, routes);
      } else {
        // Check if this is a page file
        if (this.isPagesPageFile(entry)) {
          const relativePath = this.getRelativePath(pagesRoot, dir);
          const urlPath = this.pagesFileToUrlPath(relativePath, entry);

          // Skip _app, _document, _error
          if (entry.startsWith('_')) {
            continue;
          }

          const isAuthProtected = this.isAuthProtectedPath(urlPath);
          const isDynamic = urlPath.includes('[');

          routes.push({
            path: urlPath,
            directory: this.getRelativePath(ctx.projectRoot, dir),
            hasLayout: false, // Pages router doesn't have layout files per route
            isAuthProtected,
            pageFiles: [entry],
            isDynamic,
            serverFiles: [],
            actions: [],
            apiMethods: [],
            hasFormHandler: false,
            hasApiEndpoint: false,
          });
        }
      }
    }
  }

  private isPagesPageFile(fileName: string): boolean {
    // Match .tsx, .ts, .jsx, .js files but not _app, _document, etc.
    return /\.(tsx?|jsx?)$/.test(fileName) && !fileName.endsWith('.d.ts');
  }

  private pagesFileToUrlPath(dirPath: string, fileName: string): string {
    // Remove extension
    let baseName = fileName.replace(/\.(tsx?|jsx?)$/, '');

    // index.tsx in root -> /
    // index.tsx in subdir -> /subdir
    // about.tsx in root -> /about
    // [id].tsx -> /[id]

    let parts: string[] = [];

    if (dirPath && dirPath !== '.') {
      parts = dirPath.split('/');
    }

    if (baseName !== 'index') {
      parts.push(baseName);
    }

    if (parts.length === 0) {
      return '/';
    }

    return '/' + parts.join('/');
  }

  private extractRouteGroup(relativePath: string): string | undefined {
    const parts = relativePath.split('/');
    for (const part of parts) {
      const match = part.match(/^\((.+)\)$/);
      if (match) {
        return match[1];
      }
    }
    return undefined;
  }

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

    const relativeParts = toParts.slice(commonLength);
    return relativeParts.join('/');
  }

  getRoutesDirectory(): string {
    if (this.routerType === 'pages') {
      return 'pages';
    }
    return 'app';
  }

  isRouteFile(filePath: string): boolean {
    const fileName = filePath.split('/').pop() || '';

    // App Router
    if (/^page\.(tsx?|jsx?)$/.test(fileName)) {
      return true;
    }

    // Pages Router - any .tsx/.jsx file in pages/
    if (filePath.includes('/pages/') && /\.(tsx?|jsx?)$/.test(fileName)) {
      return !fileName.startsWith('_');
    }

    return false;
  }

  isLayoutFile(filePath: string): boolean {
    const fileName = filePath.split('/').pop() || '';

    // App Router layout
    if (/^layout\.(tsx?|jsx?)$/.test(fileName)) {
      return true;
    }

    // Pages Router _app
    if (fileName === '_app.tsx' || fileName === '_app.jsx') {
      return true;
    }

    return false;
  }

  protected getLoginPagePaths(_routesDir: string, pattern: string): string[] {
    const paths: string[] = [];

    if (this.routerType === 'pages' || this.routerType === 'hybrid') {
      // Pages Router
      paths.push(`pages/${pattern}.tsx`);
      paths.push(`pages/${pattern}/index.tsx`);
    }

    if (this.routerType === 'app' || this.routerType === 'hybrid') {
      // App Router
      paths.push(`app/${pattern}/page.tsx`);
      paths.push(`app/(auth)/${pattern}/page.tsx`);
      paths.push(`app/(public)/${pattern}/page.tsx`);
    }

    return paths;
  }

  protected pathToRoute(pathPattern: string): string {
    const parts = pathPattern.split('/').filter((p) => !p.startsWith('('));
    return '/' + parts.join('/');
  }
}

/**
 * Factory function to create a Next.js adapter
 */
export function createNextJsAdapter(routerType: NextJsRouterType = 'hybrid'): NextJsAdapter {
  return new NextJsAdapter(routerType);
}
