import { describe, it, expect } from 'vitest';
import { generateTestFile, generateFallbackTestFile, generateUnifiedTestFile } from '../../src/generator/templates.js';
import type { RouteTestRecommendation, LoginFlowAnalysis, UnifiedTestRecommendation } from '../../src/ai/types.js';

describe('generateTestFile', () => {
  it('generates test file with public routes only', () => {
    const routes: RouteTestRecommendation[] = [
      {
        route: '/',
        reason: 'Home page changed',
        priority: 'high',
        authRequired: false,
        waitStrategy: 'networkidle',
      },
      {
        route: '/about',
        reason: 'About page updated',
        priority: 'medium',
        authRequired: false,
      },
    ];

    const result = generateTestFile(123, routes);

    expect(result).toContain("import { test, expect } from '@playwright/test'");
    expect(result).toContain("test.describe('PR #123 Visual Regression'");
    expect(result).toContain("test.describe('Public Pages'");
    expect(result).toContain("test('Home page'");
    expect(result).toContain("test('/about'");
    expect(result).toContain("toHaveScreenshot('home.png'");
    expect(result).toContain("toHaveScreenshot('about.png'");
    expect(result).not.toContain('Authenticated Pages');
  });

  it('generates test file with auth routes', () => {
    const routes: RouteTestRecommendation[] = [
      {
        route: '/portal',
        reason: 'Portal dashboard changed',
        priority: 'high',
        authRequired: true,
      },
    ];

    const result = generateTestFile(456, routes);

    expect(result).toContain("test.describe('Authenticated Pages'");
    expect(result).toContain('test.beforeEach');
    expect(result).toContain('process.env.TEST_USER');
    expect(result).toContain('process.env.TEST_PASSWORD');
    expect(result).toContain("test('/portal'");
  });

  it('generates test file with custom login flow', () => {
    const routes: RouteTestRecommendation[] = [
      {
        route: '/dashboard',
        reason: 'Dashboard changed',
        priority: 'high',
        authRequired: true,
      },
    ];

    const loginFlow: LoginFlowAnalysis = {
      loginUrl: '/auth/login',
      usernameSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button#submit',
      successIndicator: '[data-testid="dashboard"]',
      successUrl: '/dashboard',
    };

    const result = generateTestFile(789, routes, loginFlow);

    expect(result).toContain("page.goto('/auth/login')");
    expect(result).toContain("page.fill('#email', process.env.TEST_USER!)");
    expect(result).toContain("page.fill('#password', process.env.TEST_PASSWORD!)");
    expect(result).toContain("page.click('button#submit')");
    expect(result).toContain("page.waitForURL('/dashboard')");
  });

  it('generates test file with both public and auth routes', () => {
    const routes: RouteTestRecommendation[] = [
      {
        route: '/',
        reason: 'Home changed',
        priority: 'high',
        authRequired: false,
      },
      {
        route: '/portal',
        reason: 'Portal changed',
        priority: 'high',
        authRequired: true,
      },
    ];

    const result = generateTestFile(100, routes);

    expect(result).toContain("test.describe('Public Pages'");
    expect(result).toContain("test.describe('Authenticated Pages'");
  });

  it('handles empty routes', () => {
    const result = generateTestFile(999, []);

    expect(result).toContain("test.describe('PR #999 Visual Regression'");
    // Should not throw, should generate valid but empty test structure
  });
});

describe('generateFallbackTestFile', () => {
  it('generates fallback test file from route info', () => {
    const routes = [
      { path: '/', isAuthProtected: false },
      { path: '/admin', isAuthProtected: true },
    ];

    const result = generateFallbackTestFile(200, routes);

    expect(result).toContain("test.describe('PR #200 Visual Regression'");
    expect(result).toContain("test('Home page'");
    expect(result).toContain("test('/admin'");
  });
});

