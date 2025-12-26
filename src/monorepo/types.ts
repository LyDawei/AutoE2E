import type { FrameworkType } from '../frameworks/types.js';

/**
 * Supported monorepo types
 */
export type MonorepoType =
  | 'npm-workspaces'
  | 'yarn-workspaces'
  | 'pnpm-workspaces'
  | 'turborepo'
  | 'nx'
  | 'lerna'
  | 'none';

/**
 * Information about a workspace/app within a monorepo
 */
export interface WorkspaceInfo {
  /** Workspace name (from package.json) */
  name: string;
  /** Relative path to the workspace */
  path: string;
  /** Detected framework (if any) */
  framework?: FrameworkType;
  /** Whether this workspace has visual components */
  hasVisualComponents?: boolean;
}

/**
 * Monorepo configuration and structure
 */
export interface MonorepoConfig {
  /** Type of monorepo */
  type: MonorepoType;
  /** Root path of the monorepo */
  rootPath: string;
  /** List of detected workspaces */
  workspaces: WorkspaceInfo[];
  /** Workspace patterns from config */
  patterns?: string[];
}
