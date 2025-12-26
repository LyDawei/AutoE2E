import type {
  LogicTestDetails,
  TestStep,
  TestAssertion,
  UnifiedTestRecommendation,
  LoginFlowAnalysis,
} from '../ai/types.js';

/**
 * Escape single quotes in strings for safe interpolation into generated code
 * This prevents code injection via malformed AI responses
 */
function escapeForCode(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Check if a string is a regex pattern (prefix with "regex:" for explicit regex)
 * This avoids ambiguity with URL paths like "/api/users/"
 */
function isRegexPattern(value: string): boolean {
  // Explicit regex marker: "regex:/pattern/"
  if (value.startsWith('regex:')) {
    return true;
  }
  // Legacy support: /pattern/ that looks like a regex (contains regex metacharacters)
  if (value.startsWith('/') && value.endsWith('/') && value.length > 2) {
    const inner = value.slice(1, -1);
    // Check if it contains regex metacharacters (not just a path)
    return /[\\^$.*+?()[\]{}|]/.test(inner);
  }
  return false;
}

/**
 * Extract regex pattern from value (handles "regex:/pattern/" format)
 */
function extractRegexPattern(value: string): string {
  if (value.startsWith('regex:')) {
    return value.slice(6); // Remove "regex:" prefix
  }
  return value; // Already in /pattern/ format
}

/**
 * Generate code for a single test step
 */
export function generateStepCode(step: TestStep): string {
  switch (step.type) {
    case 'navigate':
      return `await page.goto('${escapeForCode(step.value || step.target)}');`;
    case 'fill':
      return `await page.fill('${escapeForCode(step.target)}', '${escapeForCode(step.value)}');`;
    case 'click':
      return `await page.click('${escapeForCode(step.target)}');`;
    case 'select':
      return `await page.selectOption('${escapeForCode(step.target)}', '${escapeForCode(step.value)}');`;
    case 'check':
      return `await page.check('${escapeForCode(step.target)}');`;
    case 'wait':
      return `await page.waitForSelector('${escapeForCode(step.target)}');`;
    case 'upload':
      return `await page.setInputFiles('${escapeForCode(step.target)}', '${escapeForCode(step.value)}');`;
    default:
      return `// Unknown step type: ${step.type}`;
  }
}

/**
 * Generate code for a single assertion
 */
export function generateAssertionCode(assertion: TestAssertion): string {
  switch (assertion.type) {
    case 'visible':
      return `await expect(page.locator('${escapeForCode(assertion.target)}')).toBeVisible();`;
    case 'text':
      return `await expect(page.locator('${escapeForCode(assertion.target)}')).toContainText('${escapeForCode(assertion.expected)}');`;
    case 'url':
      // Handle both exact URL and regex pattern
      // Use explicit "regex:/pattern/" format or detect regex metacharacters
      if (isRegexPattern(assertion.expected)) {
        return `await expect(page).toHaveURL(${extractRegexPattern(assertion.expected)});`;
      }
      return `await expect(page).toHaveURL('${escapeForCode(assertion.expected)}');`;
    case 'count':
      return `await expect(page.locator('${escapeForCode(assertion.target)}')).toHaveCount(${assertion.expected});`;
    case 'attribute': {
      // Use split with limit to handle values containing '='
      const eqIndex = assertion.expected.indexOf('=');
      const attr = eqIndex > 0 ? assertion.expected.slice(0, eqIndex) : assertion.expected;
      const value = eqIndex > 0 ? assertion.expected.slice(eqIndex + 1) : '';
      return `await expect(page.locator('${escapeForCode(assertion.target)}')).toHaveAttribute('${escapeForCode(attr)}', '${escapeForCode(value)}');`;
    }
    case 'toast':
      return `await expect(page.locator('[role="alert"], .toast, .notification, [data-testid="toast"]')).toContainText('${escapeForCode(assertion.expected)}');`;
    case 'redirect':
      return `await page.waitForURL('${escapeForCode(assertion.expected)}');`;
    default:
      return `// Unknown assertion type: ${assertion.type}`;
  }
}

/**
 * Generate a form submission test
 */
export function generateFormSubmissionTest(
  route: string,
  details: LogicTestDetails,
  testName: string,
  indent: string = '    '
): string {
  const steps = details.steps
    .map((step) => `${indent}  ${generateStepCode(step)}`)
    .join('\n');
  const assertions = details.assertions
    .map((assertion) => `${indent}  ${generateAssertionCode(assertion)}`)
    .join('\n');

  return `${indent}test('${escapeForCode(testName)}', async ({ page }) => {
${indent}  await page.goto('${escapeForCode(route)}');
${indent}  await page.waitForLoadState('networkidle');

${steps}

${assertions}
${indent}});`;
}

/**
 * Generate a CRUD operation test
 */
export function generateCrudTest(
  route: string,
  operation: 'create' | 'read' | 'update' | 'delete',
  details: LogicTestDetails,
  indent: string = '    '
): string {
  const testName = `should ${operation} successfully`;
  return generateFormSubmissionTest(route, details, testName, indent);
}

/**
 * Generate an error handling test
 */
export function generateErrorHandlingTest(
  route: string,
  scenario: string,
  details: LogicTestDetails,
  indent: string = '    '
): string {
  const testName = `should show error for ${scenario}`;
  return generateFormSubmissionTest(route, details, testName, indent);
}

/**
 * Generate a logic test from unified recommendation
 */
export function generateLogicTest(
  route: UnifiedTestRecommendation,
  testTypeIndex: number,
  indent: string = '    '
): string {
  const testType = route.testTypes[testTypeIndex];
  if (testType.category !== 'logic') {
    return '';
  }

  const details = testType.details as LogicTestDetails;
  let testName: string;

  switch (testType.subtype) {
    case 'form-submission':
      testName = `should ${details.action}`;
      break;
    case 'crud-operation':
      testName = `should ${details.action}`;
      break;
    case 'error-handling':
      testName = `should handle error: ${details.action}`;
      break;
    case 'navigation-flow':
      testName = `should complete flow: ${details.action}`;
      break;
    case 'state-verification':
      testName = `should verify: ${details.action}`;
      break;
    default:
      testName = details.action;
  }

  return generateFormSubmissionTest(route.route, details, testName, indent);
}

/**
 * Generate all logic tests for a route
 */
export function generateRouteLogicTests(
  route: UnifiedTestRecommendation,
  indent: string = '    '
): string[] {
  const tests: string[] = [];

  for (let i = 0; i < route.testTypes.length; i++) {
    const testType = route.testTypes[i];
    if (testType.category === 'logic') {
      const test = generateLogicTest(route, i, indent);
      if (test) {
        tests.push(test);
      }
    }
  }

  return tests;
}

/**
 * Generate the logic tests section of a unified test file
 */
export function generateLogicTestsSection(
  routes: UnifiedTestRecommendation[],
  loginFlow?: LoginFlowAnalysis
): string {
  const logicRoutes = routes.filter((r) =>
    r.testTypes.some((t) => t.category === 'logic')
  );

  if (logicRoutes.length === 0) {
    return '';
  }

  const publicRoutes = logicRoutes.filter((r) => !r.authRequired);
  const authRoutes = logicRoutes.filter((r) => r.authRequired);

  let content = `  test.describe('Functional Tests', () => {\n`;

  // Public logic tests
  if (publicRoutes.length > 0) {
    content += `    test.describe('Public', () => {\n`;
    for (const route of publicRoutes) {
      const tests = generateRouteLogicTests(route, '      ');
      content += tests.join('\n\n') + '\n';
    }
    content += `    });\n`;
  }

  // Authenticated logic tests
  if (authRoutes.length > 0) {
    content += `\n    test.describe('Authenticated', () => {\n`;
    content += generateLoginBeforeEach(loginFlow, '      ');
    content += '\n\n';
    for (const route of authRoutes) {
      const tests = generateRouteLogicTests(route, '      ');
      content += tests.join('\n\n') + '\n';
    }
    content += `    });\n`;
  }

  content += `  });\n`;
  return content;
}

/**
 * Generate login beforeEach hook
 */
export function generateLoginBeforeEach(
  loginFlow?: LoginFlowAnalysis,
  indent: string = '    '
): string {
  if (!loginFlow) {
    return `${indent}test.beforeEach(async ({ page }) => {
${indent}  // TODO: Customize login flow for your application
${indent}  await page.goto('/login');
${indent}  await page.fill('input[type="email"], input[name="email"], #email', process.env.TEST_USER!);
${indent}  await page.fill('input[type="password"], input[name="password"], #password', process.env.TEST_PASSWORD!);
${indent}  await page.click('button[type="submit"]');
${indent}  await page.waitForLoadState('networkidle');
${indent}});`;
  }

  const successWait = loginFlow.successUrl
    ? `await page.waitForURL('${escapeForCode(loginFlow.successUrl)}');`
    : `await page.waitForSelector('${escapeForCode(loginFlow.successIndicator)}');`;

  return `${indent}test.beforeEach(async ({ page }) => {
${indent}  await page.goto('${escapeForCode(loginFlow.loginUrl)}');
${indent}  await page.fill('${escapeForCode(loginFlow.usernameSelector)}', process.env.TEST_USER!);
${indent}  await page.fill('${escapeForCode(loginFlow.passwordSelector)}', process.env.TEST_PASSWORD!);
${indent}  await page.click('${escapeForCode(loginFlow.submitSelector)}');
${indent}  ${successWait}
${indent}});`;
}
