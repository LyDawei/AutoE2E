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
  return `Analyze this login page to extract the login flow selectors for Playwright automation.

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
Extract the CSS selectors or Playwright locators for:
1. Username/email input field
2. Password input field
3. Submit/login button
4. Success indicator (what element appears after successful login)
5. Expected URL after successful login
6. **Login mode toggle** - CRITICAL: If the page has TABS or BUTTONS to switch between login methods (e.g., "Verification Code" vs "Password", "Email" vs "Phone", "SSO" vs "Password"), you MUST identify the selector to click BEFORE the password form is visible

## Response Format
Respond with valid JSON only:
{
  "loginUrl": "/login",
  "usernameSelector": "#password-email",
  "passwordSelector": "#password",
  "submitSelector": "button[type='submit']",
  "successIndicator": "[data-testid='dashboard']",
  "successUrl": "/dashboard",
  "loginModeToggleSelector": "button:has-text('Password')",
  "loginModeToggleDescription": "Click Password tab to switch from verification code mode"
}

## CRITICAL Rules for Login Mode Detection:

### Detecting Tab/Toggle Login Modes
Many modern login pages have MULTIPLE login methods in tabs or toggle buttons:
- "Verification Code" | "Password" tabs
- "Email" | "Phone" tabs
- "SSO" | "Password" options

**If you see ANY of these patterns, loginModeToggleSelector is REQUIRED:**
- Multiple \`<button>\` elements with text like "Password", "Verification Code", "Email", "Phone"
- Tab-like UI with different login modes
- Toggle buttons to switch authentication methods
- Buttons that show/hide different form sections

### Selector Priority (use in this order):
1. \`data-testid\` attributes: \`[data-testid='password-tab']\`
2. \`id\` attributes: \`#password-email\`, \`#password\`
3. Playwright text selectors for buttons without IDs: \`button:has-text('Password')\`
4. \`name\` attributes: \`input[name='email']\`
5. \`type\` + \`placeholder\` combination: \`input[type='email'][placeholder='your@email.com']\`
6. \`type\` alone: \`input[type='password']\`

### For Tab/Toggle Buttons Without IDs:
Use Playwright's text-based selectors:
- \`button:has-text('Password')\` - button containing "Password" text
- \`text=Password\` - exact text match
- \`:has-text('Sign in with')\` - partial text match

### Common Patterns to Look For:
- Form with \`action="?/passwordLogin"\` indicates password-based login
- Tabs with "Verification Code" and "Password" text
- \`id="password-email"\` for email field in password login mode
- \`id="password"\` for password field
- Multiple \`<button type="button">\` elements = likely login mode tabs

## Important Notes:
- ALWAYS check if password fields are inside a conditional/hidden section that requires clicking a tab first
- If the form has \`action="?/passwordLogin"\` or similar, there's likely a "Password" tab to click
- If no mode toggle exists (direct password login with no tabs), omit loginModeToggleSelector
- Test selectors should work with Playwright's page.click() and page.fill() methods`;
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

## ⚠️ CRITICAL CREDENTIAL RULES - READ CAREFULLY ⚠️
Credentials MUST use environment variables EXACTLY as shown:
- Username/Email: process.env.TEST_USER!
- Password: process.env.TEST_PASSWORD!

❌ WRONG - NEVER DO THIS (any literal string is WRONG):
  page.fill('#password-email', 'david.ly@company.com') // WRONG - real email!
  page.fill('#password', 'MyP@ssw0rd!')                // WRONG - real password!
  page.fill('input[name="username"]', 'testUser')      // WRONG!
  page.fill('input[name="password"]', 'testPassword')  // WRONG!
  page.fill('input[name="email"]', 'test@example.com') // WRONG!
  page.fill('input[name="password"]', 'password123')   // WRONG!

