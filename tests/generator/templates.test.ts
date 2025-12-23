import { describe, it, expect } from 'vitest';
import { generateTestFile, generateFallbackTestFile } from '../../src/generator/templates.js';
import type { RouteTestRecommendation, LoginFlowAnalysis } from '../../src/ai/types.js';

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
