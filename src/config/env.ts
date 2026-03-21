import { ConfigError } from '../utils/errors.js';

export interface EnvConfig {
  githubToken?: string;
  bitbucketToken?: string;
  openaiApiKey: string;
  testUrl: string;
  testUser?: string;
  testPassword?: string;
}

export function loadEnvConfig(): EnvConfig {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const testUrl = process.env.TEST_URL;

  if (!openaiApiKey) {
    throw new ConfigError('OPENAI_API_KEY environment variable is required');
  }

  if (!testUrl) {
    throw new ConfigError('TEST_URL environment variable is required');
  }

  return {
    githubToken: process.env.GITHUB_TOKEN,
    bitbucketToken: process.env.BITBUCKET_TOKEN,
    openaiApiKey,
    testUrl,
    testUser: process.env.TEST_USER,
    testPassword: process.env.TEST_PASSWORD,
  };
}

export function validateEnvConfig(config: Partial<EnvConfig>): EnvConfig {
  if (!config.openaiApiKey) {
    throw new ConfigError('openaiApiKey is required');
  }

  if (!config.testUrl) {
    throw new ConfigError('testUrl is required');
  }

  return {
    githubToken: config.githubToken,
    bitbucketToken: config.bitbucketToken,
    openaiApiKey: config.openaiApiKey,
    testUrl: config.testUrl,
    testUser: config.testUser,
    testPassword: config.testPassword,
  };
}
