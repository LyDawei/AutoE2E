export type { VCSProvider, VCSPRIdentifier, VCSPullRequest } from './types.js';
export { GitHubProvider } from './github-provider.js';
export { BitbucketProvider } from './bitbucket-provider.js';

import { GitHubProvider } from './github-provider.js';
import { BitbucketProvider } from './bitbucket-provider.js';
import type { VCSProvider } from './types.js';

/**
 * Detect which VCS platform a PR URL belongs to
 */
export function detectPlatform(url: string): 'github' | 'bitbucket' | null {
  if (/github\.com/.test(url)) {
    return 'github';
  }
  if (/bitbucket\.org/.test(url)) {
    return 'bitbucket';
  }
  return null;
}

/**
 * Create the appropriate VCS provider based on a PR URL
 */
export function createVCSProvider(
  url: string,
  tokens?: { github?: string; bitbucket?: string }
): { provider: VCSProvider; platform: 'github' | 'bitbucket' } {
  const platform = detectPlatform(url);

  if (platform === 'bitbucket') {
    return { provider: new BitbucketProvider(tokens?.bitbucket), platform };
  }

  // Default to GitHub
  return { provider: new GitHubProvider(tokens?.github), platform: 'github' };
}
