import type {
  FrameworkAdapter,
  FrameworkType,
  AdapterContext,
  FrameworkDetectionResult,
  ImportAlias,
  LoginPageInfo,
} from './types.js';
import type { Route, ImportGraph } from '../analyzer/types.js';

/**
 * Abstract base class providing common functionality for all framework adapters.
 * Implements Template Method pattern for shared logic.
 */
export abstract class BaseAdapter implements FrameworkAdapter {
  abstract readonly name: FrameworkType;
  abstract readonly displayName: string;
  abstract readonly pageExtensions: string[];
  abstract readonly importAliases: ImportAlias[];

  // Abstract methods that subclasses must implement
  abstract detect(ctx: AdapterContext): Promise<FrameworkDetectionResult>;
  abstract discoverRoutes(ctx: AdapterContext): Promise<Route[]>;
  abstract getRoutesDirectory(): string;
  abstract isRouteFile(filePath: string): boolean;
  abstract isLayoutFile(filePath: string): boolean;

  /**
   * Common login page patterns across frameworks
   */
  protected readonly commonLoginPatterns = [
    'login',
    'signin',
    'sign-in',
    'auth/login',
    '(auth)/login',
    '(public)/login',
  ];

  /**
   * Common auth route indicators
   */
  protected readonly authIndicators = [
    /\(auth\)/i,
    /\(protected\)/i,
    /\(private\)/i,
    /\(authenticated\)/i,
    /\/dashboard/i,
    /\/admin/i,
    /\/portal/i,
    /\/account/i,
    /\/settings/i,
    /\/profile/i,
  ];

  /**
   * Default implementation of mapFileToRoutes
   * Can be overridden by specific adapters
   */
  mapFileToRoutes(filePath: string, allRoutes: Route[], importGraph: ImportGraph): Route[] {
    const affectedRoutes: Route[] = [];
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Direct route file changes
    for (const route of allRoutes) {
      const routeDir = route.directory.replace(/\\/g, '/');

      if (normalizedPath.startsWith(routeDir + '/') || normalizedPath === routeDir) {
        if (this.isRouteFile(normalizedPath) || this.isLayoutFile(normalizedPath)) {
          if (!affectedRoutes.includes(route)) {
            affectedRoutes.push(route);
          }
        }
      }
    }

    // Layout changes affect all child routes
    if (this.isLayoutFile(normalizedPath)) {
      const layoutDir = this.getDirectoryFromPath(normalizedPath);
      for (const route of allRoutes) {
        const routeDir = route.directory.replace(/\\/g, '/');
        if (routeDir.startsWith(layoutDir) && !affectedRoutes.includes(route)) {
          affectedRoutes.push(route);
        }
      }
    }

    // Component changes - use import graph
    const dependents = this.getAllDependents(normalizedPath, importGraph.importedBy);
    for (const dependent of dependents) {
      for (const route of allRoutes) {
        const routeDir = route.directory.replace(/\\/g, '/');
        if (dependent.replace(/\\/g, '/').startsWith(routeDir + '/')) {
          if (!affectedRoutes.includes(route)) {
            affectedRoutes.push(route);
          }
        }
      }
    }

    return affectedRoutes;
  }

  /**
   * Default implementation of resolveImport
   */
  async resolveImport(
    importPath: string,
    fromFile: string,
    ctx: AdapterContext
  ): Promise<string | null> {
    // Skip external packages
    if (!importPath.startsWith('.') && !this.isAliasedImport(importPath)) {
      return null;
    }

    // Check for internal imports that should be skipped
    for (const alias of this.importAliases) {
      if (alias.isInternal && importPath.startsWith(alias.pattern)) {
        return null;
      }
    }

    // Resolve aliased imports
    let resolvedPath = importPath;
    for (const alias of this.importAliases) {
      if (!alias.isInternal && importPath.startsWith(alias.pattern)) {
        resolvedPath = importPath.replace(alias.pattern, alias.replacement);
        break;
      }
    }

    // Handle relative imports
    if (resolvedPath.startsWith('.')) {
      const fromDir = this.getDirectoryFromPath(fromFile);
      resolvedPath = this.joinPaths(ctx.projectRoot, fromDir, resolvedPath);
    } else if (!resolvedPath.startsWith('/')) {
      // Aliased path - prepend project root
      resolvedPath = this.joinPaths(ctx.projectRoot, resolvedPath);
    }

    // Try to resolve to actual file
    return this.resolveToActualFile(resolvedPath, ctx);
  }

  /**
   * Default implementation of findLoginPages
   */
  async findLoginPages(ctx: AdapterContext): Promise<LoginPageInfo[]> {
    const loginPages: LoginPageInfo[] = [];
    const routesDir = this.getRoutesDirectory();

    for (const pattern of this.commonLoginPatterns) {
      const possiblePaths = this.getLoginPagePaths(routesDir, pattern);

      for (const possiblePath of possiblePaths) {
        const fullPath = this.joinPaths(ctx.projectRoot, possiblePath);
        if (await ctx.fileSource.exists(fullPath)) {
          try {
            const content = await ctx.fileSource.read(fullPath);
            loginPages.push({
              filePath: fullPath,
              route: this.pathToRoute(pattern),
              content,
            });
          } catch {
            // File exists but couldn't read - skip
          }
        }
      }
    }

    return loginPages;
  }

  // Protected helper methods for subclasses

  /**
   * Check if an import path uses one of this framework's aliases
   */
  protected isAliasedImport(importPath: string): boolean {
    return this.importAliases.some((alias) => importPath.startsWith(alias.pattern));
  }

  /**
   * Get directory from a file path
   */
  protected getDirectoryFromPath(filePath: string): string {
    const parts = filePath.split('/');
    parts.pop();
    return parts.join('/');
  }

