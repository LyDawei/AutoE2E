import { BaseAdapter } from '../base-adapter.js';
import type {
  FrameworkDetectionResult,
  AdapterContext,
  ImportAlias,
  FrameworkType,
} from '../types.js';
import type { Route } from '../../analyzer/types.js';

/**
 * Remix framework adapter
 *
 * Handles Remix's flat file routing:
 * - Routes in app/routes/
 * - Page files: _index.tsx, route.tsx
 * - Dots for path segments: blog.posts.tsx -> /blog/posts
 * - Dynamic routes: $param
 * - Catch-all: $.tsx
 * - Pathless layouts: _prefix
 */
export class RemixAdapter extends BaseAdapter {
  readonly name: FrameworkType = 'remix';
  readonly displayName = 'Remix';
  readonly pageExtensions = ['.tsx', '.ts', '.jsx', '.js'];

  readonly importAliases: ImportAlias[] = [
    { pattern: '~/', replacement: 'app/' },
    { pattern: '@remix-run/', isInternal: true, replacement: '' },
  ];

  /**
   * Detect if this is a Remix project
   */
  async detect(ctx: AdapterContext): Promise<FrameworkDetectionResult> {
    const checks = {
      hasRemixConfig: false,
      hasRoutesDir: false,
      hasRemixDep: false,
      version: undefined as string | undefined,
    };

    // Check for remix.config.js/ts/cjs or vite.config with remix plugin
    checks.hasRemixConfig =
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'remix.config.js'))) ||
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'remix.config.ts'))) ||
      (await ctx.fileSource.exists(this.joinPaths(ctx.projectRoot, 'remix.config.cjs')));

    // Check for app/routes directory
    checks.hasRoutesDir = await ctx.fileSource.isDirectory(
      this.joinPaths(ctx.projectRoot, 'app/routes')
    );

    // Check package.json for @remix-run/react
    checks.hasRemixDep =
      (await this.hasDependency(ctx, '@remix-run/react')) ||
      (await this.hasDependency(ctx, '@remix-run/node'));

    if (checks.hasRemixDep) {
      checks.version = await this.getDependencyVersion(ctx, '@remix-run/react');
    }

    // Determine confidence
    const indicators = [checks.hasRemixConfig, checks.hasRoutesDir, checks.hasRemixDep];
    const trueCount = indicators.filter(Boolean).length;

    // Special case: app/routes + remix dep is high confidence even without config
    // (Remix v2 with Vite doesn't require remix.config)
    if (checks.hasRoutesDir && checks.hasRemixDep) {
      return {
        framework: 'remix',
        confidence: 'high',
        reason: 'Found app/routes/ and @remix-run dependency',
        version: checks.version,
      };
    }

    if (trueCount === 3) {
      return {
        framework: 'remix',
        confidence: 'high',
        reason: 'Found remix.config, app/routes/, and @remix-run dependency',
        version: checks.version,
      };
    }

    if (trueCount === 2) {
      return {
        framework: 'remix',
        confidence: 'medium',
        reason: `Found ${trueCount} of 3 Remix indicators`,
        version: checks.version,
      };
    }

    if (trueCount === 1) {
      return {
        framework: 'remix',
        confidence: 'low',
        reason: 'Found only one Remix indicator',
        version: checks.version,
      };
    }

    return {
      framework: null,
      confidence: 'none',
      reason: 'Not a Remix project',
    };
  }

  /**
   * Discover all routes in a Remix project
   */
  async discoverRoutes(ctx: AdapterContext): Promise<Route[]> {
    const routesDir = this.joinPaths(ctx.projectRoot, 'app/routes');
    const routes: Route[] = [];

    if (!(await ctx.fileSource.isDirectory(routesDir))) {
      return routes;
    }

    await this.scanRoutesDirectory(ctx, routesDir, routes);

    return routes.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async scanRoutesDirectory(
    ctx: AdapterContext,
    routesDir: string,
    routes: Route[]
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await ctx.fileSource.readdir(routesDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = this.joinPaths(routesDir, entry);
      const isDir = await ctx.fileSource.isDirectory(fullPath);

      if (isDir) {
        // Folder route - look for route.tsx inside
        await this.scanFolderRoute(ctx, fullPath, routesDir, routes);
      } else if (this.isRemixRouteFile(entry)) {
        // File route
        const urlPath = this.fileToUrlPath(entry);

        // Skip layout-only files (those starting with _ but not _index)
        if (this.isLayoutOnlyFile(entry)) {
          continue;
        }

        const isAuthProtected = this.isAuthProtectedPath(urlPath);
        const isDynamic = urlPath.includes(':') || urlPath.includes('*');

        routes.push({
          path: urlPath,
          directory: this.getRelativePath(ctx.projectRoot, routesDir),
          hasLayout: false,
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

  private async scanFolderRoute(
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

    // Look for route.tsx in the folder
    const routeFile = entries.find((e) => /^route\.(tsx?|jsx?)$/.test(e));

    if (routeFile) {
      const relativePath = this.getRelativePath(routesRoot, dir);
      const urlPath = this.folderToUrlPath(relativePath);
      const isAuthProtected = this.isAuthProtectedPath(urlPath);
      const isDynamic = urlPath.includes(':') || urlPath.includes('*');

      routes.push({
        path: urlPath,
        directory: this.getRelativePath(ctx.projectRoot, dir),
        hasLayout: entries.some((e) => /^(layout|_layout)\.(tsx?|jsx?)$/.test(e)),
        isAuthProtected,
        pageFiles: [routeFile],
        isDynamic,
        serverFiles: [],
        actions: [],
        apiMethods: [],
        hasFormHandler: false,
        hasApiEndpoint: false,
      });
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      const fullPath = this.joinPaths(dir, entry);
      const isSubDir = await ctx.fileSource.isDirectory(fullPath);
      if (isSubDir) {
        await this.scanFolderRoute(ctx, fullPath, routesRoot, routes);
      }
    }
  }

  private isRemixRouteFile(fileName: string): boolean {
    // Match .tsx, .ts, .jsx, .js files
    return /\.(tsx?|jsx?)$/.test(fileName) && !fileName.endsWith('.d.ts');
  }

  private isLayoutOnlyFile(fileName: string): boolean {
    // Files starting with _ that aren't _index are layout-only
    const baseName = fileName.replace(/\.(tsx?|jsx?)$/, '');
    return baseName.startsWith('_') && baseName !== '_index';
  }

  /**
   * Convert a Remix route file name to URL path
   * Examples:
   * - _index.tsx -> /
   * - about.tsx -> /about
   * - blog.posts.tsx -> /blog/posts
   * - blog.$slug.tsx -> /blog/:slug
   * - $.tsx -> /*
   * - blog_.edit.tsx -> /blog/edit (escaped dot)
   */
  private fileToUrlPath(fileName: string): string {
    // Remove extension
    let baseName = fileName.replace(/\.(tsx?|jsx?)$/, '');

    // Handle _index (root)
    if (baseName === '_index') {
      return '/';
    }

    // Handle escaped dots: name_ -> keep as part of segment
    // blog_.edit -> blog/edit (the _ escapes the dot)
    const parts = this.parseRemixFileName(baseName);

    // Convert dynamic segments and filter pathless
    const urlParts = parts
      .map((part) => {
        if (part === '$') {
          return '*'; // Catch-all
        }
        if (part.startsWith('$')) {
          return ':' + part.slice(1);
        }
        // Pathless layout prefix
        if (part.startsWith('_')) {
          return '';
        }
        return part;
      })
      .filter(Boolean);

    if (urlParts.length === 0) {
      return '/';
    }

    return '/' + urlParts.join('/');
  }

  /**
   * Parse Remix file name handling escaped dots
   */
  private parseRemixFileName(baseName: string): string[] {
    const parts: string[] = [];
    let current = '';
    let i = 0;

    while (i < baseName.length) {
      const char = baseName[i];

      if (char === '.') {
        if (current) {
          parts.push(current);
          current = '';
        }
        i++;
      } else if (char === '_' && i + 1 < baseName.length && baseName[i + 1] === '.') {
        // Escaped dot: _. -> literal dot in segment
        current += '.';
        i += 2;
      } else {
        current += char;
        i++;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Convert a folder path to URL path
   */
  private folderToUrlPath(relativePath: string): string {
    if (!relativePath || relativePath === '.') {
      return '/';
    }

    const parts = relativePath.split('/');

    const urlParts = parts
      .map((part) => {
        if (part === '$') {
          return '*';
        }
        if (part.startsWith('$')) {
          return ':' + part.slice(1);
        }
        if (part.startsWith('_')) {
          return ''; // Pathless segment
        }
        return part;
      })
      .filter(Boolean);

    if (urlParts.length === 0) {
      return '/';
    }

    return '/' + urlParts.join('/');
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
    return 'app/routes';
  }

  isRouteFile(filePath: string): boolean {
    const fileName = filePath.split('/').pop() || '';

    // route.tsx in folder
    if (/^route\.(tsx?|jsx?)$/.test(fileName)) {
      return true;
    }

    // File-based route (not layout-only)
    if (/\.(tsx?|jsx?)$/.test(fileName) && !this.isLayoutOnlyFile(fileName)) {
      return true;
    }

    return false;
  }

  isLayoutFile(filePath: string): boolean {
    const fileName = filePath.split('/').pop() || '';

    // layout.tsx or files starting with _ (except _index)
    if (/^layout\.(tsx?|jsx?)$/.test(fileName)) {
      return true;
    }

    const baseName = fileName.replace(/\.(tsx?|jsx?)$/, '');
    if (baseName.startsWith('_') && baseName !== '_index') {
      return true;
    }

    return false;
  }

  protected getLoginPagePaths(_routesDir: string, pattern: string): string[] {
    const paths: string[] = [];

    // Flat file routes
    paths.push(`app/routes/${pattern}.tsx`);
    paths.push(`app/routes/${pattern}._index.tsx`);
    paths.push(`app/routes/_auth.${pattern}.tsx`);

    // Folder routes
    paths.push(`app/routes/${pattern}/route.tsx`);
    paths.push(`app/routes/${pattern}/_index.tsx`);

    return paths;
  }

  protected pathToRoute(pathPattern: string): string {
    return '/' + pathPattern;
  }
}

/**
 * Factory function to create a Remix adapter
 */
export function createRemixAdapter(): RemixAdapter {
  return new RemixAdapter();
}
