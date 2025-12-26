import type { Route } from '../analyzer/types.js';
import type {
  RouteTestRecommendation,
  LoginFlowAnalysis,
  UnifiedTestRecommendation,
  InferredTestData,
} from './types.js';
import { logger } from '../utils/logger.js';

/** Maximum characters for diff content in prompts */
const MAX_DIFF_LENGTH = 15000;

/**
 * Prompt for analyzing diff and understanding visual changes
 */
export function buildDiffAnalysisPrompt(
  diff: string,
  changedFiles: string[],
  routes: Route[]
): string {
  const routeList = routes
    .map(
      (r) =>
        `- ${r.path} (${r.isAuthProtected ? 'auth required' : 'public'}${r.isDynamic ? ', dynamic' : ''})`
    )
    .join('\n');

  // Warn if diff is truncated
  const isTruncated = diff.length > MAX_DIFF_LENGTH;
  if (isTruncated) {
    logger.warn(`Diff truncated from ${diff.length} to ${MAX_DIFF_LENGTH} characters. Some changes may not be analyzed.`);
  }

  return `You are analyzing a GitHub PR diff for a SvelteKit application to determine visual regression testing needs.

## Changed Files
${changedFiles.map((f) => `- ${f}`).join('\n')}

## Available Routes
${routeList}

## Diff Content
\`\`\`diff
${diff.slice(0, MAX_DIFF_LENGTH)}
\`\`\`
${isTruncated ? '\n[Diff truncated due to length - some changes may not be visible]' : ''}

## Your Task
Analyze the changes and determine:
1. Which changes could affect visual appearance (styling, layout, component structure, content)
2. Which routes need visual regression testing based on the changes
3. Priority of each route (high = direct visual changes, medium = indirect via components, low = uncertain impact)

## Response Format
Respond with valid JSON only (no markdown, no explanation):
{
  "changes": [
    {
      "file": "path/to/file",
      "type": "component|store|util|route|layout|style|other",
      "hasVisualImpact": true|false,
      "description": "brief description of change",
      "affectedElements": ["list", "of", "affected", "ui", "elements"]
    }
  ],
  "routesToTest": [
    {
      "route": "/path",
      "reason": "why this route needs testing",
      "priority": "high|medium|low",
      "authRequired": true|false,
      "waitStrategy": "networkidle|domcontentloaded|load"
    }
  ],
  "confidence": 0.0 to 1.0,
  "reasoning": "overall reasoning for the analysis"
}`;
}

/**
 * Prompt for inferring login flow from codebase
 */
export function buildLoginFlowPrompt(loginPageContent: string, layoutContent?: string): string {
  return `Analyze this login page to extract the login flow selectors.

## Login Page Content
\`\`\`svelte
${loginPageContent.slice(0, 8000)}
\`\`\`

${
  layoutContent
    ? `## Layout Content
\`\`\`svelte
${layoutContent.slice(0, 4000)}
\`\`\``
    : ''
}

## Your Task
Extract the CSS selectors or data-testid attributes for:
1. Username/email input field
2. Password input field
3. Submit/login button
4. Success indicator (what element appears after successful login)
5. Expected URL after successful login
6. **Login mode toggle** (if the page has multiple login modes like "Verification Code" vs "Password", identify the button/link to switch to password mode)

## Response Format
Respond with valid JSON only:
{
  "loginUrl": "/login",
  "usernameSelector": "input[name='email']",
  "passwordSelector": "input[name='password']",
  "submitSelector": "button[type='submit']",
  "successIndicator": "[data-testid='dashboard']",
  "successUrl": "/dashboard",
  "loginModeToggleSelector": "button:has-text('Password')",
  "loginModeToggleDescription": "Switch to password login mode"
}

## Important Notes:
- If the login page has tabs, toggles, or buttons to switch between login methods (e.g., "Verification Code" / "Password", "Email" / "Phone", "SSO" / "Password"), set loginModeToggleSelector to the selector that switches to PASSWORD mode
- If no mode toggle exists (direct password login), omit loginModeToggleSelector and loginModeToggleDescription
- Prefer data-testid attributes when available, then id, then name, then type-based selectors

If you cannot determine a selector with confidence, use a reasonable default like:
- Username: input[type='email'], input[name='email'], #email
- Password: input[type='password'], input[name='password'], #password
- Submit: button[type='submit'], form button, .login-button`;
}

/**
 * Prompt for generating Playwright test code
 */
export function buildTestGenerationPrompt(
  routes: RouteTestRecommendation[],
  testUrl: string,
  loginFlow: LoginFlowAnalysis | undefined,
  prNumber: number
): string {
  const publicRoutes = routes.filter((r) => !r.authRequired);
  const authRoutes = routes.filter((r) => r.authRequired);

  return `Generate a Playwright visual regression test file for PR #${prNumber}.

