import { describe, it, expect } from 'vitest';
import {
  generateStepCode,
  generateAssertionCode,
  generateFormSubmissionTest,
  generateLogicTestsSection,
  generateLoginBeforeEach,
} from '../../src/generator/logic-templates.js';
import type { TestStep, TestAssertion, UnifiedTestRecommendation, LogicTestDetails } from '../../src/ai/types.js';

describe('generateStepCode', () => {
  it('generates navigate step', () => {
    const step: TestStep = { type: 'navigate', value: '/users', description: 'Go to users page' };
    const code = generateStepCode(step);
    expect(code).toBe("await page.goto('/users');");
  });

  it('generates fill step', () => {
    const step: TestStep = { type: 'fill', target: '#email', value: 'test@example.com', description: 'Enter email' };
    const code = generateStepCode(step);
    expect(code).toBe("await page.fill('#email', 'test@example.com');");
  });

  it('generates click step', () => {
    const step: TestStep = { type: 'click', target: 'button[type="submit"]', description: 'Submit form' };
    const code = generateStepCode(step);
    expect(code).toBe("await page.click('button[type=\"submit\"]');");
  });

  it('generates select step', () => {
    const step: TestStep = { type: 'select', target: '#country', value: 'US', description: 'Select country' };
    const code = generateStepCode(step);
    expect(code).toBe("await page.selectOption('#country', 'US');");
  });

  it('generates check step', () => {
    const step: TestStep = { type: 'check', target: '#terms', description: 'Accept terms' };
    const code = generateStepCode(step);
    expect(code).toBe("await page.check('#terms');");
  });

  it('generates wait step', () => {
    const step: TestStep = { type: 'wait', target: '.loading', description: 'Wait for loading' };
    const code = generateStepCode(step);
    expect(code).toBe("await page.waitForSelector('.loading');");
  });

  it('generates upload step', () => {
    const step: TestStep = { type: 'upload', target: '#file', value: '/path/to/file.pdf', description: 'Upload file' };
    const code = generateStepCode(step);
    expect(code).toBe("await page.setInputFiles('#file', '/path/to/file.pdf');");
  });
});

describe('generateAssertionCode', () => {
  it('generates visible assertion', () => {
    const assertion: TestAssertion = { type: 'visible', target: '.success', expected: 'visible', description: 'Check success message' };
    const code = generateAssertionCode(assertion);
    expect(code).toBe("await expect(page.locator('.success')).toBeVisible();");
  });

  it('generates text assertion', () => {
    const assertion: TestAssertion = { type: 'text', target: '.message', expected: 'Success!', description: 'Check message text' };
    const code = generateAssertionCode(assertion);
    expect(code).toBe("await expect(page.locator('.message')).toContainText('Success!');");
  });

  it('generates URL assertion with exact string', () => {
    const assertion: TestAssertion = { type: 'url', target: '', expected: '/dashboard', description: 'Check URL' };
    const code = generateAssertionCode(assertion);
    expect(code).toBe("await expect(page).toHaveURL('/dashboard');");
  });

  it('generates URL assertion with regex', () => {
    const assertion: TestAssertion = { type: 'url', target: '', expected: '/\\/users\\/\\d+/', description: 'Check dynamic URL' };
    const code = generateAssertionCode(assertion);
    expect(code).toBe("await expect(page).toHaveURL(/\\/users\\/\\d+/);");
  });

  it('generates count assertion', () => {
    const assertion: TestAssertion = { type: 'count', target: '.item', expected: '5', description: 'Check item count' };
    const code = generateAssertionCode(assertion);
    expect(code).toBe("await expect(page.locator('.item')).toHaveCount(5);");
  });

  it('generates attribute assertion', () => {
    const assertion: TestAssertion = { type: 'attribute', target: '#btn', expected: 'disabled=true', description: 'Check disabled' };
    const code = generateAssertionCode(assertion);
    expect(code).toBe("await expect(page.locator('#btn')).toHaveAttribute('disabled', 'true');");
  });

  it('generates toast assertion', () => {
    const assertion: TestAssertion = { type: 'toast', target: '', expected: 'User created', description: 'Check toast' };
    const code = generateAssertionCode(assertion);
    expect(code).toContain('role="alert"');
    expect(code).toContain("toContainText('User created')");
  });

  it('generates redirect assertion', () => {
    const assertion: TestAssertion = { type: 'redirect', target: '', expected: '/login', description: 'Check redirect' };
    const code = generateAssertionCode(assertion);
    expect(code).toBe("await page.waitForURL('/login');");
  });
});

