import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileSource } from './types.js';
import type { GitHubClient } from '../github/client.js';

/**
 * Local filesystem implementation of FileSource
 */
export class LocalFileSource implements FileSource {
  constructor(private rootPath: string) {}

  async exists(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.rootPath, filePath);
    return fs.existsSync(fullPath);
  }

  async read(filePath: string): Promise<string> {
    const fullPath = path.join(this.rootPath, filePath);
    return fs.readFileSync(fullPath, 'utf-8');
  }

  async readdir(dirPath: string): Promise<string[]> {
    const fullPath = path.join(this.rootPath, dirPath);
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath);
  }

  async isDirectory(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.rootPath, filePath);
    if (!fs.existsSync(fullPath)) return false;
    return fs.statSync(fullPath).isDirectory();
  }

  async glob(pattern: string, basePath?: string): Promise<string[]> {
    // Simple glob implementation using recursive directory scan
    const searchPath = basePath ? path.join(this.rootPath, basePath) : this.rootPath;
    const files: string[] = [];

    const scanDir = (dir: string, relativePath: string = ''): void => {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip node_modules and hidden directories
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            scanDir(fullPath, entryRelPath);
          }
        } else if (entry.isFile()) {
          if (this.matchesGlob(entryRelPath, pattern)) {
            files.push(entryRelPath);
          }
        }
      }
    };

    scanDir(searchPath);
    return files;
  }

  /**
   * Simple glob pattern matching
   */
  private matchesGlob(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<GLOBSTAR>>>/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
}

/**
 * GitHub API implementation of FileSource with caching
 */
export class GitHubFileSource implements FileSource {
  private fileCache = new Map<string, string>();
  private dirCache = new Map<string, string[]>();
  private existsCache = new Map<string, boolean>();
  private isDirCache = new Map<string, boolean>();

  constructor(
    private client: GitHubClient,
    private owner: string,
    private repo: string,
    private ref: string
  ) {}

  private getCacheKey(filePath: string): string {
    return `${this.owner}/${this.repo}/${this.ref}/${filePath}`;
  }

  async exists(filePath: string): Promise<boolean> {
    const cacheKey = this.getCacheKey(filePath);

    if (this.existsCache.has(cacheKey)) {
      return this.existsCache.get(cacheKey)!;
    }

    try {
      await this.read(filePath);
      this.existsCache.set(cacheKey, true);
      return true;
    } catch {
      // Could be a directory, try that
      try {
        await this.readdir(filePath);
        this.existsCache.set(cacheKey, true);
        return true;
      } catch {
        this.existsCache.set(cacheKey, false);
        return false;
      }
    }
  }

  async read(filePath: string): Promise<string> {
    const cacheKey = this.getCacheKey(filePath);

    if (this.fileCache.has(cacheKey)) {
      return this.fileCache.get(cacheKey)!;
    }

    const content = await this.client.getFileContent(this.owner, this.repo, filePath, this.ref);
    this.fileCache.set(cacheKey, content);
    this.existsCache.set(cacheKey, true);
    this.isDirCache.set(cacheKey, false);
    return content;
  }

  async readdir(dirPath: string): Promise<string[]> {
    const cacheKey = this.getCacheKey(dirPath);

    if (this.dirCache.has(cacheKey)) {
      return this.dirCache.get(cacheKey)!;
    }

    const contents = await this.client.getDirectoryContents(
      this.owner,
      this.repo,
      dirPath,
      this.ref
    );
    this.dirCache.set(cacheKey, contents.map((c) => c.name));
    this.existsCache.set(cacheKey, true);
    this.isDirCache.set(cacheKey, true);

    // Cache individual file/dir existence
    for (const item of contents) {
      const itemPath = dirPath ? `${dirPath}/${item.name}` : item.name;
      const itemCacheKey = this.getCacheKey(itemPath);
      this.existsCache.set(itemCacheKey, true);
      this.isDirCache.set(itemCacheKey, item.type === 'dir');
    }

    return contents.map((c) => c.name);
  }

  async isDirectory(filePath: string): Promise<boolean> {
    const cacheKey = this.getCacheKey(filePath);

    if (this.isDirCache.has(cacheKey)) {
      return this.isDirCache.get(cacheKey)!;
    }

    // Try to read as directory
    try {
      await this.readdir(filePath);
      this.isDirCache.set(cacheKey, true);
      return true;
    } catch {
      this.isDirCache.set(cacheKey, false);
      return false;
    }
  }

  async glob(pattern: string, basePath?: string): Promise<string[]> {
    // For remote, we need to recursively fetch directories
    // This is expensive, so we only fetch what's needed
    const files: string[] = [];
    const searchPath = basePath || '';
    const maxDepth = 20; // Prevent infinite recursion
    const visited = new Set<string>(); // Cycle detection

    const scanDir = async (dirPath: string, depth: number): Promise<void> => {
      // Prevent infinite recursion
      if (depth > maxDepth) {
        return;
      }

      // Cycle detection
      if (visited.has(dirPath)) {
        return;
      }
      visited.add(dirPath);

      try {
        const entries = await this.readdir(dirPath);

        for (const entry of entries) {
          const entryPath = dirPath ? `${dirPath}/${entry}` : entry;

          // Skip hidden and node_modules
          if (entry.startsWith('.') || entry === 'node_modules') {
            continue;
          }

          const isDir = await this.isDirectory(entryPath);

          if (isDir) {
            // Check if pattern could match files in this directory
            if (this.couldMatchInDirectory(entryPath, pattern)) {
              await scanDir(entryPath, depth + 1);
            }
          } else {
            if (this.matchesGlob(entryPath, pattern)) {
              files.push(entryPath);
            }
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    };

    await scanDir(searchPath, 0);
    return files;
  }

  /**
   * Check if a pattern could potentially match files in a directory
   */
  private couldMatchInDirectory(dirPath: string, pattern: string): boolean {
    // If pattern starts with the directory path, it could match
    if (pattern.startsWith(dirPath)) return true;

    // If pattern uses **, it could match anywhere
    if (pattern.includes('**')) return true;

    // Check if directory is part of the pattern path
    const patternParts = pattern.split('/');
    const dirParts = dirPath.split('/');

    for (let i = 0; i < Math.min(patternParts.length, dirParts.length); i++) {
      const patternPart = patternParts[i];
      const dirPart = dirParts[i];

      if (patternPart === '**') return true;
      if (patternPart === '*') continue;
      if (patternPart !== dirPart && !patternPart.includes('*')) return false;
    }

    return true;
  }

  /**
   * Simple glob pattern matching
   */
  private matchesGlob(filePath: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<GLOBSTAR>>>/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.fileCache.clear();
    this.dirCache.clear();
    this.existsCache.clear();
    this.isDirCache.clear();
  }

  /**
   * Get cache statistics for debugging
   */
  getCacheStats(): { files: number; dirs: number; exists: number; isDir: number } {
    return {
      files: this.fileCache.size,
      dirs: this.dirCache.size,
      exists: this.existsCache.size,
      isDir: this.isDirCache.size,
    };
  }
}

/**
 * Create a file source based on whether we have a local path or GitHub info
 */
export function createFileSource(
  options:
    | { type: 'local'; rootPath: string }
    | { type: 'github'; client: GitHubClient; owner: string; repo: string; ref: string }
): FileSource {
  if (options.type === 'local') {
    return new LocalFileSource(options.rootPath);
  }
  return new GitHubFileSource(options.client, options.owner, options.repo, options.ref);
}
