import type {
  RouteTestRecommendation,
  LoginFlowAnalysis,
  UnifiedTestRecommendation,
} from '../ai/types.js';

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

/** Generated test with unified visual and logic tests */
export interface UnifiedGeneratedTest {
  prNumber: number;
  filePath: string;
  content: string;
  routes: UnifiedTestRecommendation[];
  createdAt: Date;
  /** Counts of each test type */
  testCounts: {
    visual: number;
    logic: number;
    total: number;
  };
}

export interface TestGeneratorOptions {
  outputDir: string;
  overwrite: boolean;
}
