import { describe, it, expect } from 'vitest';
import {
  parseDiff,
  getChangedPaths,
  categorizeChanges,
  filterVisuallyRelevantFiles,
  filterLogicRelevantFiles,
  classifyChangedFiles,
} from '../../src/github/parser.js';
import type { ChangedFile } from '../../src/github/types.js';

describe('parseDiff', () => {
  it('parses a simple file modification', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index abc123..def456 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import express from 'express';
+import cors from 'cors';
 const app = express();`;

    const result = parseDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].oldPath).toBe('src/app.ts');
    expect(result[0].newPath).toBe('src/app.ts');
    expect(result[0].status).toBe('modified');
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].oldStart).toBe(1);
    expect(result[0].hunks[0].newStart).toBe(1);
    expect(result[0].hunks[0].content).toContain("+import cors from 'cors';");
  });

  it('parses a new file addition', () => {
    const diff = `diff --git a/src/utils.ts b/src/utils.ts
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/src/utils.ts
@@ -0,0 +1,3 @@
+export function helper() {
+  return true;
+}`;

    const result = parseDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('added');
    expect(result[0].newPath).toBe('src/utils.ts');
  });

  it('parses a file deletion', () => {
    const diff = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc123..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function oldHelper() {
-  return false;
-}`;

    const result = parseDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('deleted');
    expect(result[0].oldPath).toBe('src/old.ts');
  });

  it('parses multiple files in one diff', () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
index abc..def 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
index 123..456 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-foo
+bar`;

    const result = parseDiff(diff);

    expect(result).toHaveLength(2);
    expect(result[0].newPath).toBe('src/a.ts');
    expect(result[1].newPath).toBe('src/b.ts');
  });
});

describe('getChangedPaths', () => {
  it('returns paths from parsed diffs', () => {
    const diffs = [
      { oldPath: 'a.ts', newPath: 'a.ts', status: 'modified' as const, hunks: [] },
      { oldPath: 'b.ts', newPath: 'b.ts', status: 'added' as const, hunks: [] },
    ];

    const paths = getChangedPaths(diffs);

    expect(paths).toContain('a.ts');
    expect(paths).toContain('b.ts');
  });

  it('includes both paths for renames', () => {
    const diffs = [
      { oldPath: 'old.ts', newPath: 'new.ts', status: 'renamed' as const, hunks: [] },
    ];

    const paths = getChangedPaths(diffs);

    expect(paths).toContain('old.ts');
    expect(paths).toContain('new.ts');
  });

  it('returns unique paths', () => {
    const diffs = [
      { oldPath: 'same.ts', newPath: 'same.ts', status: 'modified' as const, hunks: [] },
    ];

    const paths = getChangedPaths(diffs);

    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe('same.ts');
  });
});

describe('categorizeChanges', () => {
  it('categorizes files by status', () => {
    const files: ChangedFile[] = [
      { filename: 'new.ts', status: 'added', additions: 10, deletions: 0, changes: 10 },
      { filename: 'modified.ts', status: 'modified', additions: 5, deletions: 3, changes: 8 },
      { filename: 'deleted.ts', status: 'removed', additions: 0, deletions: 20, changes: 20 },
      {
        filename: 'renamed.ts',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        changes: 0,
        previousFilename: 'old-name.ts',
      },
    ];

    const result = categorizeChanges(files);

    expect(result.added).toContain('new.ts');
    expect(result.modified).toContain('modified.ts');
    expect(result.deleted).toContain('deleted.ts');
    expect(result.renamed).toEqual([{ from: 'old-name.ts', to: 'renamed.ts' }]);
  });
});

describe('filterVisuallyRelevantFiles', () => {
  it('includes Svelte files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/routes/+page.svelte', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterVisuallyRelevantFiles(files);

    expect(result).toHaveLength(1);
  });

  it('includes CSS files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/styles/app.css', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterVisuallyRelevantFiles(files);

    expect(result).toHaveLength(1);
  });

  it('excludes test files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/utils.test.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'tests/app.spec.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterVisuallyRelevantFiles(files);

    expect(result).toHaveLength(0);
  });

  it('excludes config files', () => {
    const files: ChangedFile[] = [
      { filename: 'package.json', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'tsconfig.json', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'vite.config.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterVisuallyRelevantFiles(files);

    expect(result).toHaveLength(0);
  });

  it('excludes README and documentation', () => {
    const files: ChangedFile[] = [
      { filename: 'README.md', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'docs/readme.md', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterVisuallyRelevantFiles(files);

    expect(result).toHaveLength(0);
  });
});

describe('filterLogicRelevantFiles', () => {
  it('includes +server.ts files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/routes/api/users/+server.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterLogicRelevantFiles(files);
    expect(result).toHaveLength(1);
  });

  it('includes +page.server.ts files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/routes/login/+page.server.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterLogicRelevantFiles(files);
    expect(result).toHaveLength(1);
  });

  it('includes +layout.server.ts files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/routes/(auth)/+layout.server.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterLogicRelevantFiles(files);
    expect(result).toHaveLength(1);
  });

  it('includes files in api directory', () => {
    const files: ChangedFile[] = [
      { filename: 'src/api/handlers.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterLogicRelevantFiles(files);
    expect(result).toHaveLength(1);
  });

  it('includes service files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/services/user-service.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/service/auth.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterLogicRelevantFiles(files);
    expect(result).toHaveLength(2);
  });

  it('includes lib/server files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/lib/server/db.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterLogicRelevantFiles(files);
    expect(result).toHaveLength(1);
  });

  it('includes schema and validator files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/schemas/user-schema.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/validators/email.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterLogicRelevantFiles(files);
    expect(result).toHaveLength(2);
  });

  it('excludes test files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/routes/api/+server.test.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'tests/api.spec.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterLogicRelevantFiles(files);
    expect(result).toHaveLength(0);
  });

  it('excludes type definition files', () => {
    const files: ChangedFile[] = [
      { filename: 'src/api/types.d.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = filterLogicRelevantFiles(files);
    expect(result).toHaveLength(0);
  });
});

describe('classifyChangedFiles', () => {
  it('classifies visual files correctly', () => {
    const files: ChangedFile[] = [
      { filename: 'src/routes/+page.svelte', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/components/Button.svelte', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/styles/app.css', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = classifyChangedFiles(files);
    expect(result.visual).toHaveLength(3);
    expect(result.logic).toHaveLength(0);
    expect(result.mixed).toHaveLength(0);
  });

  it('classifies logic files correctly', () => {
    const files: ChangedFile[] = [
      { filename: 'src/routes/api/users/+server.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/routes/login/+page.server.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/services/auth.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = classifyChangedFiles(files);
    expect(result.visual).toHaveLength(0);
    expect(result.logic).toHaveLength(3);
    expect(result.mixed).toHaveLength(0);
  });

  it('separates visual and logic files in same PR', () => {
    const files: ChangedFile[] = [
      { filename: 'src/routes/+page.svelte', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/routes/+page.server.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/components/Form.svelte', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/services/user.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = classifyChangedFiles(files);
    expect(result.visual).toHaveLength(2);
    expect(result.logic).toHaveLength(2);
    expect(result.mixed).toHaveLength(0);
  });

  it('ignores config and test files', () => {
    const files: ChangedFile[] = [
      { filename: 'package.json', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'tsconfig.json', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'src/routes/api/+server.test.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
      { filename: 'README.md', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = classifyChangedFiles(files);
    expect(result.visual).toHaveLength(0);
    expect(result.logic).toHaveLength(0);
    expect(result.mixed).toHaveLength(0);
  });

  it('handles hooks.server files as logic', () => {
    const files: ChangedFile[] = [
      { filename: 'src/hooks.server.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = classifyChangedFiles(files);
    expect(result.logic).toHaveLength(1);
    expect(result.visual).toHaveLength(0);
  });

  it('handles middleware files as logic', () => {
    const files: ChangedFile[] = [
      { filename: 'src/middleware/auth.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 },
    ];

    const result = classifyChangedFiles(files);
    expect(result.logic).toHaveLength(1);
    expect(result.visual).toHaveLength(0);
  });
});
