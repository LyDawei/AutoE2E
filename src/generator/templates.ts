import type {
  RouteTestRecommendation,
  LoginFlowAnalysis,
  UnifiedTestRecommendation,
  VisualTestDetails,
} from '../ai/types.js';
import { generateLogicTestsSection, generateLoginBeforeEach } from './logic-templates.js';
import { routeToScreenshotName } from '../utils/route-helpers.js';
import { validateAndFixCredentials } from '../ai/prompts.js';

/**
 * Generate a complete Playwright test file
 * Applies validateAndFixCredentials as a defense-in-depth measure
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

  const content = `${imports}

test.describe('PR #${prNumber} Visual Regression', () => {
${publicTests}${publicTests && authTests ? '\n' : ''}${authTests}});
`;

  // Defense-in-depth: validate and fix any remaining credential issues
  return validateAndFixCredentials(content);
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

// ============================================
// Unified Test Generation (Visual + Logic)
// ============================================

/**
 * Generate a unified Playwright test file with both visual and logic tests
 * Applies validateAndFixCredentials as a defense-in-depth measure
 */
export function generateUnifiedTestFile(
  prNumber: number,
  routes: UnifiedTestRecommendation[],
  loginFlow?: LoginFlowAnalysis
): string {
  const imports = `import { test, expect } from '@playwright/test';`;

  const visualSection = generateVisualTestsSection(routes, loginFlow);
  const logicSection = generateLogicTestsSection(routes, loginFlow);

  // Combine sections
  let content = `${imports}

test.describe('PR #${prNumber} Tests', () => {
`;

  if (visualSection) {
    content += visualSection;
  }

  if (visualSection && logicSection) {
    content += '\n';
  }

  if (logicSection) {
    content += logicSection;
  }

  content += '});\n';

  // Defense-in-depth: validate and fix any remaining credential issues
  return validateAndFixCredentials(content);
}

/**
 * Generate the visual tests section of a unified test file
 */
function generateVisualTestsSection(
  routes: UnifiedTestRecommendation[],
  loginFlow?: LoginFlowAnalysis
): string {
  const visualRoutes = routes.filter((r) =>
    r.testTypes.some((t) => t.category === 'visual')
  );

  if (visualRoutes.length === 0) {
    return '';
  }

  const publicRoutes = visualRoutes.filter((r) => !r.authRequired);
  const authRoutes = visualRoutes.filter((r) => r.authRequired);

  let content = `  test.describe('Visual Regression', () => {\n`;

  // Public visual tests
  if (publicRoutes.length > 0) {
    content += `    test.describe('Public Pages', () => {\n`;
    for (const route of publicRoutes) {
      content += generateUnifiedVisualTest(route, '      ') + '\n';
    }
    content += `    });\n`;
  }

  // Authenticated visual tests
  if (authRoutes.length > 0) {
    content += `\n    test.describe('Authenticated Pages', () => {\n`;
    content += generateLoginBeforeEach(loginFlow) + '\n\n';
    for (const route of authRoutes) {
      content += generateUnifiedVisualTest(route, '      ') + '\n';
    }
    content += `    });\n`;
  }

  content += `  });\n`;
  return content;
}

/**
 * Generate a single visual test from unified recommendation
 */
function generateUnifiedVisualTest(
  route: UnifiedTestRecommendation,
  indent: string = '    '
): string {
  const visualTestType = route.testTypes.find((t) => t.category === 'visual');
  if (!visualTestType) {
    return '';
  }

  const details = visualTestType.details as VisualTestDetails;
  const testName = route.route === '/' ? 'Home page' : route.route;
  const screenshotName = details.screenshotName || routeToScreenshotName(route.route);
  const waitStrategy = route.waitStrategy || 'networkidle';

  let waitFor = '';
  if (details.waitFor) {
    waitFor = `\n${indent}  await page.waitForSelector('${details.waitFor}');`;
  }

  let maskOption = '';
  if (details.maskSelectors && details.maskSelectors.length > 0) {
    const masks = details.maskSelectors.map((s) => `page.locator('${s}')`).join(', ');
    maskOption = `,\n${indent}    mask: [${masks}]`;
  }

  return `${indent}test('${testName}', async ({ page }) => {
${indent}  await page.goto('${route.route}');
${indent}  await page.waitForLoadState('${waitStrategy}');${waitFor}
${indent}  await expect(page).toHaveScreenshot('${screenshotName}.png', {
${indent}    maxDiffPixels: 100${maskOption}
${indent}  });
${indent}});`;
}
