import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Route } from './types.js';

/**
 * Discover all routes in a SvelteKit project
 * SvelteKit uses file-based routing in src/routes/
 */
export function discoverRoutes(projectRoot: string): Route[] {
  const routesDir = path.join(projectRoot, 'src', 'routes');

  if (!fs.existsSync(routesDir)) {
    return [];
  }

  const routes: Route[] = [];
  scanDirectory(routesDir, routesDir, routes);

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Recursively scan directory for routes
 */
function scanDirectory(dir: string, routesRoot: string, routes: Route[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const pageFiles: string[] = [];
  let hasLayout = false;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      scanDirectory(fullPath, routesRoot, routes);
    } else if (entry.isFile()) {
      // Check for route-related files
      if (entry.name.startsWith('+page')) {
        pageFiles.push(entry.name);
      } else if (entry.name.startsWith('+layout')) {
        hasLayout = true;
      }
    }
  }

  // If this directory has page files, it's a route
  if (pageFiles.length > 0) {
    const relativePath = path.relative(routesRoot, dir);
    const urlPath = directoryToUrlPath(relativePath);
    const group = extractRouteGroup(relativePath);
    const isAuthProtected = isAuthRoute(relativePath);
    const isDynamic = urlPath.includes('[');

    routes.push({
      path: urlPath,
      directory: path.relative(path.dirname(routesRoot), dir),
      hasLayout,
      isAuthProtected,
      pageFiles,
      isDynamic,
      group,
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
 * - "[...rest]" -> "/[...rest]"
 */
function directoryToUrlPath(relativePath: string): string {
  if (!relativePath || relativePath === '.') {
    return '/';
  }

  // Split by path separator
  const parts = relativePath.split(path.sep);

  // Filter out route groups (directories in parentheses)
  const filteredParts = parts.filter((part) => !part.startsWith('('));

  if (filteredParts.length === 0) {
    return '/';
  }

  return '/' + filteredParts.join('/');
}

/**
 * Extract route group name from path
 * Example: "(auth)/dashboard" -> "auth"
 */
function extractRouteGroup(relativePath: string): string | undefined {
  const parts = relativePath.split(path.sep);
  for (const part of parts) {
    const match = part.match(/^\((.+)\)$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Determine if a route is likely auth-protected based on conventions
 */
function isAuthRoute(relativePath: string): boolean {
  const authIndicators = [
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

  return authIndicators.some((pattern) => pattern.test(relativePath));
}

/**
 * Map a changed file to affected routes
 */
export function mapFileToRoutes(
  filePath: string,
  allRoutes: Route[],
  importedByMap: Map<string, string[]>
): Route[] {
  const affectedRoutes: Route[] = [];
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Direct route file changes
  for (const route of allRoutes) {
    const routeDir = route.directory.replace(/\\/g, '/');

    // Check if the changed file is directly in this route's directory
    if (normalizedPath.startsWith(routeDir + '/') || normalizedPath === routeDir) {
      const fileName = path.basename(normalizedPath);
      if (
        fileName.startsWith('+page') ||
        fileName.startsWith('+layout') ||
        fileName.startsWith('+error')
      ) {
        if (!affectedRoutes.includes(route)) {
          affectedRoutes.push(route);
        }
      }
    }
  }

  // Layout changes affect all child routes
  if (path.basename(normalizedPath).startsWith('+layout')) {
    const layoutDir = path.dirname(normalizedPath).replace(/\\/g, '/');
    for (const route of allRoutes) {
      const routeDir = route.directory.replace(/\\/g, '/');
      if (routeDir.startsWith(layoutDir) && !affectedRoutes.includes(route)) {
        affectedRoutes.push(route);
      }
    }
  }

  // Component/lib changes - use import graph to find affected routes
  if (normalizedPath.includes('$lib') || normalizedPath.includes('src/lib')) {
    const dependents = getAllDependents(normalizedPath, importedByMap);
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
  }

  return affectedRoutes;
}

/**
 * Get all files that depend on a given file (transitive)
 */
function getAllDependents(
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
    const transitiveDependents = getAllDependents(dependent, importedByMap, visited);
    allDependents.push(...transitiveDependents);
  }

  return [...new Set(allDependents)];
}

/**
 * Find routes affected by multiple file changes
 */
export function findAffectedRoutes(
  changedFiles: string[],
  allRoutes: Route[],
  importedByMap: Map<string, string[]>
): Map<Route, string[]> {
  const routeReasons = new Map<Route, string[]>();

  for (const file of changedFiles) {
    const affectedRoutes = mapFileToRoutes(file, allRoutes, importedByMap);
    for (const route of affectedRoutes) {
      const reasons = routeReasons.get(route) || [];
      reasons.push(file);
      routeReasons.set(route, reasons);
    }
  }

  return routeReasons;
}
