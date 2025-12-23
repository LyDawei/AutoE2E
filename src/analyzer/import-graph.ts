import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ImportGraph } from './types.js';

/**
 * Build an import graph for a SvelteKit project
 */
export function buildImportGraph(projectRoot: string): ImportGraph {
  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();

  const srcDir = path.join(projectRoot, 'src');
  if (!fs.existsSync(srcDir)) {
    return { imports, importedBy };
  }

  // Scan all source files
  const files = getAllSourceFiles(srcDir);

  for (const file of files) {
    const relativePath = path.relative(projectRoot, file);
    const content = fs.readFileSync(file, 'utf-8');
    const fileImports = extractImports(content, file, projectRoot);

    imports.set(relativePath, fileImports);

    // Build reverse lookup
    for (const imported of fileImports) {
      const existingImporters = importedBy.get(imported) || [];
      existingImporters.push(relativePath);
      importedBy.set(imported, existingImporters);
    }
  }

  return { imports, importedBy };
}

/**
 * Get all source files in a directory (recursive)
 */
function getAllSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const extensions = ['.svelte', '.ts', '.js', '.tsx', '.jsx'];

  function scan(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          scan(fullPath);
        }
      } else if (entry.isFile()) {
        if (extensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    }
  }

  scan(dir);
  return files;
}

/**
 * Extract imports from file content
 */
export function extractImports(content: string, filePath: string, projectRoot: string): string[] {
  const imports: string[] = [];

  // Match ES6 imports: import X from 'path', import { X } from 'path', import 'path'
  const importRegex =
    /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;

  // Match dynamic imports: import('path')
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = resolveImportPath(match[1], filePath, projectRoot);
    if (importPath) {
      imports.push(importPath);
    }
  }

  while ((match = dynamicImportRegex.exec(content)) !== null) {
    const importPath = resolveImportPath(match[1], filePath, projectRoot);
    if (importPath) {
      imports.push(importPath);
    }
  }

  return [...new Set(imports)];
}

/**
 * Resolve an import path to a project-relative path
 */
function resolveImportPath(
  importPath: string,
  fromFile: string,
  projectRoot: string
): string | null {
  // Skip external packages
  if (!importPath.startsWith('.') && !importPath.startsWith('$') && !importPath.startsWith('/')) {
    return null;
  }

  let resolvedPath: string;

  // Handle SvelteKit aliases
  if (importPath.startsWith('$lib')) {
    resolvedPath = path.join(projectRoot, 'src', 'lib', importPath.slice(5));
  } else if (importPath.startsWith('$app')) {
    // SvelteKit internal - skip
    return null;
  } else if (importPath.startsWith('$env')) {
    // SvelteKit env - skip
    return null;
  } else if (importPath.startsWith('.')) {
    // Relative import
    resolvedPath = path.resolve(path.dirname(fromFile), importPath);
  } else {
    // Other aliases or absolute paths
    return null;
  }

  // Try to resolve the actual file
  const resolved = resolveToActualFile(resolvedPath);
  if (resolved) {
    return path.relative(projectRoot, resolved);
  }

  return null;
}

/**
 * Resolve a path to an actual file (handle extensions and index files)
 */
function resolveToActualFile(basePath: string): string | null {
  const extensions = ['', '.svelte', '.ts', '.js', '.tsx', '.jsx'];
  const indexFiles = ['index.svelte', 'index.ts', 'index.js', '+page.svelte'];

  // Try with extensions
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }

  // Try as directory with index file
  if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
    for (const indexFile of indexFiles) {
      const indexPath = path.join(basePath, indexFile);
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }
  }

  return null;
}

/**
 * Find all files that import a given file (direct only)
 */
export function findDirectDependents(filePath: string, graph: ImportGraph): string[] {
  return graph.importedBy.get(filePath) || [];
}

/**
 * Find all files that import a given file (transitive)
 */
export function findAllDependents(
  filePath: string,
  graph: ImportGraph,
  visited: Set<string> = new Set()
): string[] {
  if (visited.has(filePath)) {
    return [];
  }
  visited.add(filePath);

  const directDependents = graph.importedBy.get(filePath) || [];
  const allDependents = [...directDependents];

  for (const dependent of directDependents) {
    const transitiveDependents = findAllDependents(dependent, graph, visited);
    allDependents.push(...transitiveDependents);
  }

  return [...new Set(allDependents)];
}

/**
 * Get all files imported by a given file (transitive)
 */
export function findAllDependencies(
  filePath: string,
  graph: ImportGraph,
  visited: Set<string> = new Set()
): string[] {
  if (visited.has(filePath)) {
    return [];
  }
  visited.add(filePath);

  const directDependencies = graph.imports.get(filePath) || [];
  const allDependencies = [...directDependencies];

  for (const dependency of directDependencies) {
    const transitiveDependencies = findAllDependencies(dependency, graph, visited);
    allDependencies.push(...transitiveDependencies);
  }

  return [...new Set(allDependencies)];
}
