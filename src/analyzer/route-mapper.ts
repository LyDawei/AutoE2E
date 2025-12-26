import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Route, HttpMethod } from './types.js';

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
  const serverFiles: string[] = [];
  let hasLayout = false;
  let hasApiEndpoint = false;
  let actions: string[] = [];
  let apiMethods: HttpMethod[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      scanDirectory(fullPath, routesRoot, routes);
    } else if (entry.isFile()) {
      // Check for route-related files
      if (entry.name.startsWith('+page')) {
        pageFiles.push(entry.name);

        // Check for server-side page logic
        if (entry.name === '+page.server.ts' || entry.name === '+page.server.js') {
          serverFiles.push(entry.name);
          // Extract form actions from the file
          actions = extractFormActions(fullPath);
        }
      } else if (entry.name.startsWith('+layout')) {
        hasLayout = true;

        // Check for server-side layout logic
        if (entry.name === '+layout.server.ts' || entry.name === '+layout.server.js') {
          serverFiles.push(entry.name);
        }
      } else if (entry.name === '+server.ts' || entry.name === '+server.js') {
        // API endpoint
        serverFiles.push(entry.name);
        hasApiEndpoint = true;
        apiMethods = extractApiMethods(fullPath);
      }
    }
  }

  // If this directory has page files or is an API endpoint, it's a route
  if (pageFiles.length > 0 || hasApiEndpoint) {
    const relativePath = path.relative(routesRoot, dir);
    const urlPath = directoryToUrlPath(relativePath);
    const group = extractRouteGroup(relativePath);
    const isAuthProtected = isAuthRoute(relativePath);
    const isDynamic = urlPath.includes('[');
    const hasFormHandler = actions.length > 0;

    routes.push({
      path: urlPath,
      directory: path.relative(path.dirname(routesRoot), dir),
      hasLayout,
      isAuthProtected,
      pageFiles,
      isDynamic,
      group,
      serverFiles,
      actions,
      apiMethods,
      hasFormHandler,
      hasApiEndpoint,
    });
  }
}

/**
 * Extract HTTP methods exported from a +server.ts file
 */
export function extractApiMethods(filePath: string): HttpMethod[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const methods: HttpMethod[] = [];

    // Match: export function GET, export async function GET, export const GET
    // Note: SvelteKit requires exact uppercase HTTP method names
    if (/export\s+(async\s+)?function\s+GET\b/.test(content) || /export\s+(const|let)\s+GET\s*=/.test(content)) {
      methods.push('GET');
    }
    if (/export\s+(async\s+)?function\s+POST\b/.test(content) || /export\s+(const|let)\s+POST\s*=/.test(content)) {
      methods.push('POST');
    }
    if (/export\s+(async\s+)?function\s+PUT\b/.test(content) || /export\s+(const|let)\s+PUT\s*=/.test(content)) {
      methods.push('PUT');
    }
    if (/export\s+(async\s+)?function\s+PATCH\b/.test(content) || /export\s+(const|let)\s+PATCH\s*=/.test(content)) {
      methods.push('PATCH');
    }
    if (/export\s+(async\s+)?function\s+DELETE\b/.test(content) || /export\s+(const|let)\s+DELETE\s*=/.test(content)) {
      methods.push('DELETE');
    }

    return methods;
  } catch {
    return [];
  }
}

/**
 * Keywords that should not be treated as action names when parsing object properties.
 * Note: 'default' and 'delete' are valid as object property names in JavaScript
 * (e.g., SvelteKit form actions), so they are NOT included in this list.
 */
const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'return', 'throw', 'await', 'async', 'function',
  'const', 'let', 'var', 'class', 'switch', 'case', 'try', 'catch', 'finally',
  'new', 'typeof', 'instanceof', 'void', 'this', 'super', 'import', 'export',
  'break', 'continue', 'do', 'else', 'in', 'of', 'with', 'yield', 'debugger',
  'true', 'false', 'null', 'undefined',
]);

/**
 * Strip comments from source code to prevent false parsing
 */
