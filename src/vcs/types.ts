import type { FileSource } from '../frameworks/types.js';
import type { ChangedFile } from '../github/types.js';

/**
 * Normalized PR identifier that works across VCS platforms
 */
export interface VCSPRIdentifier {
  /** VCS platform type */
  platform: 'github' | 'bitbucket';
  /** Owner/workspace */
  owner: string;
  /** Repository name/slug */
  repo: string;
  /** PR number */
  number: number;
}

/**
 * Normalized pull request data across VCS platforms
 */
export interface VCSPullRequest {
  number: number;
  title: string;
  body: string | null;
  baseBranch: string;
  headBranch: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
}

/**
 * VCS provider interface - abstracts GitHub/Bitbucket differences
 */
export interface VCSProvider {
  /** Parse a PR URL into a normalized identifier */
  parsePRUrl(url: string): VCSPRIdentifier;
  /** Fetch PR metadata */
  getPullRequest(pr: VCSPRIdentifier): Promise<VCSPullRequest>;
  /** Get the diff for a PR */
  getDiff(pr: VCSPRIdentifier): Promise<string>;
  /** Get changed files in a PR */
  getChangedFiles(pr: VCSPRIdentifier): Promise<ChangedFile[]>;
  /** Create a FileSource for reading repo contents at a given ref */
  createFileSource(pr: VCSPRIdentifier, ref: string): FileSource;
}
