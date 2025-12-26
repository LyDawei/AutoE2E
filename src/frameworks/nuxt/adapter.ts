import { BaseAdapter } from '../base-adapter.js';
import type {
  FrameworkDetectionResult,
  AdapterContext,
  ImportAlias,
  FrameworkType,
} from '../types.js';
import type { Route } from '../../analyzer/types.js';

/**
 * Nuxt framework adapter
 *
 * Handles Nuxt 3's file-based routing:
 * - Routes in pages/
 * - Page files: index.vue, [name].vue
 * - Route groups: (groupName)
 * - Dynamic routes: [param], [[param]], [...slug]
 * - Layouts in layouts/
 */
export class NuxtAdapter extends BaseAdapter {
  readonly name: FrameworkType = 'nuxt';
  readonly displayName = 'Nuxt';
  readonly pageExtensions = ['.vue'];

  readonly importAliases: ImportAlias[] = [
    { pattern: '#imports', isInternal: true, replacement: '' },
    { pattern: '#components/', isInternal: true, replacement: '' },
    { pattern: '#app', isInternal: true, replacement: '' },
    { pattern: '~/', replacement: './' },
    { pattern: '@/', replacement: './' },
  ];

  /**
   * Detect if this is a Nuxt project
   */
  async detect(ctx: AdapterContext): Promise<FrameworkDetectionResult> {
    const checks = {
      hasNuxtConfig: false,
      hasPagesDir: false,
      hasNuxtDep: false,
      version: undefined as string | undefined,
    };

    // Check for nuxt.config.ts/js/mjs
    checks.hasNuxtConfig =
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'nuxt.config.ts'))) ||
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'nuxt.config.js'))) ||
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'nuxt.config.mjs')));

    // Check for pages/ directory
    checks.hasPagesDir = await ctx.fileSource.isDirectory(
      this.joinPaths(ctx.projectRoot, 'pages')
    );

    // Check package.json for nuxt
    checks.hasNuxtDep = await this.hasDependency(ctx, 'nuxt');
    if (checks.hasNuxtDep) {
      checks.version = await this.getDependencyVersion(ctx, 'nuxt');
    }

    // Determine confidence
    const indicators = [checks.hasNuxtConfig, checks.hasPagesDir, checks.hasNuxtDep];
    const trueCount = indicators.filter(Boolean).length;

    if (trueCount === 3) {
      return {
        framework: 'nuxt',
        confidence: 'high',
        reason: 'Found nuxt.config, pages/, and nuxt dependency',
        version: checks.version,
      };
    }

    if (trueCount === 2) {
      return {
        framework: 'nuxt',
        confidence: 'medium',
        reason: `Found ${trueCount} of 3 Nuxt indicators`,
        version: checks.version,
      };
    }

    if (trueCount === 1) {
      return {
        framework: 'nuxt',
        confidence: 'low',
        reason: 'Found only one Nuxt indicator',
        version: checks.version,
      };
    }

    return {
      framework: null,
      confidence: 'none',
      reason: 'Not a Nuxt project',
    };
  }

  /**
   * Discover all routes in a Nuxt project
   */
  async discoverRoutes(ctx: AdapterContext): Promise<Route[]> {
    const pagesDir = this.joinPaths(ctx.projectRoot, 'pages');
    const routes: Route[] = [];

    if (!(await ctx.fileSource.isDirectory(pagesDir))) {
      return routes;
    }

    await this.scanPagesDirectory(ctx, pagesDir, pagesDir, routes);

    return routes.sort((a, b) => a.path.localeCompare(b.path));
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
        // Recurse into subdirectories
        await this.scanPagesDirectory(ctx, fullPath, pagesRoot, routes);
      } else if (entry.endsWith('.vue')) {
        // This is a page file
        const relativePath = this.getRelativePath(pagesRoot, dir);
        const urlPath = this.fileToUrlPath(relativePath, entry);

        const group = this.extractRouteGroup(relativePath);
        const isAuthProtected = this.isAuthProtectedPath(urlPath);
        const isDynamic = urlPath.includes('[') || urlPath.includes(':');

        routes.push({
          path: urlPath,
          directory: this.getRelativePath(ctx.projectRoot, dir),
          hasLayout: await this.hasLayout(ctx, dir, pagesRoot),
          isAuthProtected,
          pageFiles: [entry],
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
  }

  private async hasLayout(ctx: AdapterContext, _pageDir: string, _pagesRoot: string): Promise<boolean> {
    // Check if there's a layout in layouts/ that this page uses
    // For simplicity, check if layouts/ directory exists
    const layoutsDir = this.joinPaths(ctx.projectRoot, 'layouts');
    return ctx.fileSource.isDirectory(layoutsDir);
  }

  /**
   * Convert a file path to URL path
   * Examples:
   * - index.vue -> /
   * - about.vue -> /about
   * - blog/index.vue -> /blog
   * - blog/[slug].vue -> /blog/:slug
   * - [...slug].vue -> /:slug*
   * - [[id]].vue -> /:id? (optional)
   */
  private fileToUrlPath(dirPath: string, fileName: string): string {
    // Remove .vue extension
    let baseName = fileName.replace(/\.vue$/, '');

    let parts: string[] = [];

    // Add directory parts (filter out route groups)
    if (dirPath && dirPath !== '.') {
      parts = dirPath.split('/').filter((p) => !p.startsWith('('));
    }

    // Add file name (unless it's index)
    if (baseName !== 'index') {
      parts.push(baseName);
    }

    if (parts.length === 0) {
      return '/';
    }

    // Convert dynamic segments
    const urlParts = parts.map((part) => {
      // Catch-all: [...slug] -> :slug*
      if (part.startsWith('[...') && part.endsWith(']')) {
        const param = part.slice(4, -1);
        return `:${param}*`;
      }
      // Optional: [[id]] -> :id?
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const param = part.slice(2, -2);
        return `:${param}?`;
      }
      // Dynamic: [id] -> :id
      if (part.startsWith('[') && part.endsWith(']')) {
        const param = part.slice(1, -1);
        return `:${param}`;
      }
      return part;
    });

    return '/' + urlParts.join('/');
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

    return toParts.slice(commonLength).join('/');
  }

  getRoutesDirectory(): string {
    return 'pages';
  }

  isRouteFile(filePath: string): boolean {
    return filePath.endsWith('.vue') && filePath.includes('/pages/');
  }

  isLayoutFile(filePath: string): boolean {
    return filePath.includes('/layouts/') && filePath.endsWith('.vue');
  }

  protected getLoginPagePaths(_routesDir: string, pattern: string): string[] {
    const paths: string[] = [];

    paths.push(`pages/${pattern}.vue`);
    paths.push(`pages/${pattern}/index.vue`);
    paths.push(`pages/(auth)/${pattern}.vue`);
    paths.push(`pages/(public)/${pattern}.vue`);

    return paths;
  }

  protected pathToRoute(pathPattern: string): string {
    const parts = pathPattern.split('/').filter((p) => !p.startsWith('('));
    return '/' + parts.join('/');
  }
}

/**
 * Factory function to create a Nuxt adapter
 */
export function createNuxtAdapter(): NuxtAdapter {
  return new NuxtAdapter();
}
