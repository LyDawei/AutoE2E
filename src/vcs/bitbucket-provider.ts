import { BitbucketClient } from '../bitbucket/client.js';
import { BitbucketFileSource } from '../frameworks/file-source.js';
import type { FileSource } from '../frameworks/types.js';
import type { ChangedFile } from '../github/types.js';
import type { VCSProvider, VCSPRIdentifier, VCSPullRequest } from './types.js';

export class BitbucketProvider implements VCSProvider {
  private client: BitbucketClient;

  constructor(token?: string) {
    this.client = new BitbucketClient(token);
  }

  parsePRUrl(url: string): VCSPRIdentifier {
    const pr = this.client.parsePRUrl(url);
    return {
      platform: 'bitbucket',
      owner: pr.workspace,
      repo: pr.repoSlug,
      number: pr.number,
    };
  }

  async getPullRequest(pr: VCSPRIdentifier): Promise<VCSPullRequest> {
    const bbPR = await this.client.getPullRequest({
      workspace: pr.owner,
      repoSlug: pr.repo,
      number: pr.number,
    });
    return {
      number: bbPR.number,
      title: bbPR.title,
      body: bbPR.body,
      baseBranch: bbPR.baseBranch,
      headBranch: bbPR.headBranch,
      state: bbPR.state,
      url: bbPR.url,
    };
  }

  async getDiff(pr: VCSPRIdentifier): Promise<string> {
    return this.client.getDiff({
      workspace: pr.owner,
      repoSlug: pr.repo,
      number: pr.number,
    });
  }

  async getChangedFiles(pr: VCSPRIdentifier): Promise<ChangedFile[]> {
    const files = await this.client.getChangedFiles({
      workspace: pr.owner,
      repoSlug: pr.repo,
      number: pr.number,
    });
    // BitbucketChangedFile is compatible with ChangedFile
    return files;
  }

  createFileSource(pr: VCSPRIdentifier, ref: string): FileSource {
    return new BitbucketFileSource(this.client, pr.owner, pr.repo, ref);
  }

  getClient(): BitbucketClient {
    return this.client;
  }
}
