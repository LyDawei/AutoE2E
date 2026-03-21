import { GitHubClient } from '../github/client.js';
import { GitHubFileSource } from '../frameworks/file-source.js';
import type { FileSource } from '../frameworks/types.js';
import type { ChangedFile } from '../github/types.js';
import type { VCSProvider, VCSPRIdentifier, VCSPullRequest } from './types.js';

export class GitHubProvider implements VCSProvider {
  private client: GitHubClient;

  constructor(token?: string) {
    this.client = new GitHubClient(token);
  }

  parsePRUrl(url: string): VCSPRIdentifier {
    const pr = this.client.parsePRUrl(url);
    return {
      platform: 'github',
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
    };
  }

  async getPullRequest(pr: VCSPRIdentifier): Promise<VCSPullRequest> {
    const ghPR = await this.client.getPullRequest({
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
    });
    return {
      number: ghPR.number,
      title: ghPR.title,
      body: ghPR.body,
      baseBranch: ghPR.baseBranch,
      headBranch: ghPR.headBranch,
      state: ghPR.state,
      url: ghPR.url,
    };
  }

  async getDiff(pr: VCSPRIdentifier): Promise<string> {
    return this.client.getDiff({
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
    });
  }

  async getChangedFiles(pr: VCSPRIdentifier): Promise<ChangedFile[]> {
    return this.client.getChangedFiles({
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
    });
  }

  createFileSource(pr: VCSPRIdentifier, ref: string): FileSource {
    return new GitHubFileSource(this.client, pr.owner, pr.repo, ref);
  }

  getClient(): GitHubClient {
    return this.client;
  }
}
