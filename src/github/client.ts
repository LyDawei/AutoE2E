import { GITHUB_API_BASE } from '../config/defaults.js';
import { GitHubError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { PRIdentifier, PullRequest, ChangedFile } from './types.js';

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay

export class GitHubClient {
  private token?: string;
  private timeout: number;

  constructor(token?: string, timeout?: number) {
    this.token = token;
    this.timeout = timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Parse a GitHub PR URL into its components
   * Supports formats:
   * - https://github.com/owner/repo/pull/123
   * - https://github.com/owner/repo/pull/123/files
   * - https://github.com/owner/repo/pull/123/commits
   */
  parsePRUrl(url: string): PRIdentifier {
    const patterns = [
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
      /^github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          owner: match[1],
          repo: match[2],
          number: parseInt(match[3], 10),
        };
      }
    }

    throw new GitHubError(`Invalid GitHub PR URL: ${url}`);
  }

  /**
   * Build headers for GitHub API requests
   */
  private getHeaders(accept?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept || 'application/vnd.github.v3+json',
      'User-Agent': 'AutoE2E-VRT/1.0',
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    return headers;
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Make a request to the GitHub API with timeout and retry
   */
  private async request<T>(endpoint: string, accept?: string, retries = MAX_RETRIES): Promise<T> {
    const url = `${GITHUB_API_BASE}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: this.getHeaders(accept),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        throw new GitHubError('Resource not found. Check the PR URL or ensure you have access.', 404);
      }

      if (response.status === 403) {
        const remaining = response.headers.get('X-RateLimit-Remaining');
        if (remaining === '0') {
          const resetTime = response.headers.get('X-RateLimit-Reset');
          const resetDate = resetTime ? new Date(parseInt(resetTime, 10) * 1000) : null;
          throw new GitHubError(
            `GitHub API rate limit exceeded. Resets at ${resetDate?.toISOString() || 'unknown'}. Try setting GITHUB_TOKEN.`,
            403
          );
        }
        throw new GitHubError('Access denied. Try setting GITHUB_TOKEN for private repos.', 403);
      }

      if (response.status === 401) {
        throw new GitHubError('Invalid GitHub token. Check your GITHUB_TOKEN.', 401);
      }

      // Retry on server errors
      if (response.status >= 500 && retries > 0) {
        const delay = RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
        logger.warn(`GitHub API returned ${response.status}, retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.request<T>(endpoint, accept, retries - 1);
      }

      if (!response.ok) {
        throw new GitHubError(`GitHub API error: ${response.statusText}`, response.status);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof GitHubError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GitHubError(`GitHub API request timed out after ${this.timeout}ms`, 408);
      }

      // Retry on network errors
      if (retries > 0 && error instanceof Error) {
        const delay = RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
        logger.warn(`GitHub API network error: ${error.message}, retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.request<T>(endpoint, accept, retries - 1);
      }

      throw new GitHubError(`GitHub API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Make a request that returns text (for diffs)
   */
  private async requestText(endpoint: string, accept: string): Promise<string> {
    const url = `${GITHUB_API_BASE}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: this.getHeaders(accept),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new GitHubError(`GitHub API error: ${response.statusText}`, response.status);
      }

      return response.text();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof GitHubError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GitHubError(`GitHub API request timed out after ${this.timeout}ms`, 408);
      }

      throw new GitHubError(`GitHub API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch PR metadata
   */
  async getPullRequest(pr: PRIdentifier): Promise<PullRequest> {
    interface GitHubPRResponse {
      number: number;
      title: string;
      body: string | null;
      base: { ref: string };
      head: { ref: string };
      state: string;
      merged: boolean;
      html_url: string;
    }

    const data = await this.request<GitHubPRResponse>(
      `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`
    );

    let state: PullRequest['state'] = 'open';
    if (data.merged) {
      state = 'merged';
    } else if (data.state === 'closed') {
      state = 'closed';
    }

    return {
      number: data.number,
      title: data.title,
      body: data.body,
      baseBranch: data.base.ref,
      headBranch: data.head.ref,
      state,
      url: data.html_url,
    };
  }

  /**
   * Get the raw diff for a PR
   */
  async getDiff(pr: PRIdentifier): Promise<string> {
    return this.requestText(
      `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`,
      'application/vnd.github.v3.diff'
    );
  }

  /**
   * Get list of changed files in a PR
   */
  async getChangedFiles(pr: PRIdentifier): Promise<ChangedFile[]> {
    interface GitHubFileResponse {
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
      previous_filename?: string;
    }

    const validStatuses = ['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'] as const;
    type FileStatus = (typeof validStatuses)[number];

    function isValidStatus(status: string): status is FileStatus {
      return (validStatuses as readonly string[]).includes(status);
    }

    const files: ChangedFile[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const data = await this.request<GitHubFileResponse[]>(
        `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/files?per_page=${perPage}&page=${page}`
      );

      for (const file of data) {
        const status = isValidStatus(file.status) ? file.status : 'modified';
        files.push({
          filename: file.filename,
          status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
          previousFilename: file.previous_filename,
        });
      }

      if (data.length < perPage) {
        break;
      }

      page++;

      // Safety limit
      if (page > 30) {
        break;
      }
    }

    return files;
  }

  /**
   * Get file content at a specific ref
   */
  async getFileContent(owner: string, repo: string, filePath: string, ref: string): Promise<string> {
    // Validate ref to prevent injection
    if (!/^[a-zA-Z0-9_\-\/\.]+$/.test(ref)) {
      throw new GitHubError(`Invalid git reference: ${ref}`);
    }

    // Validate path doesn't escape
    if (filePath.includes('..')) {
      throw new GitHubError(`Invalid file path: ${filePath}`);
    }

    interface GitHubContentResponse {
      content: string;
      encoding: string;
    }

    const data = await this.request<GitHubContentResponse>(
      `/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`
    );

    if (data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }

    return data.content;
  }

  /**
   * Get directory contents at a specific ref
   */
  async getDirectoryContents(
    owner: string,
    repo: string,
    dirPath: string,
    ref: string
  ): Promise<Array<{ name: string; type: 'file' | 'dir'; path: string }>> {
    // Validate ref to prevent injection
    if (!/^[a-zA-Z0-9_\-\/\.]+$/.test(ref)) {
      throw new GitHubError(`Invalid git reference: ${ref}`);
    }

    // Validate path doesn't escape
    if (dirPath.includes('..')) {
      throw new GitHubError(`Invalid directory path: ${dirPath}`);
    }

    interface GitHubContentItem {
      name: string;
      path: string;
      type: 'file' | 'dir' | 'symlink' | 'submodule';
    }

    const endpoint = dirPath
      ? `/repos/${owner}/${repo}/contents/${dirPath}?ref=${ref}`
      : `/repos/${owner}/${repo}/contents?ref=${ref}`;

    const data = await this.request<GitHubContentItem[]>(endpoint);

    // Filter to only files and directories
    return data
      .filter((item) => item.type === 'file' || item.type === 'dir')
      .map((item) => ({
        name: item.name,
        type: item.type as 'file' | 'dir',
        path: item.path,
      }));
  }
}

export function createGitHubClient(token?: string): GitHubClient {
  return new GitHubClient(token);
}
