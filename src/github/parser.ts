import type { ParsedDiff, DiffHunk, CategorizedChanges, ChangedFile } from './types.js';

/**
 * Parse a unified diff string into structured data
 */
export function parseDiff(rawDiff: string): ParsedDiff[] {
  const diffs: ParsedDiff[] = [];
  const lines = rawDiff.split('\n');

  let currentDiff: ParsedDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let hunkContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file diff header: diff --git a/path b/path
    if (line.startsWith('diff --git')) {
      // Save previous diff if exists
      if (currentDiff) {
        if (currentHunk) {
          currentHunk.content = hunkContent.join('\n');
          currentDiff.hunks.push(currentHunk);
        }
        diffs.push(currentDiff);
      }

      // Parse paths from diff header
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (match) {
        currentDiff = {
          oldPath: match[1],
          newPath: match[2],
          status: 'modified',
          hunks: [],
        };
      }

      currentHunk = null;
      hunkContent = [];
      continue;
    }

    if (!currentDiff) continue;

    // Detect file status from subsequent lines
    if (line.startsWith('new file mode')) {
      currentDiff.status = 'added';
      continue;
    }

    if (line.startsWith('deleted file mode')) {
      currentDiff.status = 'deleted';
      continue;
    }

    if (line.startsWith('rename from')) {
      currentDiff.status = 'renamed';
      continue;
    }

    // Hunk header: @@ -old_start,old_lines +new_start,new_lines @@
    if (line.startsWith('@@')) {
      // Save previous hunk if exists
      if (currentHunk) {
        currentHunk.content = hunkContent.join('\n');
        currentDiff.hunks.push(currentHunk);
      }

      const hunkMatch = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
          newStart: parseInt(hunkMatch[3], 10),
          newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
          content: '',
        };
      }

      hunkContent = [];
      continue;
    }

    // Collect hunk content
    if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      hunkContent.push(line);
    }
  }

  // Don't forget the last diff/hunk
  if (currentDiff) {
    if (currentHunk) {
      currentHunk.content = hunkContent.join('\n');
      currentDiff.hunks.push(currentHunk);
    }
    diffs.push(currentDiff);
  }

  return diffs;
}

/**
 * Extract just the changed file paths from parsed diffs
 */
export function getChangedPaths(diffs: ParsedDiff[]): string[] {
  const paths = new Set<string>();

  for (const diff of diffs) {
    if (diff.status === 'deleted') {
      paths.add(diff.oldPath);
    } else {
      paths.add(diff.newPath);
    }

    // For renames, include both paths
    if (diff.status === 'renamed' && diff.oldPath !== diff.newPath) {
      paths.add(diff.oldPath);
    }
  }

  return Array.from(paths);
}

/**
 * Categorize changes by type
 */
export function categorizeChanges(files: ChangedFile[]): CategorizedChanges {
  const result: CategorizedChanges = {
    added: [],
    modified: [],
    deleted: [],
    renamed: [],
  };

  for (const file of files) {
    switch (file.status) {
      case 'added':
        result.added.push(file.filename);
        break;
      case 'removed':
        result.deleted.push(file.filename);
        break;
      case 'renamed':
        result.renamed.push({
          from: file.previousFilename || file.filename,
          to: file.filename,
        });
        break;
      default:
        result.modified.push(file.filename);
    }
  }

  return result;
}

/**
 * Filter files to only those that could affect visual output
 */
export function filterVisuallyRelevantFiles(files: ChangedFile[]): ChangedFile[] {
  const visualExtensions = [
    '.svelte',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.styl',
    '.postcss',
    '.ts',
    '.js',
    '.tsx',
    '.jsx',
    '.vue',
    '.html',
  ];

  const ignorePatterns = [
    /\.test\./,
    /\.spec\./,
    /\.d\.ts$/,
    /node_modules/,
    /\.config\./,
    /package.*\.json$/,
    /tsconfig.*\.json$/,
    /\.eslint/,
    /\.prettier/,
    /\.gitignore/,
    /README/i,
    /CHANGELOG/i,
  ];

  return files.filter((file) => {
    // Check if file has a visual extension
    const hasVisualExtension = visualExtensions.some((ext) => file.filename.endsWith(ext));
    if (!hasVisualExtension) return false;

    // Check if file matches any ignore pattern
    const shouldIgnore = ignorePatterns.some((pattern) => pattern.test(file.filename));
    if (shouldIgnore) return false;

    return true;
  });
}
