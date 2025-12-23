import type { Route } from '../analyzer/types.js';
import type { RouteTestRecommendation, LoginFlowAnalysis } from './types.js';

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

  return `You are analyzing a GitHub PR diff for a SvelteKit application to determine visual regression testing needs.

## Changed Files
${changedFiles.map((f) => `- ${f}`).join('\n')}

## Available Routes
${routeList}

## Diff Content
\`\`\`diff
${diff.slice(0, 15000)}
\`\`\`
${diff.length > 15000 ? '\n[Diff truncated due to length]' : ''}

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
  return `Analyze this SvelteKit login page to extract the login flow selectors.

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

## Response Format
Respond with valid JSON only:
{
  "loginUrl": "/login",
  "usernameSelector": "input[name='email']",
  "passwordSelector": "input[name='password']",
  "submitSelector": "button[type='submit']",
  "successIndicator": "[data-testid='dashboard']",
  "successUrl": "/dashboard"
}

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
- Username selector: ${loginFlow.usernameSelector}
- Password selector: ${loginFlow.passwordSelector}
- Submit selector: ${loginFlow.submitSelector}
- Success indicator: ${loginFlow.successIndicator}
- Success URL: ${loginFlow.successUrl || 'N/A'}`
    : ''
}

## Requirements
1. Group tests into "Public Pages" and "Authenticated Pages" describe blocks
2. For authenticated tests, use beforeEach to handle login
3. Use process.env.TEST_USER and process.env.TEST_PASSWORD for credentials
4. Wait for network idle before screenshots
5. Use descriptive screenshot names based on route
6. Handle errors gracefully
7. Use maxDiffPixels: 100 for tolerance

## Response Format
Return ONLY the TypeScript code for the test file, no markdown code blocks or explanation:

import { test, expect } from '@playwright/test';

test.describe('PR #${prNumber} Visual Regression', () => {
  // ... tests here
});`;
}

/**
 * Parse AI response to extract JSON
 */
export function parseAIResponse<T>(response: string): T {
  // Try to parse directly
  try {
    return JSON.parse(response);
  } catch {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error('Failed to parse AI response as JSON');
      }
    }
    throw new Error('No JSON found in AI response');
  }
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