✅ CORRECT - ALWAYS DO THIS (always use process.env):
  page.fill('#password-email', process.env.TEST_USER!)
  page.fill('#password', process.env.TEST_PASSWORD!)
  page.fill('input[name="email"]', process.env.TEST_USER!)
  page.fill('input[type="password"]', process.env.TEST_PASSWORD!)`
    : ''
}

## Requirements
1. Group tests into "Public Pages" and "Authenticated Pages" describe blocks
2. For authenticated tests, use beforeEach to handle login:
   - Navigate to login URL
   - If loginModeToggleSelector is provided, click it first to switch to password mode
   - Fill username: page.fill(selector, process.env.TEST_USER!)
   - Fill password: page.fill(selector, process.env.TEST_PASSWORD!)
   - Click submit button
   - Wait for success indicator or URL
3. Wait for network idle before screenshots
4. Use descriptive screenshot names based on route
5. Handle errors gracefully
6. Use maxDiffPixels: 100 for tolerance
7. **ABSOLUTELY NO literal credential strings** - use process.env.TEST_USER! and process.env.TEST_PASSWORD!

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
  let code: string;
  if (codeBlockMatch) {
    code = codeBlockMatch[1].trim();
  } else {
    // If no code block, assume the entire response is code
    code = response.trim();
  }

  // Validate and fix any placeholder credentials
  return validateAndFixCredentials(code);
}

/**
 * Common placeholder credential patterns that AI models mistakenly generate
 */
const PLACEHOLDER_CREDENTIAL_PATTERNS = [
  // Common username placeholders
  /['"`]testUser['"`]/gi,
  /['"`]test_user['"`]/gi,
  /['"`]testuser['"`]/gi,
  /['"`]demoUser['"`]/gi,
  /['"`]demo_user['"`]/gi,
  /['"`]demouser['"`]/gi,
  /['"`]user123['"`]/gi,
  /['"`]admin['"`]/gi,
  /['"`]testAdmin['"`]/gi,
  /['"`]test@test\.com['"`]/gi,
  /['"`]user@example\.com['"`]/gi,
  /['"`]test@example\.com['"`]/gi,
  /['"`]admin@example\.com['"`]/gi,
  // Common password placeholders
  /['"`]testPassword['"`]/gi,
  /['"`]test_password['"`]/gi,
  /['"`]testpassword['"`]/gi,
  /['"`]password123['"`]/gi,
  /['"`]Password123['"`]/gi,
  /['"`]test123['"`]/gi,
  /['"`]Test123['"`]/gi,
  /['"`]demo123['"`]/gi,
  /['"`]Demo123['"`]/gi,
  /['"`]demoPassword['"`]/gi,
  /['"`]secret['"`]/gi,
  /['"`]password['"`]/gi,
  /['"`]pass['"`]/gi,
  /['"`]testPass['"`]/gi,
  /['"`]test_pass['"`]/gi,
];

/**
 * Helper function to check if a selector is for a credential field (username or password)
 */
function isCredentialSelector(selector: string): boolean {
  // Remove outer quotes for analysis
  const s = selector.toLowerCase().replace(/^['"`]|['"`]$/g, '');

  // Check for username patterns
  if (s.includes('user') || s.includes('email') || s.includes('login') ||
      s.includes('credential') || s.includes('auth')) {
    return true;
  }

  // Check for password patterns (but password-email is username, not password)
  if ((s.includes('password') || s.includes('pass') || s.includes('pwd')) && !s.includes('password-email')) {
    return true;
  }

  // Handle #password-email as a credential field (it's a username field)
  if (s.includes('password-email')) {
    return true;
  }

  // Check for type="email" or type="password"
  if (s.includes('type="email"') || s.includes("type='email'") ||
      s.includes('type="password"') || s.includes("type='password'")) {
    return true;
  }

  // Check for autocomplete attributes
  if (s.includes('autocomplete')) {
    return true;
  }

  // Check for placeholder with email indicators
  if (s.includes('placeholder') && (s.includes('@') || s.includes('email'))) {
    return true;
  }

  return false;
}

/**
 * Detects if code contains placeholder credentials in page.fill() calls
 */
export function detectPlaceholderCredentials(code: string): { hasPlaceholders: boolean; issues: string[] } {
  const issues: string[] = [];

  // Find all page.fill() calls
  // The pattern handles selectors that may contain nested quotes (e.g., 'input[name="email"]')
  const fillCalls = code.matchAll(/page\.fill\s*\(\s*('[^']*'|"[^"]*"|`[^`]*`)\s*,\s*('[^']*'|"[^"]*"|`[^`]*`|[^)]+)\s*\)/g);

  for (const match of fillCalls) {
    const selector = match[1];
    const value = match[2];

    // Check if this looks like a credential field using our helper function
    if (isCredentialSelector(selector)) {
      // Check if the value is a literal string (not process.env)
      if (!value.includes('process.env')) {
        // Check for known placeholder patterns first
        for (const pattern of PLACEHOLDER_CREDENTIAL_PATTERNS) {
          if (pattern.test(value)) {
            issues.push(`Found placeholder credential: ${value} in fill(${match[1]}, ...)`);
            break;
          }
        }

        // Also check for any quoted string value that's not a process.env reference
        if (value.match(/^['"`][^'"`]+['"`]$/) && !value.includes('process.env')) {
          const valueContent = value.slice(1, -1).toLowerCase();
          // Common patterns that suggest test credentials
          const hasCommonPattern =
            valueContent.includes('test') ||
            valueContent.includes('demo') ||
            valueContent.includes('123') ||
            valueContent.includes('password') ||
            valueContent.includes('admin') ||
            valueContent.includes('user') ||
            valueContent.includes('@example') ||
            valueContent.includes('@test') ||
            // Also catch real-looking emails that aren't from env
            (valueContent.includes('@') && valueContent.includes('.'));

          // For password fields, ANY literal string should be flagged
          const isPasswordField = isPasswordSelector(selector);

          if (hasCommonPattern || isPasswordField) {
            if (!issues.some((i) => i.includes(value))) {
              issues.push(`Suspicious credential value: ${value} in fill(${match[1]}, ...) - should use process.env`);
            }
          }
        }
      }
    }
  }

  return { hasPlaceholders: issues.length > 0, issues };
}

/**
 * Validates and fixes placeholder credentials in generated code.
 * Replaces hardcoded credential values with proper process.env references.
 *
 * @param code - The generated test code to validate and fix
 * @returns The code with placeholder credentials replaced by process.env references
 *
 * @remarks
 * This function implements defense-in-depth by:
 * 1. Scanning for common placeholder patterns in page.fill() calls
 * 2. Replacing detected placeholders with process.env.TEST_USER! or process.env.TEST_PASSWORD!
 * 3. Running a final detection pass to warn about any remaining issues
 *
 * Known limitations:
 * - Does not detect template literals or string concatenation
 * - Only scans page.fill() calls, not page.type() or other methods
 */
/**
 * Helper function to determine if a selector is for a username/email field
 * This function handles tricky cases like #password-email which is an email field
 */
function isUsernameSelector(selector: string): boolean {
  // Remove outer quotes for analysis
  const s = selector.toLowerCase().replace(/^['"`]|['"`]$/g, '');

  // Explicit email patterns - these are always username fields
  if (s.includes('password-email')) return true; // #password-email is email, not password
  if (s.includes('type="email"') || s.includes("type='email'")) return true;
  if (s.includes('name="email"') || s.includes("name='email'")) return true;
  if (s.includes('name="username"') || s.includes("name='username'")) return true;
  if (s.includes('name="user"') || s.includes("name='user'")) return true;
  if (s.includes('data-testid') && (s.includes('email') || s.includes('user'))) return true;
  if (s.includes('placeholder') && (s.includes('@') || s.includes('email'))) return true;

  // ID selectors for username - #email, #username, etc
  if (/^#(email|username|user|login|password-email)$/i.test(s)) return true;

  // General keywords for username (but not if it's clearly a password field)
  if ((s.includes('email') || s.includes('user') || s.includes('login')) && !s.match(/#password(?!-email)/)) return true;

  return false;
}

/**
 * Helper function to determine if a selector is for a password field
 * Excludes selectors like #password-email which are email fields
 */
function isPasswordSelector(selector: string): boolean {
  // Remove outer quotes for analysis
  const s = selector.toLowerCase().replace(/^['"`]|['"`]$/g, '');

  // Explicit password patterns
  if (s.includes('password-email')) return false; // This is email, not password!
  if (s.includes('type="password"') || s.includes("type='password'")) return true;
  if (s.includes('name="password"') || s.includes("name='password'")) return true;
  if (s.includes('name="pass"') || s.includes("name='pass'")) return true;
  if (s.includes('autocomplete="current-password"') || s.includes('autocomplete="new-password"')) return true;
  if (s.includes('data-testid') && s.includes('password')) return true;

  // ID selectors for password - #password but NOT #password-email
  if (/^#(password|pass|pwd)$/i.test(s)) return true;

  // General password keywords (but not password-email)
  if ((s.includes('password') || s.includes('pass') || s.includes('pwd')) && !s.includes('password-email')) return true;

  return false;
}

export function validateAndFixCredentials(code: string): string {
  // Defensive input validation
  if (!code || typeof code !== 'string') {
    return code || '';
  }

  let fixedCode = code;

  // Track what we've already fixed to avoid double-fixing
  const fixedSelectors = new Set<string>();

  // Find all page.fill() calls and categorize them
  // The pattern handles selectors that may contain nested quotes (e.g., 'input[name="email"]')
  // by matching each quote type separately: single quotes, double quotes, or backticks
  const fillCallPattern = /page\.fill\s*\(\s*('[^']*'|"[^"]*"|`[^`]*`)\s*,\s*('[^']*'|"[^"]*"|`[^`]*`|[^)]+)\s*\)/g;

  fixedCode = fixedCode.replace(fillCallPattern, (match, selector, value) => {
    // Skip if already using process.env
    if (value.includes('process.env')) {
      return match;
    }

    // Check if this is a password field - if so, ANY literal value should be replaced
    if (isPasswordSelector(selector)) {
      if (!fixedSelectors.has(selector)) {
        logger.warn(`Fixed placeholder password in selector ${selector} -> process.env.TEST_PASSWORD!`);
        fixedSelectors.add(selector);
      }
      return `page.fill(${selector}, process.env.TEST_PASSWORD!)`;
    }

    // Check if this is a username field
    if (isUsernameSelector(selector)) {
      // Check if value looks like a placeholder credential
      const valueLower = value.toLowerCase();
      const isPlaceholder =
        valueLower.includes('test') ||
        valueLower.includes('demo') ||
        valueLower.includes('user') ||
        valueLower.includes('admin') ||
        valueLower.includes('@example') ||
        valueLower.includes('@test') ||
        valueLower.includes('123') ||
        valueLower.includes('pass') ||
        valueLower.includes('secret') ||
        // Also catch real-looking emails
        (valueLower.includes('@') && valueLower.includes('.'));

      if (isPlaceholder) {
        if (!fixedSelectors.has(selector)) {
          logger.warn(`Fixed placeholder username in selector ${selector} -> process.env.TEST_USER!`);
          fixedSelectors.add(selector);
        }
        return `page.fill(${selector}, process.env.TEST_USER!)`;
      }
    }

    return match;
  });

  // Log summary if fixes were made
  if (fixedSelectors.size > 0) {
    const usernameCount = Array.from(fixedSelectors).filter(s => isUsernameSelector(s)).length;
    const passwordCount = fixedSelectors.size - usernameCount;
    logger.info(`Credential validation: fixed ${usernameCount} username(s) and ${passwordCount} password(s)`);
  }

  // Final detection pass to warn about anything we couldn't fix
  const { hasPlaceholders, issues } = detectPlaceholderCredentials(fixedCode);
  if (hasPlaceholders) {
    logger.warn('Some potential placeholder credentials could not be automatically fixed:');
    for (const issue of issues) {
      logger.warn(`  - ${issue}`);
    }
  }

  return fixedCode;
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

## ⚠️ CRITICAL CREDENTIAL RULES - READ CAREFULLY ⚠️
Credentials MUST use environment variables EXACTLY as shown:
- Username/Email: process.env.TEST_USER!
- Password: process.env.TEST_PASSWORD!

❌ WRONG - NEVER DO THIS (any literal string is WRONG):
  page.fill('#password-email', 'david.ly@company.com') // WRONG - real email!
  page.fill('#password', 'MyP@ssw0rd!')                // WRONG - real password!
  page.fill('input[name="username"]', 'testUser')      // WRONG!
  page.fill('input[name="password"]', 'testPassword')  // WRONG!
  page.fill('input[name="email"]', 'test@example.com') // WRONG!
  page.fill('input[name="password"]', 'password123')   // WRONG!

✅ CORRECT - ALWAYS DO THIS (always use process.env):
  page.fill('#password-email', process.env.TEST_USER!)
  page.fill('#password', process.env.TEST_PASSWORD!)
  page.fill('input[name="email"]', process.env.TEST_USER!)
  page.fill('input[type="password"]', process.env.TEST_PASSWORD!)`
    : ''
}

## Requirements
1. Structure the test file with clear describe blocks:
   - "Visual Regression" for screenshot tests
   - "Functional Tests" for logic/behavioral tests
2. For authenticated routes, use beforeEach to handle login:
   - Navigate to login URL
   - If loginModeToggleSelector is provided, click it first to switch to password mode
   - Fill username: page.fill(selector, process.env.TEST_USER!)
   - Fill password: page.fill(selector, process.env.TEST_PASSWORD!)
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
7. **ABSOLUTELY NO literal credential strings** - use process.env.TEST_USER! and process.env.TEST_PASSWORD!

## Response Format
Return ONLY the TypeScript code for the test file, no markdown code blocks or explanation:

import { test, expect } from '@playwright/test';

test.describe('PR #${prNumber} Tests', () => {
  // ... tests here
});`;
}
