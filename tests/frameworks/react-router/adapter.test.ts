import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ReactRouterAdapter } from '../../../src/frameworks/react-router/adapter.js';
import { LocalFileSource } from '../../../src/frameworks/file-source.js';
import type { AdapterContext } from '../../../src/frameworks/types.js';

describe('ReactRouterAdapter', () => {
  let tempDir: string;
  let adapter: ReactRouterAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yokohama-react-router-test-'));
    adapter = new ReactRouterAdapter();
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
    it('returns high confidence with app/routes and react-router dep', async () => {
      writeFile('app/routes/_index.tsx', 'export default function Index() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { 'react-router': '^7.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('react-router');
      expect(result.confidence).toBe('high');
    });

    it('detects react-router-dom dependency', async () => {
      writeFile('app/routes/_index.tsx', 'export default function Index() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { 'react-router-dom': '^6.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('react-router');
      expect(result.confidence).toBe('high');
    });

    it('detects @react-router/dev dependency', async () => {
      writeFile('app/routes/_index.tsx', 'export default function Index() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@react-router/dev': '^7.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('react-router');
      expect(result.confidence).toBe('high');
    });

    it('returns none when Remix is present', async () => {
      writeFile('app/routes/_index.tsx', 'export default function Index() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: {
          'react-router': '^6.0.0',
          '@remix-run/react': '^2.0.0'
        }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBeNull();
      expect(result.confidence).toBe('none');
      expect(result.reason).toContain('Remix');
    });

    it('returns low confidence without routes directory', async () => {
      writeFile('package.json', JSON.stringify({
        dependencies: { 'react-router': '^6.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('react-router');
      expect(result.confidence).toBe('low');
    });

    it('returns none for non-React Router project', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: {} }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBeNull();
      expect(result.confidence).toBe('none');
    });
  });

  describe('discoverRoutes', () => {
    it('discovers _index route as root', async () => {
      writeFile('app/routes/_index.tsx', 'export default function Index() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/');
    });

    it('discovers flat file routes', async () => {
      writeFile('app/routes/_index.tsx', 'export default function Index() {}');
      writeFile('app/routes/about.tsx', 'export default function About() {}');
      writeFile('app/routes/contact.tsx', 'export default function Contact() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/', '/about', '/contact']);
    });

    it('converts dots to path segments', async () => {
      writeFile('app/routes/blog.posts.tsx', 'export default function Posts() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].path).toBe('/blog/posts');
    });

    it('handles dynamic segments with $param', async () => {
      writeFile('app/routes/blog.$slug.tsx', 'export default function Post() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].path).toBe('/blog/:slug');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('handles catch-all with $.tsx', async () => {
      writeFile('app/routes/$.tsx', 'export default function CatchAll() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].path).toBe('/*');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('handles escaped dots', async () => {
      writeFile('app/routes/sitemap_.xml.tsx', 'export default function Sitemap() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].path).toBe('/sitemap.xml');
    });

    it('discovers folder-based routes with route.tsx', async () => {
      writeFile('app/routes/dashboard/route.tsx', 'export default function Dashboard() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/dashboard');
    });

    it('detects layout in folder routes', async () => {
      writeFile('app/routes/dashboard/route.tsx', 'export default function Dashboard() {}');
      writeFile('app/routes/dashboard/layout.tsx', 'export default function Layout() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].hasLayout).toBe(true);
    });

    it('recursively discovers nested folder routes', async () => {
      writeFile('app/routes/dashboard/route.tsx', 'export default function Dashboard() {}');
      writeFile('app/routes/dashboard/settings/route.tsx', 'export default function Settings() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/dashboard', '/dashboard/settings']);
    });

    it('returns empty array when no routes directory', async () => {
      writeFile('package.json', '{}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toEqual([]);
    });
  });

  describe('isRouteFile', () => {
    it('returns true for route.tsx', () => {
      expect(adapter.isRouteFile('app/routes/dashboard/route.tsx')).toBe(true);
    });

    it('returns true for flat file routes', () => {
      expect(adapter.isRouteFile('app/routes/about.tsx')).toBe(true);
    });

    it('returns false for _layout files', () => {
      expect(adapter.isRouteFile('app/routes/_layout.tsx')).toBe(false);
    });
  });

  describe('isLayoutFile', () => {
    it('returns true for layout.tsx', () => {
      expect(adapter.isLayoutFile('app/routes/dashboard/layout.tsx')).toBe(true);
    });

    it('returns true for _layout.tsx', () => {
      expect(adapter.isLayoutFile('app/routes/_layout.tsx')).toBe(true);
    });

    it('returns false for route files', () => {
      expect(adapter.isLayoutFile('app/routes/about.tsx')).toBe(false);
    });
  });

  describe('adapter properties', () => {
    it('has correct name', () => {
      expect(adapter.name).toBe('react-router');
    });

    it('has correct displayName', () => {
      expect(adapter.displayName).toBe('React Router');
    });

    it('has correct routes directory', () => {
      expect(adapter.getRoutesDirectory()).toBe('app/routes');
    });

    it('has correct page extensions', () => {
      expect(adapter.pageExtensions).toContain('.tsx');
      expect(adapter.pageExtensions).toContain('.jsx');
    });

    it('has correct import aliases', () => {
      const aliases = adapter.importAliases;
      expect(aliases.some(a => a.pattern === '~/')).toBe(true);
      expect(aliases.some(a => a.pattern === '@/')).toBe(true);
    });
  });
});
