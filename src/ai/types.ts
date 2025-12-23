import type { Route } from '../analyzer/types.js';

export interface VisualChangeAnalysis {
  file: string;
  type: 'component' | 'store' | 'util' | 'route' | 'layout' | 'style' | 'other';
  hasVisualImpact: boolean;
  description: string;
  affectedElements?: string[];
}

export interface RouteTestRecommendation {
  route: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  authRequired: boolean;
  waitStrategy?: 'networkidle' | 'domcontentloaded' | 'load' | 'custom';
  customWait?: string;
}

export interface AIAnalysisResult {
  changes: VisualChangeAnalysis[];
  routesToTest: RouteTestRecommendation[];
  loginFlow?: LoginFlowAnalysis;
  confidence: number;
  reasoning: string;
}

export interface LoginFlowAnalysis {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successIndicator: string;
  successUrl?: string;
}

export interface AnalyzeChangesInput {
  diff: string;
  changedFiles: string[];
  routes: Route[];
  projectContext?: string;
}

export interface GenerateTestInput {
  routes: RouteTestRecommendation[];
  testUrl: string;
  loginFlow?: LoginFlowAnalysis;
  prNumber: number;
}
