import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { NextJsAdapter } from '../../../src/frameworks/nextjs/adapter.js';
import { LocalFileSource } from '../../../src/frameworks/file-source.js';
import type { AdapterContext } from '../../../src/frameworks/types.js';

describe('NextJsAdapter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yokohama-nextjs-test-'));
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

  describe('App Router detection', () => {
    it('detects App Router with high confidence', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('next.config.js', 'module.exports = {}');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { next: '^14.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('nextjs-app');
      expect(result.confidence).toBe('high');
    });

    it('detects next.config.mjs', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('next.config.mjs', 'export default {}');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { next: '^14.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.confidence).toBe('high');
    });

    it('detects next.config.ts', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('next.config.ts', 'export default {}');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { next: '^14.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.confidence).toBe('high');
    });
  });

  describe('Pages Router detection', () => {
    it('detects Pages Router with high confidence', async () => {
      const adapter = new NextJsAdapter('pages');
      writeFile('next.config.js', 'module.exports = {}');
      writeFile('pages/index.tsx', 'export default function Home() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { next: '^14.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('nextjs-pages');
      expect(result.confidence).toBe('high');
    });
  });

  describe('Hybrid detection', () => {
    it('detects hybrid setup with both routers', async () => {
      const adapter = new NextJsAdapter('hybrid');
      writeFile('next.config.js', 'module.exports = {}');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('pages/legacy.tsx', 'export default function Legacy() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { next: '^14.0.0' }
      }));

      const result = await adapter.detect(createContext());

      expect(result.framework).toBe('nextjs');
      expect(result.confidence).toBe('high');
      expect(result.routerType).toBe('hybrid');
    });
  });

  describe('App Router route discovery', () => {
    it('discovers root route', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/page.tsx', 'export default function Home() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/');
    });

    it('discovers nested routes', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('app/about/page.tsx', 'export default function About() {}');
      writeFile('app/blog/posts/page.tsx', 'export default function Posts() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(3);
      expect(routes.map(r => r.path).sort()).toEqual(['/', '/about', '/blog/posts']);
    });

    it('handles dynamic routes [param]', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/blog/[slug]/page.tsx', 'export default function Post() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/blog/[slug]');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('handles catch-all routes [...slug]', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/docs/[...slug]/page.tsx', 'export default function Docs() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/docs/[...slug]');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('filters out route groups from URL', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/(marketing)/page.tsx', 'export default function Home() {}');
      writeFile('app/(marketing)/pricing/page.tsx', 'export default function Pricing() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/', '/pricing']);
    });

    it('extracts route group name', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/(auth)/login/page.tsx', 'export default function Login() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].group).toBe('auth');
    });

    it('detects layout presence', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/dashboard/layout.tsx', 'export default function Layout() {}');
      writeFile('app/dashboard/page.tsx', 'export default function Dashboard() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].hasLayout).toBe(true);
    });

    it('skips api routes', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('app/api/users/route.ts', 'export async function GET() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/');
    });

    it('skips private folders', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('app/_components/Button.tsx', 'export function Button() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
    });

    it('filters out parallel routes @folder', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/@modal/page.tsx', 'export default function Modal() {}');
      writeFile('app/page.tsx', 'export default function Home() {}');

      const routes = await adapter.discoverRoutes(createContext());

      // Should have home and modal routed to /
      expect(routes.some(r => r.path === '/')).toBe(true);
    });

    it('supports .jsx extension', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/page.jsx', 'export default function Home() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].pageFiles).toContain('page.jsx');
    });

    it('supports .js extension', async () => {
      const adapter = new NextJsAdapter('app');
      writeFile('app/page.js', 'export default function Home() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
    });
  });

  describe('Pages Router route discovery', () => {
    it('discovers index route', async () => {
      const adapter = new NextJsAdapter('pages');
      writeFile('pages/index.tsx', 'export default function Home() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/');
    });

    it('discovers nested routes', async () => {
      const adapter = new NextJsAdapter('pages');
      writeFile('pages/index.tsx', 'export default function Home() {}');
      writeFile('pages/about.tsx', 'export default function About() {}');
      writeFile('pages/blog/index.tsx', 'export default function Blog() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/', '/about', '/blog']);
    });

    it('handles dynamic routes [param]', async () => {
      const adapter = new NextJsAdapter('pages');
      writeFile('pages/blog/[slug].tsx', 'export default function Post() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes[0].path).toBe('/blog/[slug]');
      expect(routes[0].isDynamic).toBe(true);
    });

    it('skips _app and _document', async () => {
      const adapter = new NextJsAdapter('pages');
      writeFile('pages/index.tsx', 'export default function Home() {}');
      writeFile('pages/_app.tsx', 'export default function App() {}');
      writeFile('pages/_document.tsx', 'export default function Document() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/');
    });

    it('skips api routes', async () => {
      const adapter = new NextJsAdapter('pages');
      writeFile('pages/index.tsx', 'export default function Home() {}');
      writeFile('pages/api/users.ts', 'export default function handler() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes).toHaveLength(1);
    });
  });

  describe('Hybrid route discovery', () => {
    it('discovers from both routers', async () => {
      const adapter = new NextJsAdapter('hybrid');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('app/new-feature/page.tsx', 'export default function NewFeature() {}');
      writeFile('pages/legacy.tsx', 'export default function Legacy() {}');

      const routes = await adapter.discoverRoutes(createContext());

      expect(routes.map(r => r.path).sort()).toEqual(['/', '/legacy', '/new-feature']);
    });

    it('app router takes precedence over pages router', async () => {
      const adapter = new NextJsAdapter('hybrid');
      writeFile('app/page.tsx', 'export default function AppHome() {}');
      writeFile('pages/index.tsx', 'export default function PagesHome() {}');

      const routes = await adapter.discoverRoutes(createContext());

      // Should only have one / route (from app)
      const rootRoutes = routes.filter(r => r.path === '/');
      expect(rootRoutes).toHaveLength(1);
    });
  });

  describe('isRouteFile', () => {
    it('returns true for App Router page files', () => {
      const adapter = new NextJsAdapter('app');
      expect(adapter.isRouteFile('app/page.tsx')).toBe(true);
      expect(adapter.isRouteFile('app/about/page.tsx')).toBe(true);
    });

    it('returns true for Pages Router files', () => {
      const adapter = new NextJsAdapter('pages');
      // isRouteFile checks for '/pages/' in the path
      expect(adapter.isRouteFile('src/pages/index.tsx')).toBe(true);
      expect(adapter.isRouteFile('src/pages/about.tsx')).toBe(true);
    });

    it('returns false for _app and _document', () => {
      const adapter = new NextJsAdapter('pages');
      expect(adapter.isRouteFile('src/pages/_app.tsx')).toBe(false);
      expect(adapter.isRouteFile('src/pages/_document.tsx')).toBe(false);
    });
  });

  describe('isLayoutFile', () => {
    it('returns true for App Router layout', () => {
      const adapter = new NextJsAdapter('app');
      expect(adapter.isLayoutFile('app/layout.tsx')).toBe(true);
    });

    it('returns true for Pages Router _app', () => {
      const adapter = new NextJsAdapter('pages');
      expect(adapter.isLayoutFile('pages/_app.tsx')).toBe(true);
    });
  });

  describe('adapter properties', () => {
    it('has correct name for app router', () => {
      const adapter = new NextJsAdapter('app');
      expect(adapter.name).toBe('nextjs-app');
      expect(adapter.displayName).toBe('Next.js (App Router)');
    });

    it('has correct name for pages router', () => {
      const adapter = new NextJsAdapter('pages');
      expect(adapter.name).toBe('nextjs-pages');
      expect(adapter.displayName).toBe('Next.js (Pages Router)');
    });

    it('has correct name for hybrid', () => {
      const adapter = new NextJsAdapter('hybrid');
      expect(adapter.name).toBe('nextjs');
      expect(adapter.displayName).toBe('Next.js');
    });

    it('has correct routes directory for app router', () => {
      const adapter = new NextJsAdapter('app');
      expect(adapter.getRoutesDirectory()).toBe('app');
    });

    it('has correct routes directory for pages router', () => {
      const adapter = new NextJsAdapter('pages');
      expect(adapter.getRoutesDirectory()).toBe('pages');
    });
  });
});