## Test Configuration
- Base URL: ${testUrl}
- Viewport: 1920x1080 (Desktop)
- Use Playwright's built-in toHaveScreenshot() assertion

## Routes to Test

### Public Routes
${publicRoutes.length > 0 ? publicRoutes.map((r) => `- ${r.route}: ${r.reason} (${r.priority} priority)`).join('\n') : 'None'}

### Authenticated Routes
${authRoutes.length > 0 ? authRoutes.map((r) => `- ${r.route}: ${r.reason} (${r.priority} priority)`).join('\n') : 'None'}

${
  loginFlow
    ? `## Login Flow
- Login URL: ${loginFlow.loginUrl}
${loginFlow.loginModeToggleSelector ? `- Login mode toggle: ${loginFlow.loginModeToggleSelector} (${loginFlow.loginModeToggleDescription || 'click to enable password login'})` : ''}
- Username selector: ${loginFlow.usernameSelector}
- Password selector: ${loginFlow.passwordSelector}
- Submit selector: ${loginFlow.submitSelector}
- Success indicator: ${loginFlow.successIndicator}
- Success URL: ${loginFlow.successUrl || 'N/A'}

**CRITICAL: Credentials MUST use environment variables:**
- Username: process.env.TEST_USER!
- Password: process.env.TEST_PASSWORD!
DO NOT use placeholder values like 'testUser' or 'testPass'. Always use the exact expressions above.`
    : ''
}

## Requirements
1. Group tests into "Public Pages" and "Authenticated Pages" describe blocks
2. For authenticated tests, use beforeEach to handle login:
   - Navigate to login URL
   - If loginModeToggleSelector is provided, click it first to switch to password mode
   - Fill username with process.env.TEST_USER! (NOT a placeholder string)
   - Fill password with process.env.TEST_PASSWORD! (NOT a placeholder string)
   - Click submit button
   - Wait for success indicator or URL
3. Wait for network idle before screenshots
4. Use descriptive screenshot names based on route
5. Handle errors gracefully
6. Use maxDiffPixels: 100 for tolerance
7. **NEVER use literal credential values** - always use process.env.TEST_USER! and process.env.TEST_PASSWORD!

## Response Format
Return ONLY the TypeScript code for the test file, no markdown code blocks or explanation:

import { test, expect } from '@playwright/test';

test.describe('PR #${prNumber} Visual Regression', () => {
  // ... tests here
});`;
}

/**
 * Parse AI response to extract JSON with optional validation
 */
export function parseAIResponse<T>(response: string, validator?: (data: unknown) => data is T): T {
  let parsed: unknown;

  // Try to parse directly
  try {
    parsed = JSON.parse(response);
  } catch {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error('Failed to parse AI response as JSON');
      }
    } else {
      throw new Error('No JSON found in AI response');
    }
  }

  // Validate if validator provided
  if (validator && !validator(parsed)) {
    throw new Error('AI response failed validation: missing or invalid required fields');
  }

  return parsed as T;
}

/**
 * Type guard for AIAnalysisResult
 */
export function isAIAnalysisResult(data: unknown): data is { changes: unknown[]; routesToTest: unknown[]; confidence: number; reasoning: string } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    Array.isArray(obj.changes) &&
    Array.isArray(obj.routesToTest) &&
    typeof obj.confidence === 'number' &&
    typeof obj.reasoning === 'string'
  );
}

/**
 * Type guard for LogicAnalysisResult
 */
export function isLogicAnalysisResult(data: unknown): data is { changes: unknown[]; routesToTest: unknown[]; confidence: number; reasoning: string } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    Array.isArray(obj.changes) &&
    Array.isArray(obj.routesToTest) &&
    typeof obj.confidence === 'number' &&
    typeof obj.reasoning === 'string'
  );
}

/**
 * Type guard for LoginFlowAnalysis
 */
export function isLoginFlowAnalysis(data: unknown): data is { loginUrl: string; usernameSelector: string; passwordSelector: string; submitSelector: string } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.loginUrl === 'string' &&
    typeof obj.usernameSelector === 'string' &&
    typeof obj.passwordSelector === 'string' &&
    typeof obj.submitSelector === 'string'
  );
}

/**
 * Extract code from AI response (handles markdown code blocks)
 */
export function extractCodeFromResponse(response: string): string {
  // Remove markdown code blocks if present
  const codeBlockMatch = response.match(/```(?:typescript|ts|javascript|js)?\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // If no code block, assume the entire response is code
  return response.trim();
}

