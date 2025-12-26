import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { extractApiMethods, extractFormActions } from '../../src/analyzer/route-mapper.js';

describe('extractApiMethods', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yokohama-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts GET handler using function syntax', () => {
    const filePath = path.join(tempDir, '+server.ts');
    fs.writeFileSync(
      filePath,
      `export function GET({ params }) {
        return new Response('hello');
      }`
    );

    const methods = extractApiMethods(filePath);
    expect(methods).toEqual(['GET']);
  });

  it('extracts async GET handler', () => {
    const filePath = path.join(tempDir, '+server.ts');
    fs.writeFileSync(
      filePath,
      `export async function GET({ params }) {
        return new Response('hello');
      }`
    );

    const methods = extractApiMethods(filePath);
    expect(methods).toEqual(['GET']);
  });

  it('extracts GET handler using const syntax', () => {
    const filePath = path.join(tempDir, '+server.ts');
    fs.writeFileSync(
      filePath,
      `export const GET = async ({ params }) => {
        return new Response('hello');
      };`
    );

    const methods = extractApiMethods(filePath);
    expect(methods).toEqual(['GET']);
  });

  it('extracts multiple HTTP methods', () => {
    const filePath = path.join(tempDir, '+server.ts');
    fs.writeFileSync(
      filePath,
      `export async function GET({ params }) {
        return new Response('get');
      }

      export async function POST({ request }) {
        return new Response('post');
      }

      export const DELETE = async ({ params }) => {
        return new Response('delete');
      };`
    );

    const methods = extractApiMethods(filePath);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('DELETE');
    expect(methods).toHaveLength(3);
  });

  it('extracts PUT and PATCH methods', () => {
    const filePath = path.join(tempDir, '+server.ts');
    fs.writeFileSync(
      filePath,
      `export async function PUT({ request }) {
        return new Response('put');
      }

      export async function PATCH({ request }) {
        return new Response('patch');
      }`
    );

    const methods = extractApiMethods(filePath);
    expect(methods).toContain('PUT');
    expect(methods).toContain('PATCH');
  });

  it('returns empty array for non-existent file', () => {
    const methods = extractApiMethods('/non/existent/file.ts');
    expect(methods).toEqual([]);
  });

  it('returns empty array for file without HTTP method exports', () => {
    const filePath = path.join(tempDir, '+server.ts');
    fs.writeFileSync(
      filePath,
      `export function helper() {
        return 'not an HTTP handler';
      }`
    );

    const methods = extractApiMethods(filePath);
    expect(methods).toEqual([]);
  });

  it('handles let keyword for exports', () => {
    const filePath = path.join(tempDir, '+server.ts');
    fs.writeFileSync(
      filePath,
      `export let GET = async () => new Response('hello');`
    );

    const methods = extractApiMethods(filePath);
    expect(methods).toEqual(['GET']);
  });
});

describe('extractFormActions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yokohama-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts default action', () => {
    const filePath = path.join(tempDir, '+page.server.ts');
    fs.writeFileSync(
      filePath,
      `export const actions = {
        default: async ({ request }) => {
          return { success: true };
        }
      };`
    );

    const actions = extractFormActions(filePath);
    expect(actions).toContain('default');
  });

  it('extracts named actions', () => {
    const filePath = path.join(tempDir, '+page.server.ts');
    fs.writeFileSync(
      filePath,
      `export const actions = {
        create: async ({ request }) => {
          return { success: true };
        },
        update: async ({ request }) => {
          return { success: true };
        },
        delete: async ({ request }) => {
          return { success: true };
        }
      };`
    );

    const actions = extractFormActions(filePath);
    expect(actions).toContain('create');
    expect(actions).toContain('update');
    expect(actions).toContain('delete');
  });

  it('extracts actions with type annotation', () => {
    const filePath = path.join(tempDir, '+page.server.ts');
    fs.writeFileSync(
      filePath,
      `import type { Actions } from './$types';

      export const actions: Actions = {
        login: async ({ request, cookies }) => {
          return { success: true };
        }
      };`
    );

    const actions = extractFormActions(filePath);
    expect(actions).toContain('login');
  });

  it('extracts actions using satisfies pattern', () => {
    const filePath = path.join(tempDir, '+page.server.ts');
    fs.writeFileSync(
      filePath,
      `import type { Actions } from './$types';

      const actions = {
        register: async ({ request }) => {
          return { success: true };
        }
      } satisfies Actions;

      export { actions };`
    );

    const actions = extractFormActions(filePath);
    expect(actions).toContain('register');
  });

  it('returns empty array for file without actions', () => {
    const filePath = path.join(tempDir, '+page.server.ts');
    fs.writeFileSync(
      filePath,
      `export async function load() {
        return { data: 'hello' };
      }`
    );

    const actions = extractFormActions(filePath);
    expect(actions).toEqual([]);
  });

  it('returns empty array for non-existent file', () => {
    const actions = extractFormActions('/non/existent/file.ts');
    expect(actions).toEqual([]);
  });

  it('handles complex action with nested objects', () => {
    const filePath = path.join(tempDir, '+page.server.ts');
    fs.writeFileSync(
      filePath,
      `export const actions = {
        submit: async ({ request }) => {
          const data = { nested: { value: true } };
          return { success: true, data };
        }
      };`
    );

    const actions = extractFormActions(filePath);
    expect(actions).toContain('submit');
  });

  it('handles arrow function actions', () => {
    const filePath = path.join(tempDir, '+page.server.ts');
    fs.writeFileSync(
      filePath,
      `export const actions = {
        save: async (event) => {
          return { success: true };
        },
        load: (event) => {
          return { data: [] };
        }
      };`
    );

    const actions = extractFormActions(filePath);
    expect(actions).toContain('save');
    expect(actions).toContain('load');
  });

  it('handles shorthand method syntax', () => {
    const filePath = path.join(tempDir, '+page.server.ts');
    fs.writeFileSync(
      filePath,
      `export const actions = {
        async create({ request }) {
          return { success: true };
        },
        async update({ request }) {
          return { success: true };
        }
      };`
    );

    const actions = extractFormActions(filePath);
    expect(actions).toContain('create');
    expect(actions).toContain('update');
  });
});