describe('generateFormSubmissionTest', () => {
  it('generates complete form test with steps and assertions', () => {
    const details: LogicTestDetails = {
      action: 'submit login form',
      steps: [
        { type: 'fill', target: '#email', value: 'test@example.com', description: 'Enter email' },
        { type: 'fill', target: '#password', value: 'secret', description: 'Enter password' },
        { type: 'click', target: 'button[type="submit"]', description: 'Submit' },
      ],
      assertions: [
        { type: 'url', target: '', expected: '/dashboard', description: 'Redirected to dashboard' },
      ],
    };

    const code = generateFormSubmissionTest('/login', details, 'should login successfully');

    expect(code).toContain("test('should login successfully'");
    expect(code).toContain("page.goto('/login')");
    expect(code).toContain("page.fill('#email', 'test@example.com')");
    expect(code).toContain("page.fill('#password', 'secret')");
    expect(code).toContain("page.click('button[type=\"submit\"]')");
    expect(code).toContain("toHaveURL('/dashboard')");
  });

  it('handles empty steps gracefully', () => {
    const details: LogicTestDetails = {
      action: 'check page',
      steps: [],
      assertions: [
        { type: 'visible', target: '.content', expected: 'visible', description: 'Content visible' },
      ],
    };

    const code = generateFormSubmissionTest('/', details, 'should show content');

    expect(code).toContain("test('should show content'");
    expect(code).toContain("page.goto('/')");
    expect(code).toContain("toBeVisible()");
  });

  it('handles empty assertions gracefully', () => {
    const details: LogicTestDetails = {
      action: 'click button',
      steps: [
        { type: 'click', target: 'button', description: 'Click' },
      ],
      assertions: [],
    };

    const code = generateFormSubmissionTest('/page', details, 'should click button');

    expect(code).toContain("test('should click button'");
    expect(code).toContain("page.click('button')");
  });
});

describe('generateLogicTestsSection', () => {
  it('returns empty string when no logic routes', () => {
    const routes: UnifiedTestRecommendation[] = [
      {
        route: '/',
        reason: 'Home changed',
        priority: 'high',
        authRequired: false,
        testTypes: [{ category: 'visual', subtype: 'screenshot', details: { screenshotName: 'home' } }],
      },
    ];

    const result = generateLogicTestsSection(routes);
    expect(result).toBe('');
  });

  it('generates section with public logic tests', () => {
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
              action: 'submit contact form',
              steps: [
                { type: 'fill', target: '#name', value: 'John', description: 'Enter name' },
                { type: 'click', target: 'button', description: 'Submit' },
              ],
              assertions: [
                { type: 'text', target: '.success', expected: 'Thanks!', description: 'Show thanks' },
              ],
            },
          },
        ],
      },
    ];

    const result = generateLogicTestsSection(routes);

    expect(result).toContain("test.describe('Functional Tests'");
    expect(result).toContain("test.describe('Public'");
    expect(result).toContain("test('should submit contact form'");
    expect(result).toContain("page.fill('#name', 'John')");
  });

  it('generates section with authenticated logic tests', () => {
    const routes: UnifiedTestRecommendation[] = [
      {
        route: '/dashboard/settings',
        reason: 'Settings changed',
        priority: 'high',
        authRequired: true,
        testTypes: [
          {
            category: 'logic',
            subtype: 'form-submission',
            details: {
              action: 'update settings',
              steps: [
                { type: 'fill', target: '#theme', value: 'dark', description: 'Select theme' },
                { type: 'click', target: 'button', description: 'Save' },
              ],
              assertions: [
                { type: 'toast', target: '', expected: 'Settings saved', description: 'Confirm save' },
              ],
            },
          },
        ],
      },
    ];

    const result = generateLogicTestsSection(routes);

    expect(result).toContain("test.describe('Functional Tests'");
    expect(result).toContain("test.describe('Authenticated'");
    expect(result).toContain("test.beforeEach");
    expect(result).toContain("test('should update settings'");
  });
});

