import { BaseAdapter } from '../base-adapter.js';
import type {
  FrameworkDetectionResult,
  AdapterContext,
  ImportAlias,
  FrameworkType,
} from '../types.js';
import type { Route } from '../../analyzer/types.js';

/**
 * React Router framework adapter
 *
 * Handles React Router v7's file-based routing:
 * - Routes in app/routes/
 * - Page files: route.tsx, _index.tsx
 * - Dynamic routes: $param
 * - Catch-all: $.tsx
 *
 * Note: Only file-based routing is supported (via @react-router/fs-routes)
 * Code-based routing (routes.ts config) is not supported.
 */
export class ReactRouterAdapter extends BaseAdapter {
  readonly name: FrameworkType = 'react-router';
  readonly displayName = 'React Router';
  readonly pageExtensions = ['.tsx', '.ts', '.jsx', '.js'];

  readonly importAliases: ImportAlias[] = [
    { pattern: '~/', replacement: 'app/' },
    { pattern: '@/', replacement: 'src/' },
  ];

  /**
   * Detect if this is a React Router project (not Remix)
   */
  async detect(ctx: AdapterContext): Promise<FrameworkDetectionResult> {
    const checks = {
      hasRoutesDir: false,
      hasReactRouterDep: false,
      hasRemixDep: false, // If Remix is present, this is Remix, not React Router
      version: undefined as string | undefined,
    };

    // Check for app/routes directory
    checks.hasRoutesDir = await ctx.fileSource.isDirectory(
      this.joinPaths(ctx.projectRoot, 'app/routes')
    );

    // Check package.json for react-router
    checks.hasReactRouterDep =
      (await this.hasDependency(ctx, 'react-router')) ||
      (await this.hasDependency(ctx, 'react-router-dom')) ||
      (await this.hasDependency(ctx, '@react-router/dev'));

    if (checks.hasReactRouterDep) {
      checks.version =
        (await this.getDependencyVersion(ctx, '@react-router/dev')) ||
        (await this.getDependencyVersion(ctx, 'react-router-dom')) ||
        (await this.getDependencyVersion(ctx, 'react-router'));
    }

    // Check for Remix (if present, this is Remix, not React Router)
    checks.hasRemixDep =
      (await this.hasDependency(ctx, '@remix-run/react')) ||
      (await this.hasDependency(ctx, '@remix-run/node'));

    // If Remix is present, this is not a React Router project
    if (checks.hasRemixDep) {
      return {
        framework: null,
        confidence: 'none',
        reason: 'Remix detected, not React Router',
      };
    }

    // Determine confidence
    if (checks.hasRoutesDir && checks.hasReactRouterDep) {
      return {
        framework: 'react-router',
        confidence: 'high',
        reason: 'Found app/routes/ and react-router dependency',
        version: checks.version,
      };
    }

    if (checks.hasReactRouterDep) {
      return {
        framework: 'react-router',
        confidence: 'low',
        reason: 'Found react-router dependency but no file-based routes',
        version: checks.version,
      };
    }

    return {
      framework: null,
      confidence: 'none',
      reason: 'Not a React Router project',
    };
  }

  /**
   * Discover all routes in a React Router project
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

  /**
   * Scan the routes directory for React Router file-based routes
   */
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
        // Folder-based routes
        await this.scanFolderRoute(ctx, fullPath, routesDir, routes);
      } else if (this.isRouteFile(entry)) {
        // File-based routes
        const urlPath = this.fileToUrlPath(entry);
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
    const hasRouteFile = entries.some((e) => /^route\.(tsx?|jsx?)$/.test(e));

    if (hasRouteFile) {
      const relativePath = this.getRelativePath(routesRoot, dir);
      const urlPath = this.folderToUrlPath(relativePath);
      const isAuthProtected = this.isAuthProtectedPath(urlPath);
      const isDynamic = urlPath.includes(':') || urlPath.includes('*');

      routes.push({
        path: urlPath,
        directory: this.getRelativePath(ctx.projectRoot, dir),
        hasLayout: entries.some((e) => /^layout\.(tsx?|jsx?)$/.test(e)),
        isAuthProtected,
        pageFiles: entries.filter((e) => /^route\.(tsx?|jsx?)$/.test(e)),
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

  /**
   * Convert a route file name to URL path
   * Examples:
   * - _index.tsx -> /
   * - about.tsx -> /about
   * - blog.$slug.tsx -> /blog/:slug
   * - $.tsx -> /*
   * - blog_.posts.tsx -> /blog/posts (escaping)
   */
  private fileToUrlPath(fileName: string): string {
    // Remove extension
    let baseName = fileName.replace(/\.(tsx?|jsx?)$/, '');

    // Handle _index (root)
    if (baseName === '_index') {
      return '/';
    }

    // Convert dots to slashes (segment separator)
    // Handle escaped dots: blog_.posts -> blog/posts
    const parts = baseName
      .replace(/_\./g, '<<<ESCAPED>>>')
      .split('.')
      .map((p) => p.replace(/<<<ESCAPED>>>/g, '.'));

    // Convert dynamic segments: $param -> :param
    const urlParts = parts.map((part) => {
      if (part === '$') {
        return '*'; // Catch-all
      }
      if (part.startsWith('$')) {
        return ':' + part.slice(1);
      }
      // Remove layout prefix
      if (part.startsWith('_')) {
        return ''; // Pathless layout
      }
      return part;
    });

    const filtered = urlParts.filter(Boolean);
    if (filtered.length === 0) {
      return '/';
    }

    return '/' + filtered.join('/');
  }

  /**
   * Convert a folder path to URL path
   */
  private folderToUrlPath(relativePath: string): string {
    if (!relativePath || relativePath === '.') {
      return '/';
    }

    const parts = relativePath.split('/');

    const urlParts = parts.map((part) => {
      if (part.startsWith('$')) {
        if (part === '$') {
          return '*';
        }
        return ':' + part.slice(1);
      }
      if (part.startsWith('_')) {
        return ''; // Pathless segment
      }
      return part;
    });

    const filtered = urlParts.filter(Boolean);
    if (filtered.length === 0) {
      return '/';
    }

    return '/' + filtered.join('/');
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

    // Match route.tsx or any file in routes/ that's not a layout
    if (/^route\.(tsx?|jsx?)$/.test(fileName)) {
      return true;
    }

    // File-based routes: name.tsx (but not _layout, etc.)
    if (/\.(tsx?|jsx?)$/.test(fileName) && !fileName.startsWith('_layout')) {
      return true;
    }

    return false;
  }

  isLayoutFile(filePath: string): boolean {
    const fileName = filePath.split('/').pop() || '';
    return /^(layout|_layout)\.(tsx?|jsx?)$/.test(fileName);
  }

  protected getLoginPagePaths(_routesDir: string, pattern: string): string[] {
    const paths: string[] = [];

    // File-based
    paths.push(`app/routes/${pattern}.tsx`);
    paths.push(`app/routes/${pattern}._index.tsx`);

    // Folder-based
    paths.push(`app/routes/${pattern}/route.tsx`);
    paths.push(`app/routes/${pattern}/_index.tsx`);

    return paths;
  }

  protected pathToRoute(pathPattern: string): string {
    return '/' + pathPattern;
  }
}

/**
 * Factory function to create a React Router adapter
 */
export function createReactRouterAdapter(): ReactRouterAdapter {
  return new ReactRouterAdapter();
}
