import { BaseAdapter } from '../base-adapter.js';
import type {
  FrameworkDetectionResult,
  AdapterContext,
  ImportAlias,
  FrameworkType,
} from '../types.js';
import type { Route } from '../../analyzer/types.js';

/**
 * SvelteKit framework adapter
 *
 * Handles SvelteKit's file-based routing system:
 * - Routes in src/routes/
 * - Page files: +page.svelte, +page.ts, +page.server.ts
 * - Layout files: +layout.svelte, +layout.ts, +layout.server.ts
 * - Route groups: (groupName)
 * - Dynamic routes: [param], [...rest]
 */
export class SvelteKitAdapter extends BaseAdapter {
  readonly name: FrameworkType = 'sveltekit';
  readonly displayName = 'SvelteKit';
  readonly pageExtensions = ['.svelte'];

  readonly importAliases: ImportAlias[] = [
    { pattern: '$lib/', replacement: 'src/lib/' },
    { pattern: '$lib', replacement: 'src/lib' },
    { pattern: '$app/', isInternal: true, replacement: '' },
    { pattern: '$app', isInternal: true, replacement: '' },
    { pattern: '$env/', isInternal: true, replacement: '' },
    { pattern: '$env', isInternal: true, replacement: '' },
  ];

  /**
   * Detect if this is a SvelteKit project
   */
  async detect(ctx: AdapterContext): Promise<FrameworkDetectionResult> {
    const checks = {
      hasSvelteConfig: false,
      hasRoutesDir: false,
      hasSvelteKitDep: false,
      version: undefined as string | undefined,
    };

    // Check for svelte.config.js or svelte.config.ts
    checks.hasSvelteConfig =
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'svelte.config.js'))) ||
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'svelte.config.ts')));

    // Check for src/routes directory
    checks.hasRoutesDir = await ctx.fileSource.isDirectory(
      this.joinPaths(ctx.projectRoot, 'src/routes')
    );

    // Check package.json for @sveltejs/kit
    checks.hasSvelteKitDep = await this.hasDependency(ctx, '@sveltejs/kit');
    if (checks.hasSvelteKitDep) {
      checks.version = await this.getDependencyVersion(ctx, '@sveltejs/kit');
    }

    // Determine confidence
    const indicators = [checks.hasSvelteConfig, checks.hasRoutesDir, checks.hasSvelteKitDep];
    const trueCount = indicators.filter(Boolean).length;

    if (trueCount === 3) {
      return {
        framework: 'sveltekit',
        confidence: 'high',
        reason: 'Found svelte.config, src/routes/, and @sveltejs/kit dependency',
        version: checks.version,
      };
    }

    if (trueCount === 2) {
      return {
        framework: 'sveltekit',
        confidence: 'medium',
        reason: `Found ${indicators.filter(Boolean).length} of 3 SvelteKit indicators`,
        version: checks.version,
      };
    }

    if (trueCount === 1) {
      return {
        framework: 'sveltekit',
        confidence: 'low',
        reason: 'Found only one SvelteKit indicator',
        version: checks.version,
      };
    }

    return {
      framework: null,
      confidence: 'none',
      reason: 'Not a SvelteKit project',
    };
  }

  /**
   * Discover all routes in a SvelteKit project
   */
  async discoverRoutes(ctx: AdapterContext): Promise<Route[]> {
    const routesDir = this.joinPaths(ctx.projectRoot, 'src/routes');
    const routes: Route[] = [];

    if (!(await ctx.fileSource.isDirectory(routesDir))) {
      return routes;
    }

    await this.scanDirectory(ctx, routesDir, routesDir, routes);

    return routes.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Recursively scan directory for routes
   */
  private async scanDirectory(
    ctx: AdapterContext,
    dir: string,
    routesRoot: string,
    routes: Route[]
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await ctx.fileSource.readdir(dir);
    } catch {
      return;
    }

    const pageFiles: string[] = [];
    let hasLayout = false;

    for (const entry of entries) {
      const fullPath = this.joinPaths(dir, entry);
      const isDir = await ctx.fileSource.isDirectory(fullPath);

      if (isDir) {
        // Recurse into subdirectories
        await this.scanDirectory(ctx, fullPath, routesRoot, routes);
      } else {
        // Check for route-related files
        if (entry.startsWith('+page')) {
          pageFiles.push(entry);
        } else if (entry.startsWith('+layout')) {
          hasLayout = true;
        }
      }
    }

    // If this directory has page files, it's a route
    if (pageFiles.length > 0) {
      const relativePath = this.getRelativePath(routesRoot, dir);
      const urlPath = this.directoryToUrlPath(relativePath);
      const group = this.extractRouteGroup(relativePath);
      const isAuthProtected = this.isAuthProtectedPath(relativePath);
      const isDynamic = urlPath.includes('[');

      routes.push({
        path: urlPath,
        directory: this.getRelativePath(
          this.joinPaths(ctx.projectRoot),
          dir
        ),
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

  /**
   * Convert a directory path to a URL path
   * Examples:
   * - "" -> "/"
   * - "login" -> "/login"
   * - "(auth)/dashboard" -> "/dashboard"
   * - "blog/[slug]" -> "/blog/[slug]"
   */
  private directoryToUrlPath(relativePath: string): string {
    if (!relativePath || relativePath === '.') {
      return '/';
    }

    // Split by path separator
    const parts = relativePath.split('/');

    // Filter out route groups (directories in parentheses)
    const filteredParts = parts.filter((part) => !part.startsWith('('));

    if (filteredParts.length === 0) {
      return '/';
    }

    return '/' + filteredParts.join('/');
  }

  /**
   * Extract route group name from path
   */
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

  /**
   * Get relative path from base to target
   */
  private getRelativePath(from: string, to: string): string {
    const fromParts = from.split('/').filter(Boolean);
    const toParts = to.split('/').filter(Boolean);

    // Find common prefix length
    let commonLength = 0;
    while (
      commonLength < fromParts.length &&
      commonLength < toParts.length &&
      fromParts[commonLength] === toParts[commonLength]
    ) {
      commonLength++;
    }

    // Build relative path
    const relativeParts = toParts.slice(commonLength);
    return relativeParts.join('/');
  }

  getRoutesDirectory(): string {
    return 'src/routes';
  }

  isRouteFile(filePath: string): boolean {
    const fileName = filePath.split('/').pop() || '';
    return (
      fileName.startsWith('+page') ||
      fileName.startsWith('+error') ||
      fileName.startsWith('+server')
    );
  }

  isLayoutFile(filePath: string): boolean {
    const fileName = filePath.split('/').pop() || '';
    return fileName.startsWith('+layout');
  }

  protected getLoginPagePaths(routesDir: string, pattern: string): string[] {
    const paths: string[] = [];

    // Standard location
    paths.push(`${routesDir}/${pattern}/+page.svelte`);

    // With route groups
    if (!pattern.startsWith('(')) {
      paths.push(`${routesDir}/(auth)/${pattern}/+page.svelte`);
      paths.push(`${routesDir}/(public)/${pattern}/+page.svelte`);
    }

    return paths;
  }

  protected pathToRoute(pathPattern: string): string {
    // Remove route groups for URL
    const parts = pathPattern.split('/').filter((p) => !p.startsWith('('));
    return '/' + parts.join('/');
  }
}

/**
 * Factory function to create a SvelteKit adapter
 */
export function createSvelteKitAdapter(): SvelteKitAdapter {
  return new SvelteKitAdapter();
}