describe('generateLoginBeforeEach', () => {
  it('generates generic login when no flow provided', () => {
    const code = generateLoginBeforeEach();

    expect(code).toContain('test.beforeEach');
    expect(code).toContain("page.goto('/login')");
    expect(code).toContain('process.env.TEST_USER!');
    expect(code).toContain('process.env.TEST_PASSWORD!');
    expect(code).toContain('TODO');
  });

  it('generates custom login with provided flow', () => {
    const loginFlow = {
      loginUrl: '/auth/signin',
      usernameSelector: '#username',
      passwordSelector: '#pwd',
      submitSelector: '#login-btn',
      successIndicator: '.dashboard',
      successUrl: '/home',
    };

    const code = generateLoginBeforeEach(loginFlow);

    expect(code).toContain("page.goto('/auth/signin')");
    expect(code).toContain("page.fill('#username', process.env.TEST_USER!)");
    expect(code).toContain("page.fill('#pwd', process.env.TEST_PASSWORD!)");
    expect(code).toContain("page.click('#login-btn')");
    expect(code).toContain("page.waitForURL('/home')");
    expect(code).not.toContain('TODO');
  });

  it('uses success indicator when no success URL', () => {
    const loginFlow = {
      loginUrl: '/login',
      usernameSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button',
      successIndicator: '[data-testid="dashboard"]',
    };

    const code = generateLoginBeforeEach(loginFlow);

    expect(code).toContain("waitForSelector('[data-testid=\"dashboard\"]')");
  });

  it('includes login mode toggle click when selector provided', () => {
    const loginFlow = {
      loginUrl: '/login',
      usernameSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button[type="submit"]',
      successIndicator: '.dashboard',
      loginModeToggleSelector: 'button:has-text("Password")',
      loginModeToggleDescription: 'Click to use password authentication',
    };

    const code = generateLoginBeforeEach(loginFlow);

    // Should wait for toggle to be visible before clicking (avoids race conditions)
    expect(code).toContain("page.waitForSelector('button:has-text(\"Password\")')");
    // Should click the mode toggle before filling credentials
    expect(code).toContain("page.click('button:has-text(\"Password\")')");
    // Should use the custom description from loginModeToggleDescription
    expect(code).toContain('// Click to use password authentication');
    // Should still fill credentials correctly
    expect(code).toContain("page.fill('#email', process.env.TEST_USER!)");
    expect(code).toContain("page.fill('#password', process.env.TEST_PASSWORD!)");
  });

  it('uses default comment when toggle selector provided without description', () => {
    const loginFlow = {
      loginUrl: '/login',
      usernameSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button',
      successIndicator: '.dashboard',
      loginModeToggleSelector: 'button.password-mode',
    };

    const code = generateLoginBeforeEach(loginFlow);

    // Should use default description
    expect(code).toContain('// Switch to password login mode');
    // Should wait for selector before clicking
    expect(code).toContain("page.waitForSelector('button.password-mode')");
    expect(code).toContain("page.click('button.password-mode')");
  });

  it('does not include mode toggle when selector not provided', () => {
    const loginFlow = {
      loginUrl: '/login',
      usernameSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button',
      successIndicator: '.dashboard',
    };

    const code = generateLoginBeforeEach(loginFlow);

    expect(code).not.toContain('Switch to password login mode');
    expect(code).not.toContain('loginModeToggle');
  });

  it('handles login mode toggle with special characters in selector', () => {
    const loginFlow = {
      loginUrl: '/login',
      usernameSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button',
      successIndicator: '.dashboard',
      loginModeToggleSelector: "[data-testid='password-mode']",
    };

    const code = generateLoginBeforeEach(loginFlow);

    // Should properly escape special characters in both waitForSelector and click
    expect(code).toContain("page.waitForSelector('[data-testid=\\'password-mode\\']')");
    expect(code).toContain("page.click('[data-testid=\\'password-mode\\']')");
  });

  it('ignores description when selector is missing', () => {
    const loginFlow = {
      loginUrl: '/login',
      usernameSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button',
      successIndicator: '.dashboard',
      loginModeToggleDescription: 'Switch to password',
      // loginModeToggleSelector intentionally missing
    };

    const code = generateLoginBeforeEach(loginFlow);

    // Should not include the toggle description or any login mode toggle logic
    expect(code).not.toContain('Switch to password');
    expect(code).not.toContain('// Switch to password login mode');
    expect(code).not.toContain('loginModeToggle');
    // Should still generate valid login code
    expect(code).toContain("page.fill('#email', process.env.TEST_USER!)");
  });
});
