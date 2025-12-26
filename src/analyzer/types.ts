/** HTTP methods that can be exported from +server.ts */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Route {
  /** URL path (e.g., "/", "/login", "/portal/dashboard") */
  path: string;
  /** File system path relative to project root (e.g., "src/routes/login") */
  directory: string;
  /** Whether this route has a +layout.svelte */
  hasLayout: boolean;
  /** Whether this route appears to be auth-protected (e.g., under (auth) group) */
  isAuthProtected: boolean;
  /** List of page-related files (+page.svelte, +page.server.ts, etc.) */
  pageFiles: string[];
  /** Whether this is a dynamic route (contains [param] or [...rest]) */
  isDynamic: boolean;
  /** Route group name if any (e.g., "auth", "marketing") */
  group?: string;
  /** Server-side files (+server.ts, +page.server.ts, +layout.server.ts) */
  serverFiles: string[];
  /** Form actions defined in +page.server.ts (e.g., "default", "create", "update") */
  actions: string[];
  /** HTTP methods exported from +server.ts (GET, POST, PUT, PATCH, DELETE) */
  apiMethods: HttpMethod[];
  /** Whether this route has server-side form handling logic */
  hasFormHandler: boolean;
  /** Whether this route has an API endpoint (+server.ts) */
  hasApiEndpoint: boolean;
}

export interface ImportGraph {
  /** Map of file path to files it imports */
  imports: Map<string, string[]>;
  /** Map of file path to files that import it (reverse lookup) */
  importedBy: Map<string, string[]>;
}

export interface RouteAnalysis {
  route: Route;
  /** Why this route was selected for testing */
  reason: string;
  /** Estimated visual impact */
  visualImpact: 'high' | 'medium' | 'low';
  /** Specific elements/areas likely affected */
  affectedAreas: string[];
  /** Priority for testing (lower = higher priority) */
  priority: number;
}

export interface AnalysisResult {
  /** Routes that need visual testing */
  routesToTest: RouteAnalysis[];
  /** Files that changed with visual impact */
  changedFiles: string[];
  /** Files that were traced via import graph */
  tracedFiles: string[];
  /** Confidence score 0-1 */
  confidence: number;
  /** Reasoning for the analysis */
  reasoning: string;
}
