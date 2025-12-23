import type { RouteTestRecommendation, LoginFlowAnalysis } from '../ai/types.js';

export interface TestConfig {
  testUrl: string;
  viewport: {
    width: number;
    height: number;
  };
  prNumber: number;
  authCredentials?: {
    user: string;
    password: string;
  };
  loginFlow?: LoginFlowAnalysis;
}

export interface GeneratedTest {
  prNumber: number;
  filePath: string;
  content: string;
  routes: RouteTestRecommendation[];
  createdAt: Date;
}

export interface TestGeneratorOptions {
  outputDir: string;
  overwrite: boolean;
}