function stripComments(content: string): string {
  // Remove single-line comments
  let result = content.replace(/\/\/[^\n]*/g, '');
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

/**
 * Extract form actions from a +page.server.ts file
 */
export function extractFormActions(filePath: string): string[] {
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    const actions: string[] = [];

    // Strip comments to prevent false matches
    content = stripComments(content);

    // Match the actions object declaration (handle multiple patterns)
    // Pattern 1: export const actions = { ... }
    // Pattern 2: export const actions: Actions = { ... }
    // Pattern 3: const actions = { ... } satisfies Actions
    const actionsRegex = /(?:export\s+)?(?:const|let)\s+actions\s*(?::\s*\w+)?\s*=\s*\{/;
    const match = content.match(actionsRegex);

    if (match) {
      // Find the start of the object
      const startIndex = match.index! + match[0].length;

      // Track brace depth to find the end of the actions object
      // Handle string literals to avoid counting braces inside strings
      let depth = 1;
      let i = startIndex;
      let inString: string | null = null;
      let escaped = false;

      while (i < content.length && depth > 0) {
        const char = content[i];

        if (escaped) {
          escaped = false;
          i++;
          continue;
        }

        if (char === '\\') {
          escaped = true;
          i++;
          continue;
        }

        // Handle string literals
        if (inString) {
          if (char === inString) {
            inString = null;
          }
          i++;
          continue;
        }

        // Start of string literal
        if (char === '"' || char === "'" || char === '`') {
          inString = char;
          i++;
          continue;
        }

        // Track brace depth only outside strings
        if (char === '{') depth++;
        else if (char === '}') depth--;
        i++;
      }

      const actionsContent = content.slice(startIndex, i - 1);

      // Extract top-level property names using a simple state machine
      // We're looking for patterns like: propertyName: or propertyName(
      let currentDepth = 0;
      let j = 0;
      let inStringInner: string | null = null;
      let escapedInner = false;

      while (j < actionsContent.length) {
        const char = actionsContent[j];

        // Handle escape sequences
        if (escapedInner) {
          escapedInner = false;
          j++;
          continue;
        }

        if (char === '\\') {
          escapedInner = true;
          j++;
          continue;
        }

        // Handle string literals
        if (inStringInner) {
          if (char === inStringInner) {
            inStringInner = null;
          }
          j++;
          continue;
        }

        if (char === '"' || char === "'" || char === '`') {
          inStringInner = char;
          j++;
          continue;
        }

        if (char === '{') {
          currentDepth++;
          j++;
          continue;
        }
        if (char === '}') {
          currentDepth--;
          j++;
          continue;
        }

        // Only look for action names at top level (depth 0)
        if (currentDepth === 0) {
          // Skip whitespace and commas
          if (/\s|,/.test(char)) {
            j++;
            continue;
          }

          const remaining = actionsContent.slice(j);

          // Pattern 1: property with colon - name: async/function/arrow
          const colonMatch = remaining.match(/^(\w+)\s*:/);
          if (colonMatch) {
            const actionName = colonMatch[1];
            if (!actions.includes(actionName) && !JS_KEYWORDS.has(actionName)) {
              actions.push(actionName);
            }
            j += colonMatch[0].length;
            continue;
          }

          // Pattern 2: shorthand async method - async name(
          const asyncMethodMatch = remaining.match(/^async\s+(\w+)\s*\(/);
          if (asyncMethodMatch) {
            const actionName = asyncMethodMatch[1];
            if (!actions.includes(actionName) && !JS_KEYWORDS.has(actionName)) {
              actions.push(actionName);
            }
            j += asyncMethodMatch[0].length;
            continue;
          }

          // Pattern 3: shorthand method - name(
          const methodMatch = remaining.match(/^(\w+)\s*\(/);
          if (methodMatch) {
            const actionName = methodMatch[1];
            // Avoid matching keywords
            if (!JS_KEYWORDS.has(actionName)) {
              if (!actions.includes(actionName)) {
                actions.push(actionName);
              }
            }
            j += methodMatch[0].length;
            continue;
          }
        }

        j++;
      }
    }

    return actions;
  } catch {
    return [];
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