  /**
   * Join path segments, normalizing slashes and preventing path traversal
   *
   * Security: Validates each segment BEFORE joining to prevent path traversal attacks.
   * Allows framework routing patterns like [...slug] and [[...slug]] which contain '..'
   * but rejects actual path traversal attempts like '../' or '..\'.
   */
  protected joinPaths(...paths: string[]): string {
    const filtered = paths.filter(Boolean);
    if (filtered.length === 0) return '';

    // Validate each segment for path traversal attempts
    for (let i = 0; i < filtered.length; i++) {
      const segment = filtered[i];

      // Check for path traversal patterns
      // Allow '..' inside brackets (e.g., [...slug] or [[...slug]]) - these are routing patterns
      // Reject bare '..' that would traverse directories
      if (this.containsPathTraversal(segment)) {
        throw new Error(`Path traversal detected in segment: ${segment}`);
      }

      // Check for URL-encoded traversal attempts
      if (segment.includes('%2e') || segment.includes('%2E')) {
        throw new Error(`Encoded path traversal detected in segment: ${segment}`);
      }

      // Only first segment can be absolute (start with /)
      if (i > 0 && segment.startsWith('/')) {
        throw new Error(`Absolute path in non-first segment: ${segment}`);
      }
    }

    // Join and normalize
    return filtered
      .join('/')
      .split('/')
      .filter((part) => part !== '.' && part !== '') // Remove empty and '.' segments
      .join('/')
      .replace(/\/+/g, '/') // Collapse multiple slashes
      .replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Check if a path segment contains actual path traversal (not routing patterns)
   */
  private containsPathTraversal(segment: string): boolean {
    // Remove content inside brackets (framework routing patterns like [...slug])
    // This allows [...slug] but rejects ../foo
    const withoutBrackets = segment.replace(/\[[^\]]*\]/g, '');

    // Check for '..' in the remaining content
    // Match '..' at start, end, or surrounded by slashes/path separators
    return /(?:^|[\\/])\.\.(?:$|[\\/])/.test(withoutBrackets) ||
      withoutBrackets === '..';
  }

  /**
   * Normalize path separators to forward slashes
   */
  protected normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  /**
   * Try to resolve a base path to an actual file
   *
   * Uses parallel I/O for better performance when checking multiple extensions.
   */
  protected async resolveToActualFile(
    basePath: string,
    ctx: AdapterContext
  ): Promise<string | null> {
    const extensions = ['', ...this.pageExtensions, '.ts', '.js', '.tsx', '.jsx'];
    const indexFiles = ['index.ts', 'index.js', ...this.pageExtensions.map((e) => `index${e}`)];

    // Check all extensions in parallel
    const extensionPaths = extensions.map((ext) => basePath + ext);
    const extensionChecks = await Promise.all(
      extensionPaths.map(async (fullPath) => {
        try {
          const exists = await ctx.fileSource.exists(fullPath);
          if (!exists) return null;
          const isDir = await ctx.fileSource.isDirectory(fullPath);
          return isDir ? null : fullPath;
        } catch {
          return null;
        }
      })
    );

    // Return first non-null result (preserves extension priority order)
    for (const result of extensionChecks) {
      if (result) return result;
    }

    // Try as directory with index file (parallel check)
    const isDir = await ctx.fileSource.isDirectory(basePath);
    if (isDir) {
      const indexPaths = indexFiles.map((indexFile) => `${basePath}/${indexFile}`);
      const indexChecks = await Promise.all(
        indexPaths.map(async (indexPath) => {
          try {
            const exists = await ctx.fileSource.exists(indexPath);
            return exists ? indexPath : null;
          } catch {
            return null;
          }
        })
      );

      for (const result of indexChecks) {
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Get all files that depend on a given file (transitive)
   */
  protected getAllDependents(
    filePath: string,
    importedByMap: Map<string, string[]>,
    visited: Set<string> = new Set()
  ): string[] {
    if (visited.has(filePath)) {
      return [];
    }
    visited.add(filePath);

    const directDependents = importedByMap.get(filePath) || [];
    const allDependents = [...directDependents];

    for (const dependent of directDependents) {
      const transitive = this.getAllDependents(dependent, importedByMap, visited);
      allDependents.push(...transitive);
    }

    return [...new Set(allDependents)];
  }

  /**
   * Check if a path appears to be auth-protected based on naming conventions
   */
  protected isAuthProtectedPath(relativePath: string): boolean {
    return this.authIndicators.some((pattern) => pattern.test(relativePath));
  }

  /**
   * Parse package.json from file source
   */
  protected async parsePackageJson(
    ctx: AdapterContext
  ): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null> {
    try {
      const pkgPath = this.joinPaths(ctx.projectRoot, 'package.json');
      const content = await ctx.fileSource.read(pkgPath);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Check if a dependency exists in package.json
   */
  protected async hasDependency(ctx: AdapterContext, packageName: string): Promise<boolean> {
    const pkg = await this.parsePackageJson(ctx);
    if (!pkg) return false;
    return !!(pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName]);
  }

  /**
   * Get version of a dependency from package.json
   */
  protected async getDependencyVersion(
    ctx: AdapterContext,
    packageName: string
  ): Promise<string | undefined> {
    const pkg = await this.parsePackageJson(ctx);
    if (!pkg) return undefined;
    return pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName];
  }

  // Abstract helpers that subclasses must implement

  /**
   * Get possible login page file paths for a given pattern
   */
  protected abstract getLoginPagePaths(routesDir: string, pattern: string): string[];

  /**
   * Convert a file path pattern to a URL route
   */
  protected abstract pathToRoute(pathPattern: string): string;
}
