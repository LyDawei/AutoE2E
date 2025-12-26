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

// ============================================
// Logic/API Testing Types
// ============================================

/** Classification of a change type */
export type ChangeCategory = 'visual' | 'logic' | 'mixed';

/** Types of logic changes that can be detected */
export type LogicChangeType =
  | 'api-endpoint'
  | 'server-action'
  | 'form-handler'
  | 'validation'
  | 'service'
  | 'data-mutation';

/** CRUD and common operations */
export type OperationType =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'validate'
  | 'authenticate'
  | 'other';

/** HTTP methods for API endpoints */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Analysis of a logic/API change in the diff */
export interface LogicChangeAnalysis {
  file: string;
  type: LogicChangeType;
  operation: OperationType;
  description: string;
  httpMethod?: HttpMethod;
  affectedRoute: string;
  inputFields?: FieldDefinition[];
  expectedOutcomes?: ExpectedOutcome[];
}

/** Definition of a form field with test data */
export interface FieldDefinition {
  name: string;
  type: 'text' | 'email' | 'password' | 'number' | 'select' | 'checkbox' | 'textarea' | 'file';
  selector?: string;
  validation?: string;
  required: boolean;
  testValue?: string;
}

/** Expected outcome for a test scenario */
export interface ExpectedOutcome {
  scenario: 'success' | 'validation-error' | 'auth-error' | 'not-found' | 'server-error';
  indicator: string;
  description: string;
}

/** Types of visual tests */
export type VisualTestType = 'screenshot' | 'element-screenshot';

/** Types of logic tests */
export type LogicTestType =
  | 'form-submission'
  | 'crud-operation'
  | 'navigation-flow'
  | 'error-handling'
  | 'state-verification';

/** Details for a visual test */
export interface VisualTestDetails {
  screenshotName: string;
  waitFor?: string;
  maskSelectors?: string[];
}

/** Details for a logic test */
export interface LogicTestDetails {
  action: string;
  steps: TestStep[];
  assertions: TestAssertion[];
}

/** A single step in a logic test */
export interface TestStep {
  type: 'navigate' | 'fill' | 'click' | 'select' | 'check' | 'wait' | 'upload';
  target?: string;
  value?: string;
  description: string;
}

/** An assertion in a logic test */
export interface TestAssertion {
  type: 'visible' | 'text' | 'url' | 'count' | 'attribute' | 'toast' | 'redirect';
  target?: string;
  expected: string;
  description: string;
}

/** A test type specification (visual or logic) */
export interface TestTypeSpec {
  category: 'visual' | 'logic';
  subtype: VisualTestType | LogicTestType;
  details: VisualTestDetails | LogicTestDetails;
}

/** Unified test recommendation that can include both visual and logic tests */
export interface UnifiedTestRecommendation {
  route: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  authRequired: boolean;
  testTypes: TestTypeSpec[];
  waitStrategy?: 'networkidle' | 'domcontentloaded' | 'load' | 'custom';
  customWait?: string;
}

/** AI-inferred test data organized by route and field */
export interface InferredTestData {
  [route: string]: {
    [fieldName: string]: {
      validValue: string;
      invalidValue?: string;
      edgeCases?: string[];
    };
  };
}

/** Result from logic-specific analysis */
export interface LogicAnalysisResult {
  changes: LogicChangeAnalysis[];
  routesToTest: UnifiedTestRecommendation[];
  testData?: InferredTestData;
  confidence: number;
  reasoning: string;
}

/** Extended analysis result combining visual and logic analysis */
export interface ExtendedAIAnalysisResult {
  changes: Array<VisualChangeAnalysis | LogicChangeAnalysis>;
  routesToTest: UnifiedTestRecommendation[];
  loginFlow?: LoginFlowAnalysis;
  testData?: InferredTestData;
  confidence: number;
  reasoning: string;
}

/** Input for unified test generation */
export interface GenerateUnifiedTestInput {
  routes: UnifiedTestRecommendation[];
  testUrl: string;
  loginFlow?: LoginFlowAnalysis;
  testData?: InferredTestData;
  prNumber: number;
}
