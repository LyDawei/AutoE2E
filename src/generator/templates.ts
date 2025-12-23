import type { RouteTestRecommendation, LoginFlowAnalysis } from '../ai/types.js';

/**
 * Generate a complete Playwright test file
 */
export function generateTestFile(
  prNumber: number,
  routes: RouteTestRecommendation[],
  loginFlow?: LoginFlowAnalysis
): string {
  const publicRoutes = routes.filter((r) => !r.authRequired);
  const authRoutes = routes.filter((r) => r.authRequired);

  const imports = `import { test, expect } from '@playwright/test';`;

  const publicTests = publicRoutes.length > 0 ? generatePublicTests(publicRoutes) : '';
  const authTests = authRoutes.length > 0 ? generateAuthTests(authRoutes, loginFlow) : '';

  return `${imports}

test.describe('PR #${prNumber} Visual Regression', () => {
${publicTests}${publicTests && authTests ? '\n' : ''}${authTests}});
`;
}

/**
 * Generate tests for public routes
 */
function generatePublicTests(routes: RouteTestRecommendation[]): string {
  const tests = routes.map((route) => generateSingleTest(route)).join('\n\n');

  return `  test.describe('Public Pages', () => {
${tests}
  });`;
}

/**
 * Generate tests for authenticated routes
 */
function generateAuthTests(
  routes: RouteTestRecommendation[],
  loginFlow?: LoginFlowAnalysis
): string {
  const beforeEach = generateLoginBeforeEach(loginFlow);
  const tests = routes.map((route) => generateSingleTest(route)).join('\n\n');

  return `  test.describe('Authenticated Pages', () => {
${beforeEach}

${tests}
  });`;
}

/**
 * Generate a single test case
 */
function generateSingleTest(route: RouteTestRecommendation): string {
  const testName = route.route === '/' ? 'Home page' : route.route;
  const screenshotName = routeToScreenshotName(route.route);
  const waitStrategy = route.waitStrategy || 'networkidle';

  return `    test('${testName}', async ({ page }) => {
      await page.goto('${route.route}');
      await page.waitForLoadState('${waitStrategy}');
      await expect(page).toHaveScreenshot('${screenshotName}.png', {
        maxDiffPixels: 100,
      });
    });`;
}

/**
 * Generate login beforeEach hook
 */
function generateLoginBeforeEach(loginFlow?: LoginFlowAnalysis): string {
  if (!loginFlow) {
    // Generate a generic login flow that users can customize
    return `    test.beforeEach(async ({ page }) => {
      // TODO: Customize login flow for your application
      await page.goto('/login');
      await page.fill('input[type="email"], input[name="email"], #email', process.env.TEST_USER!);
      await page.fill('input[type="password"], input[name="password"], #password', process.env.TEST_PASSWORD!);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle');
    });`;
  }

  const successWait = loginFlow.successUrl
    ? `await page.waitForURL('${loginFlow.successUrl}');`
    : `await page.waitForSelector('${loginFlow.successIndicator}');`;

  return `    test.beforeEach(async ({ page }) => {
      await page.goto('${loginFlow.loginUrl}');
      await page.fill('${loginFlow.usernameSelector}', process.env.TEST_USER!);
      await page.fill('${loginFlow.passwordSelector}', process.env.TEST_PASSWORD!);
      await page.click('${loginFlow.submitSelector}');
      ${successWait}
    });`;
}

/**
 * Convert route path to a valid screenshot name
 */
function routeToScreenshotName(route: string): string {
  if (route === '/') {
    return 'home';
  }

  return route
    .replace(/^\//, '') // Remove leading slash
    .replace(/\//g, '-') // Replace slashes with dashes
    .replace(/\[([^\]]+)\]/g, '$1') // Remove brackets from dynamic segments
    .replace(/\.\.\./g, 'rest') // Handle rest params
    .replace(/[^a-zA-Z0-9-]/g, '-') // Replace other special chars
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/-$/, ''); // Remove trailing dash
}

/**
 * Generate a fallback heuristic-based test file when AI is unavailable
 */
export function generateFallbackTestFile(
  prNumber: number,
  routes: Array<{ path: string; isAuthProtected: boolean }>
): string {
  const recommendations: RouteTestRecommendation[] = routes.map((route) => ({
    route: route.path,
    reason: 'Route may be affected by changes',
    priority: 'medium' as const,
    authRequired: route.isAuthProtected,
    waitStrategy: 'networkidle' as const,
  }));

  return generateTestFile(prNumber, recommendations);
}