describe('generateUnifiedTestFile', () => {
  it('generates empty test structure with no routes', () => {
    const result = generateUnifiedTestFile(100, []);

    expect(result).toContain("import { test, expect } from '@playwright/test'");
    expect(result).toContain("test.describe('PR #100 Tests'");
  });

  it('generates visual tests only', () => {
    const routes: UnifiedTestRecommendation[] = [
      {
        route: '/',
        reason: 'Home changed',
        priority: 'high',
        authRequired: false,
        testTypes: [
          { category: 'visual', subtype: 'screenshot', details: { screenshotName: 'home' } },
        ],
      },
    ];

    const result = generateUnifiedTestFile(101, routes);

    expect(result).toContain("test.describe('Visual Regression'");
    expect(result).toContain("toHaveScreenshot('home.png'");
    expect(result).not.toContain("test.describe('Functional Tests'");
  });

  it('generates logic tests only', () => {
    const routes: UnifiedTestRecommendation[] = [
      {
        route: '/contact',
        reason: 'Form changed',
        priority: 'high',
        authRequired: false,
        testTypes: [
          {
            category: 'logic',
            subtype: 'form-submission',
            details: {
              action: 'submit form',
              steps: [{ type: 'click', target: 'button', description: 'Submit' }],
              assertions: [{ type: 'visible', target: '.success', expected: 'visible', description: 'Show success' }],
            },
          },
        ],
      },
    ];

    const result = generateUnifiedTestFile(102, routes);

    expect(result).toContain("test.describe('Functional Tests'");
    expect(result).toContain("test('should submit form'");
    expect(result).not.toContain("test.describe('Visual Regression'");
  });

  it('generates both visual and logic tests', () => {
    const routes: UnifiedTestRecommendation[] = [
      {
        route: '/',
        reason: 'Home changed',
        priority: 'high',
        authRequired: false,
        testTypes: [
          { category: 'visual', subtype: 'screenshot', details: { screenshotName: 'home' } },
        ],
      },
      {
        route: '/api/submit',
        reason: 'API changed',
        priority: 'high',
        authRequired: false,
        testTypes: [
          {
            category: 'logic',
            subtype: 'form-submission',
            details: {
              action: 'submit data',
              steps: [{ type: 'click', target: 'button', description: 'Submit' }],
              assertions: [],
            },
          },
        ],
      },
    ];

    const result = generateUnifiedTestFile(103, routes);

    expect(result).toContain("test.describe('Visual Regression'");
    expect(result).toContain("test.describe('Functional Tests'");
    expect(result).toContain("toHaveScreenshot('home.png'");
    expect(result).toContain("test('should submit data'");
  });

  it('handles route with both visual and logic test types', () => {
    const routes: UnifiedTestRecommendation[] = [
      {
        route: '/dashboard',
        reason: 'Dashboard changed',
        priority: 'high',
        authRequired: true,
        testTypes: [
          { category: 'visual', subtype: 'screenshot', details: { screenshotName: 'dashboard' } },
          {
            category: 'logic',
            subtype: 'form-submission',
            details: {
              action: 'update settings',
              steps: [{ type: 'fill', target: '#name', value: 'Test', description: 'Enter name' }],
              assertions: [{ type: 'toast', target: '', expected: 'Saved', description: 'Confirm' }],
            },
          },
        ],
      },
    ];

    const result = generateUnifiedTestFile(104, routes);

    expect(result).toContain("test.describe('Visual Regression'");
    expect(result).toContain("test.describe('Authenticated Pages'");
    expect(result).toContain("test.describe('Functional Tests'");
    expect(result).toContain("toHaveScreenshot('dashboard.png'");
    expect(result).toContain("test('should update settings'");
    // Both sections should have beforeEach for auth
    expect(result.match(/test\.beforeEach/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('includes custom login flow when provided', () => {
    const routes: UnifiedTestRecommendation[] = [
      {
        route: '/portal',
        reason: 'Portal changed',
        priority: 'high',
        authRequired: true,
        testTypes: [
          { category: 'visual', subtype: 'screenshot', details: { screenshotName: 'portal' } },
        ],
      },
    ];

    const loginFlow: LoginFlowAnalysis = {
      loginUrl: '/auth/login',
      usernameSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button#submit',
      successIndicator: '[data-testid="dashboard"]',
      successUrl: '/dashboard',
    };

    const result = generateUnifiedTestFile(105, routes, loginFlow);

    expect(result).toContain("page.goto('/auth/login')");
    expect(result).toContain("page.fill('#email', process.env.TEST_USER!)");
    expect(result).toContain("page.waitForURL('/dashboard')");
  });

  it('separates public and authenticated visual tests', () => {
    const routes: UnifiedTestRecommendation[] = [
      {
        route: '/',
        reason: 'Home changed',
        priority: 'high',
        authRequired: false,
        testTypes: [{ category: 'visual', subtype: 'screenshot', details: { screenshotName: 'home' } }],
      },
      {
        route: '/profile',
        reason: 'Profile changed',
        priority: 'medium',
        authRequired: true,
        testTypes: [{ category: 'visual', subtype: 'screenshot', details: { screenshotName: 'profile' } }],
      },
    ];

    const result = generateUnifiedTestFile(106, routes);

    expect(result).toContain("test.describe('Public Pages'");
    expect(result).toContain("test.describe('Authenticated Pages'");
    expect(result).toContain("toHaveScreenshot('home.png'");
    expect(result).toContain("toHaveScreenshot('profile.png'");
  });
});
