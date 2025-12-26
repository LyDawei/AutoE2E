import type { FileSource } from '../frameworks/types.js';
import type { MonorepoConfig, WorkspaceInfo } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Detect if a project is a monorepo and identify its workspaces
 *
 * @param fileSource File source for reading project files
 * @param rootPath Root path of the project
 * @returns MonorepoConfig if detected, null otherwise
 */
export async function detectMonorepo(
  fileSource: FileSource,
  rootPath: string = ''
): Promise<MonorepoConfig | null> {
  logger.debug('Checking for monorepo structure...');

  // Try different monorepo detection strategies
  const strategies = [
    detectNpmWorkspaces,
    detectPnpmWorkspaces,
    detectTurborepo,
    detectNx,
    detectLerna,
  ];

  for (const detect of strategies) {
    const result = await detect(fileSource, rootPath);
    if (result) {
      logger.debug(`Detected ${result.type} monorepo with ${result.workspaces.length} workspaces`);
      return result;
    }
  }

  return null;
}

/**
 * Detect npm/yarn workspaces from package.json
 */
async function detectNpmWorkspaces(
  fileSource: FileSource,
  rootPath: string
): Promise<MonorepoConfig | null> {
  try {
    const pkgPath = rootPath ? `${rootPath}/package.json` : 'package.json';
    const content = await fileSource.read(pkgPath);
    const pkg = JSON.parse(content);

    if (!pkg.workspaces) {
      return null;
    }

    // Workspaces can be an array or an object with packages
    let patterns: string[];
    if (Array.isArray(pkg.workspaces)) {
      patterns = pkg.workspaces;
    } else if (pkg.workspaces.packages) {
      patterns = pkg.workspaces.packages;
    } else {
      return null;
    }

    const workspaces = await resolveWorkspacePatterns(fileSource, rootPath, patterns);

    // Determine if it's yarn or npm based on lock files
    const hasYarnLock = await fileSource.exists(
      rootPath ? `${rootPath}/yarn.lock` : 'yarn.lock'
    );

    return {
      type: hasYarnLock ? 'yarn-workspaces' : 'npm-workspaces',
      rootPath,
      workspaces,
      patterns,
    };
  } catch {
    return null;
  }
}

/**
 * Detect pnpm workspaces from pnpm-workspace.yaml
 */
async function detectPnpmWorkspaces(
  fileSource: FileSource,
  rootPath: string
): Promise<MonorepoConfig | null> {
  try {
    const yamlPath = rootPath ? `${rootPath}/pnpm-workspace.yaml` : 'pnpm-workspace.yaml';

    if (!(await fileSource.exists(yamlPath))) {
      return null;
    }

    const content = await fileSource.read(yamlPath);

    // Simple YAML parsing for packages array
    const patterns = parseSimpleYamlArray(content, 'packages');
    if (!patterns || patterns.length === 0) {
      return null;
    }

    const workspaces = await resolveWorkspacePatterns(fileSource, rootPath, patterns);

    return {
      type: 'pnpm-workspaces',
      rootPath,
      workspaces,
      patterns,
    };
  } catch {
    return null;
  }
}

/**
 * Detect Turborepo
 */
async function detectTurborepo(
  fileSource: FileSource,
  rootPath: string
): Promise<MonorepoConfig | null> {
  try {
    const turboPath = rootPath ? `${rootPath}/turbo.json` : 'turbo.json';

    if (!(await fileSource.exists(turboPath))) {
      return null;
    }

    // Turborepo uses npm/yarn/pnpm workspaces under the hood
    // So we need to also detect the workspace config
    const npmResult = await detectNpmWorkspaces(fileSource, rootPath);
    const pnpmResult = await detectPnpmWorkspaces(fileSource, rootPath);

    const baseResult = npmResult || pnpmResult;
    if (!baseResult) {
      return null;
    }

    return {
      ...baseResult,
      type: 'turborepo',
    };
  } catch {
    return null;
  }
}

/**
 * Detect Nx
 */
async function detectNx(
  fileSource: FileSource,
  rootPath: string
): Promise<MonorepoConfig | null> {
  try {
    const nxPath = rootPath ? `${rootPath}/nx.json` : 'nx.json';

    if (!(await fileSource.exists(nxPath))) {
      return null;
    }

    // Nx can use npm/yarn/pnpm workspaces or its own structure
    const npmResult = await detectNpmWorkspaces(fileSource, rootPath);
    const pnpmResult = await detectPnpmWorkspaces(fileSource, rootPath);

    const baseResult = npmResult || pnpmResult;

    if (baseResult) {
      return {
        ...baseResult,
        type: 'nx',
      };
    }

    // Try to detect Nx-specific structure (apps/, libs/)
    const workspaces: WorkspaceInfo[] = [];

    // Check apps/ directory
    if (await fileSource.isDirectory(rootPath ? `${rootPath}/apps` : 'apps')) {
      const apps = await fileSource.readdir(rootPath ? `${rootPath}/apps` : 'apps');
      for (const app of apps) {
        const appPath = rootPath ? `${rootPath}/apps/${app}` : `apps/${app}`;
        if (await fileSource.isDirectory(appPath)) {
          workspaces.push({
            name: app,
            path: `apps/${app}`,
          });
        }
      }
    }

    // Check packages/ directory
    if (await fileSource.isDirectory(rootPath ? `${rootPath}/packages` : 'packages')) {
      const packages = await fileSource.readdir(rootPath ? `${rootPath}/packages` : 'packages');
      for (const pkg of packages) {
        const pkgPath = rootPath ? `${rootPath}/packages/${pkg}` : `packages/${pkg}`;
        if (await fileSource.isDirectory(pkgPath)) {
          workspaces.push({
            name: pkg,
            path: `packages/${pkg}`,
          });
        }
      }
    }

    if (workspaces.length === 0) {
      return null;
    }

    return {
      type: 'nx',
      rootPath,
      workspaces,
    };
  } catch {
    return null;
  }
}

