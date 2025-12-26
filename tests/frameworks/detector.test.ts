import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
// Import from index to ensure adapters are registered
import { detectFramework, LocalFileSource } from '../../src/frameworks/index.js';
import type { AdapterContext } from '../../src/frameworks/types.js';

describe('detectFramework', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yokohama-detector-test-'));
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

  describe('SvelteKit detection', () => {
    it('detects SvelteKit project', async () => {
      writeFile('svelte.config.js', 'export default {}');
      writeFile('src/routes/+page.svelte', '<h1>Home</h1>');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@sveltejs/kit': '^2.0.0' }
      }));

      const result = await detectFramework(createContext());

      expect(result.framework).toBe('sveltekit');
      expect(result.confidence).toBe('high');
    });
  });

  describe('Next.js detection', () => {
    it('detects Next.js App Router project', async () => {
      writeFile('next.config.js', 'module.exports = {}');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { next: '^14.0.0' }
      }));

      const result = await detectFramework(createContext());

      expect(result.framework).toBe('nextjs-app');
      expect(result.confidence).toBe('high');
    });

    it('detects Next.js Pages Router project', async () => {
      writeFile('next.config.js', 'module.exports = {}');
      writeFile('pages/index.tsx', 'export default function Home() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { next: '^14.0.0' }
      }));

      const result = await detectFramework(createContext());

      expect(result.framework).toBe('nextjs-pages');
      expect(result.confidence).toBe('high');
    });

    it('detects Next.js hybrid project', async () => {
      writeFile('next.config.js', 'module.exports = {}');
      writeFile('app/page.tsx', 'export default function Home() {}');
      writeFile('pages/legacy.tsx', 'export default function Legacy() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { next: '^14.0.0' }
      }));

      const result = await detectFramework(createContext());

      expect(result.framework).toBe('nextjs');
      expect(result.routerType).toBe('hybrid');
    });
  });

  describe('Nuxt detection', () => {
    it('detects Nuxt project', async () => {
      writeFile('nuxt.config.ts', 'export default defineNuxtConfig({})');
      writeFile('pages/index.vue', '<template><div>Home</div></template>');
      writeFile('package.json', JSON.stringify({
        dependencies: { nuxt: '^3.0.0' }
      }));

      const result = await detectFramework(createContext());

      expect(result.framework).toBe('nuxt');
      expect(result.confidence).toBe('high');
    });
  });

  describe('Remix detection', () => {
    it('detects Remix project', async () => {
      writeFile('app/routes/_index.tsx', 'export default function Index() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@remix-run/react': '^2.0.0' }
      }));

      const result = await detectFramework(createContext());

      expect(result.framework).toBe('remix');
      expect(result.confidence).toBe('high');
    });

    it('prioritizes Remix over React Router when both deps present', async () => {
      writeFile('app/routes/_index.tsx', 'export default function Index() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: {
          '@remix-run/react': '^2.0.0',
          'react-router': '^6.0.0'
        }
      }));

      const result = await detectFramework(createContext());

      expect(result.framework).toBe('remix');
    });
  });

  describe('React Router detection', () => {
    it('detects React Router project', async () => {
      writeFile('app/routes/_index.tsx', 'export default function Index() {}');
      writeFile('package.json', JSON.stringify({
        dependencies: { 'react-router': '^7.0.0' }
      }));

      const result = await detectFramework(createContext());

      expect(result.framework).toBe('react-router');
      expect(result.confidence).toBe('high');
    });
  });

  describe('No framework detection', () => {
    it('returns null when no framework detected', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: {} }));
      writeFile('index.html', '<html></html>');

      const result = await detectFramework(createContext());

      expect(result.framework).toBeNull();
      expect(result.confidence).toBe('none');
    });
  });

  describe('Confidence priority', () => {
    it('returns highest confidence detection', async () => {
      // Create a project that could be detected as multiple frameworks
      // but has stronger indicators for one
      writeFile('svelte.config.js', 'export default {}');
      writeFile('src/routes/+page.svelte', '<h1>Home</h1>');
      writeFile('package.json', JSON.stringify({
        dependencies: { '@sveltejs/kit': '^2.0.0' }
      }));
      // Add a weak indicator for another framework
      writeFile('pages/index.tsx', 'export default function Home() {}');

      const result = await detectFramework(createContext());

      // Should detect SvelteKit with high confidence
      expect(result.framework).toBe('sveltekit');
      expect(result.confidence).toBe('high');
    });
  });
});
