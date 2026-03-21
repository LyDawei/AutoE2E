import { BITBUCKET_API_BASE } from '../config/defaults.js';
import { BitbucketError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { BitbucketPRIdentifier, BitbucketPullRequest, BitbucketChangedFile } from './types.js';

const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export class BitbucketClient {
  private token?: string;
  private timeout: number;

  constructor(token?: string, timeout?: number) {
    this.token = token;
    this.timeout = timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Parse a Bitbucket PR URL into its components
   * Supports formats:
   * - https://bitbucket.org/workspace/repo/pull-requests/123
   * - https://bitbucket.org/workspace/repo/pull-requests/123/diff
   * - https://bitbucket.org/workspace/repo/pull-requests/123/activity
   */
  parsePRUrl(url: string): BitbucketPRIdentifier {
    const patterns = [
      /^https?:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/,
      /^bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          workspace: match[1],
          repoSlug: match[2],
          number: parseInt(match[3], 10),
        };
      }
    }

    throw new BitbucketError(`Invalid Bitbucket PR URL: ${url}`);
  }

  /**
   * Build headers for Bitbucket API requests
   */
  private getHeaders(accept?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept || 'application/json',
      'User-Agent': 'AutoE2E-VRT/1.0',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Make a request to the Bitbucket API with timeout and retry
   */
  private async request<T>(endpoint: string, accept?: string, retries = MAX_RETRIES): Promise<T> {
    const url = `${BITBUCKET_API_BASE}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: this.getHeaders(accept),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        throw new BitbucketError('Resource not found. Check the PR URL or ensure you have access.', 404);
      }

      if (response.status === 403) {
        throw new BitbucketError('Access denied. Check your BITBUCKET_TOKEN or repository permissions.', 403);
      }

      if (response.status === 401) {
        throw new BitbucketError('Invalid Bitbucket token. Check your BITBUCKET_TOKEN.', 401);
      }

      if (response.status === 429) {
        throw new BitbucketError('Bitbucket API rate limit exceeded. Try again later.', 429);
      }

      // Retry on server errors
      if (response.status >= 500 && retries > 0) {
        const delay = RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
        logger.warn(`Bitbucket API returned ${response.status}, retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.request<T>(endpoint, accept, retries - 1);
      }

      if (!response.ok) {
        throw new BitbucketError(`Bitbucket API error: ${response.statusText}`, response.status);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof BitbucketError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new BitbucketError(`Bitbucket API request timed out after ${this.timeout}ms`, 408);
      }

      // Retry on network errors
      if (retries > 0 && error instanceof Error) {
        const delay = RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
        logger.warn(`Bitbucket API network error: ${error.message}, retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.request<T>(endpoint, accept, retries - 1);
      }

      throw new BitbucketError(`Bitbucket API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Make a request that returns text (for diffs)
   */
  private async requestText(endpoint: string, accept?: string): Promise<string> {
    const url = `${BITBUCKET_API_BASE}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: this.getHeaders(accept),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new BitbucketError(`Bitbucket API error: ${response.statusText}`, response.status);
      }

      return response.text();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof BitbucketError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new BitbucketError(`Bitbucket API request timed out after ${this.timeout}ms`, 408);
      }

      throw new BitbucketError(`Bitbucket API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch PR metadata
   */
  async getPullRequest(pr: BitbucketPRIdentifier): Promise<BitbucketPullRequest> {
    interface BitbucketPRResponse {
      id: number;
      title: string;
      description: string | null;
      source: { branch: { name: string } };
      destination: { branch: { name: string } };
      state: string;
      links: { html: { href: string } };
    }

    const data = await this.request<BitbucketPRResponse>(
      `/repositories/${pr.workspace}/${pr.repoSlug}/pullrequests/${pr.number}`
    );

    let state: BitbucketPullRequest['state'] = 'open';
    if (data.state === 'MERGED') {
      state = 'merged';
    } else if (data.state === 'DECLINED' || data.state === 'SUPERSEDED') {
      state = 'closed';
    }

    return {
      number: data.id,
      title: data.title,
      body: data.description,
      baseBranch: data.destination.branch.name,
      headBranch: data.source.branch.name,
      state,
      url: data.links.html.href,
    };
  }

  /**
   * Get the raw diff for a PR
   */
  async getDiff(pr: BitbucketPRIdentifier): Promise<string> {
    return this.requestText(
      `/repositories/${pr.workspace}/${pr.repoSlug}/pullrequests/${pr.number}/diff`
    );
  }

  /**
   * Get list of changed files in a PR via the diffstat endpoint
   */
  async getChangedFiles(pr: BitbucketPRIdentifier): Promise<BitbucketChangedFile[]> {
    interface BitbucketDiffStatEntry {
      type: string;
      status: string;
      old?: { path: string };
      new?: { path: string };
      lines_added: number;
      lines_removed: number;
    }

    interface BitbucketDiffStatResponse {
      values: BitbucketDiffStatEntry[];
      next?: string;
    }

    const files: BitbucketChangedFile[] = [];
    let endpoint: string | null = `/repositories/${pr.workspace}/${pr.repoSlug}/pullrequests/${pr.number}/diffstat`;

    while (endpoint) {
      const data: BitbucketDiffStatResponse = await this.request<BitbucketDiffStatResponse>(endpoint);

      for (const entry of data.values) {
        const filename = entry.new?.path || entry.old?.path || '';
        const previousFilename = entry.status === 'renamed' ? entry.old?.path : undefined;

        let status: BitbucketChangedFile['status'];
        switch (entry.status) {
          case 'added':
            status = 'added';
            break;
          case 'removed':
            status = 'removed';
            break;
          case 'renamed':
            status = 'renamed';
            break;
          case 'modified':
          default:
            status = 'modified';
            break;
        }

        files.push({
          filename,
          status,
          additions: entry.lines_added,
          deletions: entry.lines_removed,
          changes: entry.lines_added + entry.lines_removed,
          previousFilename,
        });
      }

      // Handle pagination - extract relative endpoint from next URL
      if (data.next) {
        // Strip the base URL prefix to get just the API path
        endpoint = data.next.replace(/^https?:\/\/[^/]+/, '');
      } else {
        endpoint = null;
      }

      // Safety limit
      if (files.length > 3000) {
        break;
      }
    }

    return files;
  }

  /**
   * Get file content at a specific ref (commit or branch)
   */
  async getFileContent(workspace: string, repoSlug: string, filePath: string, ref: string): Promise<string> {
    // Validate ref to prevent injection
    if (!/^[a-zA-Z0-9_\-\/\.]+$/.test(ref)) {
      throw new BitbucketError(`Invalid git reference: ${ref}`);
    }

    // Validate path doesn't escape
    if (filePath.includes('..')) {
      throw new BitbucketError(`Invalid file path: ${filePath}`);
    }

    return this.requestText(
      `/repositories/${workspace}/${repoSlug}/src/${ref}/${filePath}`
    );
  }

  /**
   * Get directory contents at a specific ref
   */
  async getDirectoryContents(
    workspace: string,
    repoSlug: string,
    dirPath: string,
    ref: string
  ): Promise<Array<{ name: string; type: 'file' | 'dir'; path: string }>> {
    // Validate ref to prevent injection
    if (!/^[a-zA-Z0-9_\-\/\.]+$/.test(ref)) {
      throw new BitbucketError(`Invalid git reference: ${ref}`);
    }

    // Validate path doesn't escape
    if (dirPath.includes('..')) {
      throw new BitbucketError(`Invalid directory path: ${dirPath}`);
    }

    interface BitbucketSrcEntry {
      path: string;
      type: 'commit_file' | 'commit_directory';
    }

    interface BitbucketSrcResponse {
      values: BitbucketSrcEntry[];
      next?: string;
    }

    const endpoint = dirPath
      ? `/repositories/${workspace}/${repoSlug}/src/${ref}/${dirPath}`
      : `/repositories/${workspace}/${repoSlug}/src/${ref}/`;

    const data = await this.request<BitbucketSrcResponse>(endpoint);

    return data.values.map((item) => {
      const name = item.path.split('/').pop() || item.path;
      return {
        name,
        type: item.type === 'commit_directory' ? 'dir' as const : 'file' as const,
        path: item.path,
      };
    });
  }
}

export function createBitbucketClient(token?: string): BitbucketClient {
  return new BitbucketClient(token);
}