/**
 * Detect Lerna
 */
async function detectLerna(
  fileSource: FileSource,
  rootPath: string
): Promise<MonorepoConfig | null> {
  try {
    const lernaPath = rootPath ? `${rootPath}/lerna.json` : 'lerna.json';

    if (!(await fileSource.exists(lernaPath))) {
      return null;
    }

    const content = await fileSource.read(lernaPath);
    const lerna = JSON.parse(content);

    const patterns = lerna.packages || ['packages/*'];
    const workspaces = await resolveWorkspacePatterns(fileSource, rootPath, patterns);

    return {
      type: 'lerna',
      rootPath,
      workspaces,
      patterns,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve workspace patterns to actual workspace paths
 */
async function resolveWorkspacePatterns(
  fileSource: FileSource,
  rootPath: string,
  patterns: string[]
): Promise<WorkspaceInfo[]> {
  const workspaces: WorkspaceInfo[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Simple glob resolution - handle common patterns like "packages/*"
    if (pattern.endsWith('/*')) {
      const baseDir = pattern.slice(0, -2);
      const fullDir = rootPath ? `${rootPath}/${baseDir}` : baseDir;

      try {
        if (await fileSource.isDirectory(fullDir)) {
          const entries = await fileSource.readdir(fullDir);
          for (const entry of entries) {
            const entryPath = `${baseDir}/${entry}`;
            const fullEntryPath = rootPath ? `${rootPath}/${entryPath}` : entryPath;

            if (await fileSource.isDirectory(fullEntryPath)) {
              if (!seen.has(entryPath)) {
                seen.add(entryPath);

                // Try to get package name from package.json
                let name = entry;
                try {
                  const pkgContent = await fileSource.read(`${fullEntryPath}/package.json`);
                  const pkg = JSON.parse(pkgContent);
                  if (pkg.name) {
                    name = pkg.name;
                  }
                } catch {
                  // Use directory name as fallback
                }

                workspaces.push({
                  name,
                  path: entryPath,
                });
              }
            }
          }
        }
      } catch {
        // Pattern doesn't match, skip
      }
    } else if (pattern.includes('*')) {
      // More complex glob - use fileSource.glob if available
      try {
        const matches = await fileSource.glob(pattern, rootPath);
        for (const match of matches) {
          if (!seen.has(match)) {
            seen.add(match);
            workspaces.push({
              name: match.split('/').pop() || match,
              path: match,
            });
          }
        }
      } catch {
        // Glob not supported or pattern doesn't match
      }
    } else {
      // Direct path
      const fullPath = rootPath ? `${rootPath}/${pattern}` : pattern;
      try {
        if (await fileSource.isDirectory(fullPath)) {
          if (!seen.has(pattern)) {
            seen.add(pattern);

            let name = pattern.split('/').pop() || pattern;
            try {
              const pkgContent = await fileSource.read(`${fullPath}/package.json`);
              const pkg = JSON.parse(pkgContent);
              if (pkg.name) {
                name = pkg.name;
              }
            } catch {
              // Use directory name
            }

            workspaces.push({
              name,
              path: pattern,
            });
          }
        }
      } catch {
        // Path doesn't exist
      }
    }
  }

  return workspaces;
}

/**
 * Simple YAML array parser for pnpm-workspace.yaml
 */
function parseSimpleYamlArray(content: string, key: string): string[] | null {
  const lines = content.split('\n');
  const patterns: string[] = [];
  let inPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === `${key}:`) {
      inPackages = true;
      continue;
    }

    if (inPackages) {
      if (trimmed.startsWith('- ')) {
        // Array item
        let value = trimmed.slice(2).trim();
        // Remove quotes if present
        if ((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1);
        }
        patterns.push(value);
      } else if (!trimmed.startsWith('#') && trimmed !== '' && !trimmed.startsWith('  ')) {
        // End of array
        break;
      }
    }
  }

  return patterns.length > 0 ? patterns : null;
}

/**
 * Find a specific workspace by name or path
 */
export function findWorkspace(
  config: MonorepoConfig,
  nameOrPath: string
): WorkspaceInfo | undefined {
  return config.workspaces.find(
    (w) => w.name === nameOrPath || w.path === nameOrPath || w.path.endsWith(`/${nameOrPath}`)
  );
}

/**
 * Filter workspaces that likely contain visual components
 */
export async function filterVisualWorkspaces(
  fileSource: FileSource,
  config: MonorepoConfig
): Promise<WorkspaceInfo[]> {
  const visual: WorkspaceInfo[] = [];

  for (const workspace of config.workspaces) {
    const wsPath = config.rootPath ? `${config.rootPath}/${workspace.path}` : workspace.path;

    // Check for common visual component indicators
    const hasPages =
      (await fileSource.isDirectory(`${wsPath}/pages`)) ||
      (await fileSource.isDirectory(`${wsPath}/src/routes`)) ||
      (await fileSource.isDirectory(`${wsPath}/app`));

    const hasComponents =
      (await fileSource.isDirectory(`${wsPath}/components`)) ||
      (await fileSource.isDirectory(`${wsPath}/src/components`));

    if (hasPages || hasComponents) {
      visual.push({
        ...workspace,
        hasVisualComponents: true,
      });
    }
  }

  return visual;
}
