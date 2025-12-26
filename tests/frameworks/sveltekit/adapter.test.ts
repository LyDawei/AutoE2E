import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SvelteKitAdapter } from '../../../src/frameworks/sveltekit/adapter.js';
import { LocalFileSource } from '../../../src/frameworks/file-source.js';
import type { AdapterContext } from '../../../src/frameworks/types.js';

describe('SvelteKitAdapter', () => {
  let tempDir: string;
  let adapter: SvelteKitAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yokohama-sveltekit-test-'));
    adapter = new SvelteKitAdapter();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createContext(): AdapterContext {
    return {
      fileSource: new LocalFileSource(tempDir),
      projectRoot: '',
    };
  }

  function writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  describe('detect', () => {
    it('returns high confidence when all indicators present', async () => {
      writeFile('svelte.config.js', 'export default {}');
      writeFile('src/routes/+page.svelte', '<h1>Home</h1>');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@sveltejs/kit': '^2.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('sveltekit');
      expect(result.confidence).toBe('high');
    });

    it('returns medium confidence with 2 indicators', async () => {
      writeFile('svelte.config.js', 'export default {}');
      writeFile('src/routes/+page.svelte', '<h1>Home</h1>');
      writeFile('package.json', JSON.stringify({ dependencies: {} }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('sveltekit');
      expect(result.confidence).toBe('medium');
    });

    it('returns low confidence with 1 indicator', async () => {
      writeFile('svelte.config.js', 'export default {}');
      writeFile('package.json', JSON.stringify({ dependencies: {} }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('sveltekit');
      expect(result.confidence).toBe('low');
    });

    it('returns none confidence with no indicators', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: {} }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBeNull();
      expect(result.confidence).toBe('none');
    });

    it('detects svelte.config.ts as config file', async () => {
      writeFile('svelte.config.ts', 'export default {}');
      writeFile('src/routes/+page.svelte', '<h1>Home</h1>');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@sveltejs/kit': '^2.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('sveltekit');
      expect(result.confidence).toBe('high');
    });

    it('extracts version from package.json', async () => {
      writeFile('svelte.config.js', 'export default {}');
      writeFile('src/routes/+page.svelte', '<h1>Home</h1>');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@sveltejs/kit': '^2.5.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.version).toBe('^2.5.0');
    });
  });

  describe('discoverRoutes', () => {
    it('discovers root route', async () => {
      writeFile('src/routes/+page.svelte', '<h1>Home</h1>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/');
      expect(routes[0].pageFiles).toContain('+page.svelte');
    });

    it('discovers nested routes', async () => {
      writeFile('src/routes/+page.svelte', '<h1>Home</h1>');
      writeFile('src/routes/about/+page.svelte', '<h1>About</h1>');
      writeFile('src/routes/blog/posts/+page.svelte', '<h1>Posts</h1>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(3);
      expect(routes.map(r => r.path).sort()).toEqual(['/', '/about', '/blog/posts']);
    });

    it('handles dynamic routes with [param]', async () => {
      writeFile('src/routes/blog/[slug]/+page.svelte', '<h1>Post</h1>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/blog/[slug]');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('handles catch-all routes with [...rest]', async () => {
      writeFile('src/routes/docs/[...path]/+page.svelte', '<h1>Docs</h1>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/docs/[...path]');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('filters out route groups from URL path', async () => {
      writeFile('src/routes/(marketing)/+page.svelte', '<h1>Home</h1>');
      writeFile('src/routes/(marketing)/pricing/+page.svelte', '<h1>Pricing</h1>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(2);
      expect(routes.map(r => r.path).sort()).toEqual(['/', '/pricing']);
    });

    it('extracts route group name', async () => {
      writeFile('src/routes/(auth)/login/+page.svelte', '<h1>Login</h1>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].group).toBe('auth');
    });

    it('detects auth-protected routes', async () => {
      writeFile('src/routes/(auth)/dashboard/+page.svelte', '<h1>Dashboard</h1>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].isAuthProtected).toBe(true);
    });

    it('detects layout presence', async () => {
      writeFile('src/routes/dashboard/+layout.svelte', '<slot />');
      writeFile('src/routes/dashboard/+page.svelte', '<h1>Dashboard</h1>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].hasLayout).toBe(true);
    });

    it('collects multiple page files', async () => {
      writeFile('src/routes/api-route/+page.svelte', '<h1>Page</h1>');
      writeFile('src/routes/api-route/+page.ts', 'export const load = () => ({});');
      writeFile('src/routes/api-route/+page.server.ts', 'export const load = () => ({});');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].pageFiles).toContain('+page.svelte');
      expect(routes[0].pageFiles).toContain('+page.ts');
      expect(routes[0].pageFiles).toContain('+page.server.ts');
    });

    it('returns empty array when no routes directory', async () => {
      writeFile('package.json', '{}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toEqual([]);
    });
  });

  describe('isRouteFile', () => {
    it('returns true for +page files', () => {
      expect(adapter.isRouteFile('src/routes/+page.svelte')).toBe(true);
      expect(adapter.isRouteFile('src/routes/+page.ts')).toBe(true);
      expect(adapter.isRouteFile('src/routes/+page.server.ts')).toBe(true);
    });

    it('returns true for +error files', () => {
      expect(adapter.isRouteFile('src/routes/+error.svelte')).toBe(true);
    });

    it('returns true for +server files', () => {
      expect(adapter.isRouteFile('src/routes/+server.ts')).toBe(true);
    });

    it('returns false for layout files', () => {
      expect(adapter.isRouteFile('src/routes/+layout.svelte')).toBe(false);
    });

    it('returns false for regular component files', () => {
      expect(adapter.isRouteFile('src/lib/Button.svelte')).toBe(false);
    });
  });

  describe('isLayoutFile', () => {
    it('returns true for +layout files', () => {
      expect(adapter.isLayoutFile('src/routes/+layout.svelte')).toBe(true);
      expect(adapter.isLayoutFile('src/routes/+layout.ts')).toBe(true);
      expect(adapter.isLayoutFile('src/routes/+layout.server.ts')).toBe(true);
    });

    it('returns false for page files', () => {
      expect(adapter.isLayoutFile('src/routes/+page.svelte')).toBe(false);
    });
  });

  describe('getRoutesDirectory', () => {
    it('returns src/routes', () => {
      expect(adapter.getRoutesDirectory()).toBe('src/routes');
    });
  });

  describe('adapter properties', () => {
    it('has correct name', () => {
      expect(adapter.name).toBe('sveltekit');
    });

    it('has correct displayName', () => {
      expect(adapter.displayName).toBe('SvelteKit');
    });

    it('has correct pageExtensions', () => {
      expect(adapter.pageExtensions).toContain('.svelte');
    });

    it('has correct import aliases', () => {
      const aliases = adapter.importAliases;
      expect(aliases.some(a => a.pattern === '$lib/')).toBe(true);
      expect(aliases.some(a => a.pattern === '$app/' && a.isInternal)).toBe(true);
    });
  });
});
