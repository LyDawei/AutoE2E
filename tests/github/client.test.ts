import { describe, it, expect } from 'vitest';
import { GitHubClient } from '../../src/github/client.js';

describe('GitHubClient', () => {
  describe('parsePRUrl', () => {
    const client = new GitHubClient();

    it('parses standard PR URL', () => {
      const result = client.parsePRUrl('https://github.com/owner/repo/pull/123');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        number: 123,
      });
    });

    it('parses PR URL with /files suffix', () => {
      const result = client.parsePRUrl('https://github.com/owner/repo/pull/456/files');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        number: 456,
      });
    });

    it('parses PR URL with /commits suffix', () => {
      const result = client.parsePRUrl('https://github.com/owner/repo/pull/789/commits');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        number: 789,
      });
    });

    it('parses URL without https://', () => {
      const result = client.parsePRUrl('github.com/owner/repo/pull/100');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        number: 100,
      });
    });

    it('handles repos with hyphens and underscores', () => {
      const result = client.parsePRUrl('https://github.com/my-org/my_repo-name/pull/42');
      expect(result).toEqual({
        owner: 'my-org',
        repo: 'my_repo-name',
        number: 42,
      });
    });

    it('throws on invalid URL', () => {
      expect(() => client.parsePRUrl('https://example.com/foo')).toThrow('Invalid GitHub PR URL');
    });

    it('throws on issue URL (not PR)', () => {
      expect(() => client.parsePRUrl('https://github.com/owner/repo/issues/123')).toThrow(
        'Invalid GitHub PR URL'
      );
    });

    it('throws on repo URL without PR', () => {
      expect(() => client.parsePRUrl('https://github.com/owner/repo')).toThrow(
        'Invalid GitHub PR URL'
      );
    });
  });
});