// ============================================
// Logic/API Analysis Prompts
// ============================================

/**
 * Prompt for analyzing logic/API changes in a diff
 */
export function buildLogicAnalysisPrompt(
  diff: string,
  changedFiles: string[],
  routes: Route[]
): string {
  const routeList = routes
    .filter((r) => r.serverFiles.length > 0 || r.hasFormHandler || r.hasApiEndpoint)
    .map((r) => {
      const details: string[] = [];
      if (r.hasApiEndpoint && r.apiMethods.length > 0) {
        details.push(`API: ${r.apiMethods.join(', ')}`);
      }
      if (r.hasFormHandler && r.actions.length > 0) {
        details.push(`Actions: ${r.actions.join(', ')}`);
      }
      if (r.isAuthProtected) {
        details.push('auth required');
      }
      return `- ${r.path} (${details.join(', ') || 'server logic'})`;
    })
    .join('\n');

  // Warn if diff is truncated
  const isTruncated = diff.length > MAX_DIFF_LENGTH;
  if (isTruncated) {
    logger.warn(`Diff truncated from ${diff.length} to ${MAX_DIFF_LENGTH} characters. Some logic changes may not be analyzed.`);
  }

  return `You are analyzing a GitHub PR diff for a SvelteKit application to determine LOGIC and BEHAVIORAL testing needs.
Focus on server-side changes, form handlers, API endpoints, validation, and data mutations.

## Changed Files
${changedFiles.map((f) => `- ${f}`).join('\n')}

## Routes with Server Logic
${routeList || 'No server routes detected'}

## Diff Content
\`\`\`diff
${diff.slice(0, MAX_DIFF_LENGTH)}
\`\`\`
${isTruncated ? '\n[Diff truncated due to length - some changes may not be visible]' : ''}

## Your Task
Analyze the changes and determine:
1. What CRUD operations or business logic has changed
2. What form submissions or user actions are affected
3. What validation rules have been added/modified
4. What test data would be appropriate for testing (infer from validation rules and field types)
5. What success and error scenarios should be tested

Focus on:
- Form submissions and their expected outcomes
- Data creation/update/deletion flows
- Validation error scenarios (happy path + basic validation errors)
- Auth-protected operations

## Response Format
Respond with valid JSON only (no markdown, no explanation):
{
  "changes": [
    {
      "file": "path/to/file",
      "type": "api-endpoint|server-action|form-handler|validation|service|data-mutation",
      "operation": "create|read|update|delete|validate|authenticate|other",
      "description": "what this change does",
      "httpMethod": "GET|POST|PUT|PATCH|DELETE",
      "affectedRoute": "/path",
      "inputFields": [
        {
          "name": "fieldName",
          "type": "text|email|password|number|select|checkbox|textarea|file",
          "selector": "CSS selector like input[name='email'] or null if unknown",
          "validation": "description of validation rules if any",
          "required": true,
          "testValue": "appropriate test value based on field type and validation"
        }
      ],
      "expectedOutcomes": [
        {
          "scenario": "success|validation-error",
          "indicator": "CSS selector or text to verify like .toast-success or 'Created successfully'",
          "description": "what should happen"
        }
      ]
    }
  ],
  "routesToTest": [
    {
      "route": "/path",
      "reason": "why this route needs testing",
      "priority": "high|medium|low",
      "authRequired": true|false,
      "testTypes": [
        {
          "category": "logic",
          "subtype": "form-submission|crud-operation|error-handling",
          "details": {
            "action": "description like 'create new user'",
            "steps": [
              {"type": "navigate|fill|click|select|check|wait", "target": "selector", "value": "value", "description": "what this step does"}
            ],
            "assertions": [
              {"type": "visible|text|url|toast|redirect", "target": "selector", "expected": "expected value", "description": "what to verify"}
            ]
          }
        }
      ],
      "waitStrategy": "networkidle|domcontentloaded|load"
    }
  ],
  "testData": {
    "/route": {
      "fieldName": {
        "validValue": "test@example.com",
        "invalidValue": "not-an-email"
      }
    }
  },
  "confidence": 0.0 to 1.0,
  "reasoning": "explanation of analysis"
}`;
}

