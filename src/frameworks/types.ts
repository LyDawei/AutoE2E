import type { Route, ImportGraph } from '../analyzer/types.js';

/**
 * Supported framework identifiers
 */
export type FrameworkType =
  | 'sveltekit'
  | 'nextjs-app'
  | 'nextjs-pages'
  | 'nextjs' // Hybrid: both app and pages router
  | 'nuxt'
  | 'remix'
  | 'react-router';

/**
 * Detection confidence levels
 */
export type DetectionConfidence = 'high' | 'medium' | 'low' | 'none';

/**
 * Result of framework detection
 */
export interface FrameworkDetectionResult {
  framework: FrameworkType | null;
  confidence: DetectionConfidence;
  reason: string;
  /** For Next.js: which router(s) detected */
  routerType?: 'app' | 'pages' | 'hybrid';
  /** Version if detectable from package.json */
  version?: string;
}

/**
 * Import alias configuration
 */
export interface ImportAlias {
  /** Pattern to match (e.g., '$lib', '@/', '~/') */
  pattern: string;
  /** Replacement path (e.g., 'src/lib', 'src', 'app') */
  replacement: string;
  /** If true, skip resolution (e.g., $app, $env are SvelteKit internal) */
  isInternal?: boolean;
}

/**
 * Login page detection result
 */
export interface LoginPageInfo {
  /** Relative path to login page file */
  filePath: string;
  /** URL route for login */
  route: string;
  /** File content (for AI analysis) */
  content?: string;
}

/**
 * File source abstraction for remote/local access
 */
export interface FileSource {
  /** Check if a file exists */
  exists(path: string): Promise<boolean>;
  /** Read file content */
  read(path: string): Promise<string>;
  /** List directory contents (file/folder names only) */
  readdir(path: string): Promise<string[]>;
  /** Check if path is a directory */
  isDirectory(path: string): Promise<boolean>;
  /** Get all files matching a pattern (glob-like) */
  glob(pattern: string, basePath?: string): Promise<string[]>;
}

/**
 * Context provided to adapters for analysis
 */
export interface AdapterContext {
  /** File source (remote GitHub or local filesystem) */
  fileSource: FileSource;
  /** Root path of the project/app (for monorepo support) */
  projectRoot: string;
  /** Owner/repo for GitHub API calls (only for remote) */
  repoInfo?: { owner: string; repo: string; ref: string };
}

/**
 * Main framework adapter interface
 *
 * Each framework implements this interface to provide
 * framework-specific route discovery and analysis.
 */
export interface FrameworkAdapter {
  /** Framework identifier */
  readonly name: FrameworkType;

  /** Human-readable framework name */
  readonly displayName: string;

  /** File extensions this framework uses for pages/routes */
  readonly pageExtensions: string[];

  /** Import aliases for this framework */
  readonly importAliases: ImportAlias[];

  /**
   * Detect if this framework is used in the project
   * @param ctx Adapter context with file access
   * @returns Detection result with confidence
   */
  detect(ctx: AdapterContext): Promise<FrameworkDetectionResult>;

  /**
   * Discover all routes in the project
   * @param ctx Adapter context with file access
   * @returns Array of discovered routes
   */
  discoverRoutes(ctx: AdapterContext): Promise<Route[]>;

  /**
   * Map a changed file to affected routes
   * @param filePath Changed file path (relative to project root)
   * @param allRoutes All discovered routes
   * @param importGraph Import dependency graph
   * @returns Routes affected by this file change
   */
  mapFileToRoutes(filePath: string, allRoutes: Route[], importGraph: ImportGraph): Route[];

  /**
   * Resolve an import path to a project-relative path
   * @param importPath The import specifier (e.g., '$lib/Button')
   * @param fromFile The file containing the import
   * @param ctx Adapter context
   * @returns Resolved path or null if external/unresolvable
   */
  resolveImport(
    importPath: string,
    fromFile: string,
    ctx: AdapterContext
  ): Promise<string | null>;

  /**
   * Find potential login page locations
   * @param ctx Adapter context with file access
   * @returns Array of potential login pages
   */
  findLoginPages(ctx: AdapterContext): Promise<LoginPageInfo[]>;

  /**
   * Get the routes directory path for this framework
   * @returns Relative path to routes directory
   */
  getRoutesDirectory(): string;

  /**
   * Check if a file is a route/page file
   * @param filePath File path to check
   * @returns True if this is a route file
   */
  isRouteFile(filePath: string): boolean;

  /**
   * Check if a file is a layout file
   * @param filePath File path to check
   * @returns True if this is a layout file
   */
  isLayoutFile(filePath: string): boolean;
}

/**
 * Factory function type for creating adapters
 */
export type AdapterFactory = () => FrameworkAdapter;
