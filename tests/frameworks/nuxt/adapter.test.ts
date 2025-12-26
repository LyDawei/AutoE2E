import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { NuxtAdapter } from '../../../src/frameworks/nuxt/adapter.js';
import { LocalFileSource } from '../../../src/frameworks/file-source.js';
import type { AdapterContext } from '../../../src/frameworks/types.js';

describe('NuxtAdapter', () => {
  let tempDir: string;
  let adapter: NuxtAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yokohama-nuxt-test-'));
    adapter = new NuxtAdapter();
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
    it('returns high confidence with all indicators', async () => {
      writeFile('nuxt.config.ts', 'export default defineNuxtConfig({})');
      writeFile('pages/index.vue', '<template><div>Home</div></template>');
      writeFile('package.json', JSON.stringify({
        dependencies: { nuxt: '^3.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('nuxt');
      expect(result.confidence).toBe('high');
    });

    it('detects nuxt.config.js', async () => {
      writeFile('nuxt.config.js', 'export default {}');
      writeFile('pages/index.vue', '<template><div>Home</div></template>');
      writeFile('package.json', JSON.stringify({
        dependencies: { nuxt: '^3.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.confidence).toBe('high');
    });

    it('detects nuxt.config.mjs', async () => {
      writeFile('nuxt.config.mjs', 'export default {}');
      writeFile('pages/index.vue', '<template><div>Home</div></template>');
      writeFile('package.json', JSON.stringify({
        dependencies: { nuxt: '^3.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.confidence).toBe('high');
    });

    it('returns medium confidence with 2 indicators', async () => {
      writeFile('nuxt.config.ts', 'export default defineNuxtConfig({})');
      writeFile('pages/index.vue', '<template><div>Home</div></template>');
      writeFile('package.json', JSON.stringify({ dependencies: {} }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('nuxt');
      expect(result.confidence).toBe('medium');
    });

    it('returns none for non-Nuxt project', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: {} }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBeNull();
      expect(result.confidence).toBe('none');
    });

    it('extracts version from package.json', async () => {
      writeFile('nuxt.config.ts', 'export default defineNuxtConfig({})');
      writeFile('pages/index.vue', '<template><div>Home</div></template>');
      writeFile('package.json', JSON.stringify({
        dependencies: { nuxt: '^3.8.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.version).toBe('^3.8.0');
    });
  });

  describe('discoverRoutes', () => {
    it('discovers root index.vue', async () => {
      writeFile('pages/index.vue', '<template><div>Home</div></template>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/');
    });

    it('discovers nested routes', async () => {
      writeFile('pages/index.vue', '<template><div>Home</div></template>');
      writeFile('pages/about.vue', '<template><div>About</div></template>');
      writeFile('pages/blog/index.vue', '<template><div>Blog</div></template>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/', '/about', '/blog']);
    });

    it('handles dynamic routes [param]', async () => {
      writeFile('pages/blog/[slug].vue', '<template><div>Post</div></template>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].path).toBe('/blog/:slug');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('handles catch-all [...slug]', async () => {
      writeFile('pages/docs/[...slug].vue', '<template><div>Docs</div></template>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].path).toBe('/docs/:slug*');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('handles optional params [[id]]', async () => {
      writeFile('pages/users/[[id]].vue', '<template><div>User</div></template>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].path).toBe('/users/:id?');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('filters out route groups from URL', async () => {
      writeFile('pages/(marketing)/index.vue', '<template><div>Home</div></template>');
      writeFile('pages/(marketing)/pricing.vue', '<template><div>Pricing</div></template>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/', '/pricing']);
    });

    it('extracts route group name', async () => {
      writeFile('pages/(auth)/login.vue', '<template><div>Login</div></template>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].group).toBe('auth');
    });

    it('detects layout presence', async () => {
      writeFile('layouts/default.vue', '<template><slot /></template>');
      writeFile('pages/index.vue', '<template><div>Home</div></template>');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].hasLayout).toBe(true);
    });

    it('returns empty array when no pages directory', async () => {
      writeFile('package.json', '{}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toEqual([]);
    });
  });

  describe('isRouteFile', () => {
    it('returns true for .vue files in pages/', () => {
      // isRouteFile checks for '/pages/' in the path
      expect(adapter.isRouteFile('src/pages/index.vue')).toBe(true);
      expect(adapter.isRouteFile('src/pages/about.vue')).toBe(true);
      expect(adapter.isRouteFile('src/pages/blog/[slug].vue')).toBe(true);
    });

    it('returns false for .vue files outside pages/', () => {
      expect(adapter.isRouteFile('components/Button.vue')).toBe(false);
    });
  });

  describe('isLayoutFile', () => {
    it('returns true for .vue files in layouts/', () => {
      // isLayoutFile checks for '/layouts/' in the path
      expect(adapter.isLayoutFile('src/layouts/default.vue')).toBe(true);
      expect(adapter.isLayoutFile('src/layouts/auth.vue')).toBe(true);
    });

    it('returns false for non-layout files', () => {
      expect(adapter.isLayoutFile('src/pages/index.vue')).toBe(false);
    });
  });

  describe('adapter properties', () => {
    it('has correct name', () => {
      expect(adapter.name).toBe('nuxt');
    });

    it('has correct displayName', () => {
      expect(adapter.displayName).toBe('Nuxt');
    });

    it('has correct routes directory', () => {
      expect(adapter.getRoutesDirectory()).toBe('pages');
    });

    it('has correct page extensions', () => {
      expect(adapter.pageExtensions).toContain('.vue');
    });

    it('has correct import aliases', () => {
      const aliases = adapter.importAliases;
      expect(aliases.some(a => a.pattern === '~/')).toBe(true);
      expect(aliases.some(a => a.pattern === '@/')).toBe(true);
      expect(aliases.some(a => a.pattern === '#imports')).toBe(true);
    });
  });
});