/**
 * Prompt for generating unified test code with both visual and logic tests
 */
export function buildUnifiedTestGenerationPrompt(
  routes: UnifiedTestRecommendation[],
  testUrl: string,
  loginFlow: LoginFlowAnalysis | undefined,
  testData: InferredTestData | undefined,
  prNumber: number
): string {
  const visualRoutes = routes.filter((r) =>
    r.testTypes.some((t) => t.category === 'visual')
  );
  const logicRoutes = routes.filter((r) =>
    r.testTypes.some((t) => t.category === 'logic')
  );
  const publicRoutes = routes.filter((r) => !r.authRequired);
  const authRoutes = routes.filter((r) => r.authRequired);

  let routeDetails = '';

  for (const route of routes) {
    routeDetails += `\n### ${route.route} ${route.authRequired ? '(auth required)' : '(public)'}\n`;
    routeDetails += `Reason: ${route.reason}\n`;
    routeDetails += `Priority: ${route.priority}\n`;

    for (const testType of route.testTypes) {
      if (testType.category === 'visual') {
        routeDetails += `- Visual: screenshot test\n`;
      } else {
        const details = testType.details as { action: string; steps: Array<{ description: string }>; assertions: Array<{ description: string }> };
        routeDetails += `- Logic (${testType.subtype}): ${details.action}\n`;
        if (details.steps && details.steps.length > 0) {
          routeDetails += `  Steps: ${details.steps.map((s) => s.description).join(' -> ')}\n`;
        }
        if (details.assertions && details.assertions.length > 0) {
          routeDetails += `  Verify: ${details.assertions.map((a) => a.description).join(', ')}\n`;
        }
      }
    }
  }

  return `Generate a UNIFIED Playwright test file for PR #${prNumber} containing both visual regression and behavioral tests.

## Test Configuration
- Base URL: ${testUrl}
- Viewport: 1920x1080 (Desktop)

## Summary
- Total routes: ${routes.length}
- Visual tests: ${visualRoutes.length} routes
- Logic tests: ${logicRoutes.length} routes
- Public: ${publicRoutes.length}, Auth required: ${authRoutes.length}

## Routes to Test
${routeDetails}

${testData ? `## Test Data
${JSON.stringify(testData, null, 2)}` : ''}

${
  loginFlow
    ? `## Login Flow (for authenticated routes)
- Login URL: ${loginFlow.loginUrl}
${loginFlow.loginModeToggleSelector ? `- Login mode toggle: ${loginFlow.loginModeToggleSelector} (${loginFlow.loginModeToggleDescription || 'click to enable password login'})` : ''}
- Username selector: ${loginFlow.usernameSelector}
- Password selector: ${loginFlow.passwordSelector}
- Submit selector: ${loginFlow.submitSelector}
- Success indicator: ${loginFlow.successIndicator}
- Success URL: ${loginFlow.successUrl || 'after login redirect'}

**CRITICAL: Credentials MUST use environment variables:**
- Username: process.env.TEST_USER!
- Password: process.env.TEST_PASSWORD!
DO NOT use placeholder values like 'testUser' or 'testPass'. Always use the exact expressions above.`
    : ''
}

## Requirements
1. Structure the test file with clear describe blocks:
   - "Visual Regression" for screenshot tests
   - "Functional Tests" for logic/behavioral tests
2. For authenticated routes, use beforeEach to handle login:
   - Navigate to login URL
   - If loginModeToggleSelector is provided, click it first to switch to password mode
   - Fill username with process.env.TEST_USER! (NOT a placeholder string)
   - Fill password with process.env.TEST_PASSWORD! (NOT a placeholder string)
   - Click submit button
   - Wait for success indicator or URL
3. For logic tests:
   - Test THROUGH the UI (fill forms, click buttons)
   - Include both success and validation error scenarios
   - Use clear, descriptive test names like "should create new user with valid data"
   - Wait appropriately for async operations
   - Verify results (success messages, redirects, data visibility)
4. For visual tests:
   - Use toHaveScreenshot() with maxDiffPixels: 100
   - Wait for networkidle before screenshots
5. Use data-testid selectors when mentioned, otherwise use semantic selectors
6. Handle errors gracefully
7. **NEVER use literal credential values** - always use process.env.TEST_USER! and process.env.TEST_PASSWORD!

## Response Format
Return ONLY the TypeScript code for the test file, no markdown code blocks or explanation:

import { test, expect } from '@playwright/test';

test.describe('PR #${prNumber} Tests', () => {
  // ... tests here
});`;
}
