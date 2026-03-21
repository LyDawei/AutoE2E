export interface BitbucketPRIdentifier {
  workspace: string;
  repoSlug: string;
  number: number;
}

export interface BitbucketPullRequest {
  number: number;
  title: string;
  body: string | null;
  baseBranch: string;
  headBranch: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
}

export interface BitbucketChangedFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
}
