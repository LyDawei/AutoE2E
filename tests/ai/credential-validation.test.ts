import { describe, it, expect } from 'vitest';
import {
  detectPlaceholderCredentials,
  validateAndFixCredentials,
  extractCodeFromResponse,
} from '../../src/ai/prompts.js';

describe('detectPlaceholderCredentials', () => {
  // Note: detectPlaceholderCredentials is designed to catch credentials that the
  // validateAndFixCredentials function couldn't automatically fix. Most placeholder
  // patterns are fixed automatically, so detection finds fewer issues after fixing.

  it('does not flag process.env usage', () => {
    const code = `
      await page.fill('input[name="username"]', process.env.TEST_USER!);
      await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
    `;
    const result = detectPlaceholderCredentials(code);
    expect(result.hasPlaceholders).toBe(false);
    expect(result.issues.length).toBe(0);
  });

  it('does not flag non-credential fields', () => {
    const code = `
      await page.fill('input[name="firstName"]', 'John');
      await page.fill('input[name="lastName"]', 'Doe');
      await page.fill('input[name="phone"]', '123-456-7890');
    `;
    const result = detectPlaceholderCredentials(code);
    expect(result.hasPlaceholders).toBe(false);
  });

  it('detects placeholder credentials in common login selectors', () => {
    // This tests detection on a typical login field selector
    const code = `
      await page.fill('#loginUser', 'testAdmin');
    `;
    const result = detectPlaceholderCredentials(code);
    expect(result.hasPlaceholders).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('validateAndFixCredentials', () => {
  it('fixes testUser placeholder to process.env.TEST_USER!', () => {
    const code = `await page.fill('input[name="username"]', 'testUser');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toBe(`await page.fill('input[name="username"]', process.env.TEST_USER!);`);
  });

  it('fixes testPassword placeholder to process.env.TEST_PASSWORD!', () => {
    const code = `await page.fill('input[name="password"]', 'testPassword');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toBe(`await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);`);
  });

  it('fixes email placeholder to process.env.TEST_USER!', () => {
    const code = `await page.fill('input[name="email"]', 'test@example.com');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toBe(`await page.fill('input[name="email"]', process.env.TEST_USER!);`);
  });

  it('fixes password123 to process.env.TEST_PASSWORD!', () => {
    const code = `await page.fill('input[type="password"]', 'password123');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toBe(`await page.fill('input[type="password"]', process.env.TEST_PASSWORD!);`);
  });

  it('does not modify already correct process.env usage', () => {
    const code = `
      await page.fill('input[name="username"]', process.env.TEST_USER!);
      await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
    `;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toBe(code);
  });

  it('fixes multiple placeholder credentials in same code', () => {
    const code = `
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:5173/login');
      await page.fill('input[name="username"]', 'testUser');
      await page.fill('input[name="password"]', 'testPassword');
      await page.click('button[type="submit"]');
    });
    `;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
    expect(fixed).toContain('process.env.TEST_PASSWORD!');
    expect(fixed).not.toContain("'testUser'");
    expect(fixed).not.toContain("'testPassword'");
  });

  it('does not modify non-credential fill operations', () => {
    const code = `
      await page.fill('input[name="firstName"]', 'John');
      await page.fill('input[name="lastName"]', 'Doe');
    `;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain("'John'");
    expect(fixed).toContain("'Doe'");
  });

  it('handles id selectors for username fields', () => {
    const code = `await page.fill('#email', 'user@test.com');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toBe(`await page.fill('#email', process.env.TEST_USER!);`);
  });

  it('handles id selectors for password fields', () => {
    const code = `await page.fill('#password', 'secret123');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toBe(`await page.fill('#password', process.env.TEST_PASSWORD!);`);
  });

  it('handles input[type="email"] selector', () => {
    const code = `await page.fill('input[type="email"]', 'admin@example.com');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
  });

  it('handles double-quoted selectors', () => {
    const code = `await page.fill("input[name='username']", "testUser");`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
  });

  it('preserves code structure while fixing credentials', () => {
    const code = `
import { test, expect } from '@playwright/test';

test.describe('Login Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'testUser');
    await page.fill('input[name="password"]', 'testPassword');
    await page.click('button[type="submit"]');
  });

  test('should access dashboard', async ({ page }) => {
    await expect(page).toHaveURL('/dashboard');
  });
});
`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain("import { test, expect } from '@playwright/test'");
    expect(fixed).toContain("test.describe('Login Tests'");
    expect(fixed).toContain('process.env.TEST_USER!');
    expect(fixed).toContain('process.env.TEST_PASSWORD!');
    expect(fixed).toContain('await expect(page).toHaveURL');
  });
});

describe('extractCodeFromResponse', () => {
  it('extracts code from markdown code blocks', () => {
    const response = `\`\`\`typescript
import { test } from '@playwright/test';
\`\`\``;
    const code = extractCodeFromResponse(response);
    expect(code).toBe("import { test } from '@playwright/test';");
  });

  it('returns code as-is if no markdown blocks', () => {
    const response = `import { test } from '@playwright/test';`;
    const code = extractCodeFromResponse(response);
    expect(code).toBe("import { test } from '@playwright/test';");
  });

  it('fixes placeholder credentials when extracting code', () => {
    const response = `\`\`\`typescript
await page.fill('input[name="username"]', 'testUser');
await page.fill('input[name="password"]', 'testPassword');
\`\`\``;
    const code = extractCodeFromResponse(response);
    expect(code).toContain('process.env.TEST_USER!');
    expect(code).toContain('process.env.TEST_PASSWORD!');
  });

  it('handles code with js language tag', () => {
    const response = `\`\`\`js
await page.fill('input[name="email"]', 'test@test.com');
\`\`\``;
    const code = extractCodeFromResponse(response);
    expect(code).toContain('process.env.TEST_USER!');
  });
});

describe('edge cases', () => {
  it('handles mixed quote styles', () => {
    const code = `
      await page.fill("input[name='email']", 'testUser');
      await page.fill('input[name="password"]', "testPassword");
    `;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
    expect(fixed).toContain('process.env.TEST_PASSWORD!');
  });

  it('handles whitespace variations', () => {
    const code = `await page.fill(  'input[name="username"]'  ,  'testUser'  );`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
  });

  it('handles credentials with special characters that are not placeholders', () => {
    const code = `
      await page.fill('input[name="username"]', process.env.TEST_USER!);
      await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
    `;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toBe(code);
  });

  it('fixes admin credentials', () => {
    const code = `await page.fill('#login', 'admin');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
  });

  it('fixes demo credentials', () => {
    const code = `
      await page.fill('input[name="user"]', 'demoUser');
      await page.fill('input[name="password"]', 'demoPassword');
    `;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
    expect(fixed).toContain('process.env.TEST_PASSWORD!');
  });

  it('fixes input[name="pass"] field', () => {
    const code = `await page.fill('input[name="pass"]', 'demoPassword');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_PASSWORD!');
  });

  it('handles null/undefined inputs gracefully', () => {
    // These should not throw
    expect(() => validateAndFixCredentials(null as unknown as string)).not.toThrow();
    expect(() => validateAndFixCredentials(undefined as unknown as string)).not.toThrow();
  });

  it('does not modify comments containing credential keywords', () => {
    const code = `
      // Use testUser for authentication
      await page.fill('input[name="username"]', process.env.TEST_USER!);
    `;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('// Use testUser');
    expect(fixed).toContain('process.env.TEST_USER!');
  });

  it('does not fix legitimate form data that coincidentally contains credential keywords', () => {
    const code = `await page.fill('input[name="comments"]', 'This is a test note');`;
    const fixed = validateAndFixCredentials(code);
    // Should not change because 'comments' is not a credential field selector
    expect(fixed).toBe(code);
  });
});

describe('new selector patterns', () => {
  // Tests for the new patterns added to fix tab-based login forms
  // like those with #password-email id pattern

  it('fixes #password-email selector (common in tab-based login forms)', () => {
    const code = `await page.fill('#password-email', 'david.ly@company.com');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toBe(`await page.fill('#password-email', process.env.TEST_USER!);`);
  });

  it('fixes real email addresses in email fields', () => {
    const code = `await page.fill('input[name="email"]', 'john.doe@example.org');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
  });

  it('fixes credentials in data-testid selectors', () => {
    const code = `
      await page.fill('[data-testid="email-input"]', 'test@test.com');
      await page.fill('[data-testid="password-input"]', 'mypassword123');
    `;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
    expect(fixed).toContain('process.env.TEST_PASSWORD!');
  });

  it('fixes credentials with input[autocomplete="current-password"]', () => {
    const code = `await page.fill('input[autocomplete="current-password"]', 'secretPass123');`;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_PASSWORD!');
  });

  it('handles complete tab-based login flow', () => {
    // Simulates what the AI might generate for a tab-based login form
    // Using obvious placeholder values that the validation will catch
    const code = `
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await page.click('button:has-text("Password")');
      await page.fill('#password-email', 'david.ly@company.com');
      await page.fill('#password', 'testPassword123');
      await page.click('button[type="submit"]');
    });
    `;
    const fixed = validateAndFixCredentials(code);
    expect(fixed).toContain('process.env.TEST_USER!');
    expect(fixed).toContain('process.env.TEST_PASSWORD!');
    expect(fixed).not.toContain("'david.ly@company.com'");
    expect(fixed).not.toContain("'testPassword123'");
    // Should preserve the tab click
    expect(fixed).toContain("await page.click('button:has-text(\"Password\")')");
  });

  it('detects non-obvious password values in password fields', () => {
    // Even passwords that don't look like placeholders should be detected
    // when they're in known password fields
    const code = `await page.fill('#password', 'XxD4V1DxX');`;
    const result = detectPlaceholderCredentials(code);
    // This should be detected as suspicious because it's a literal string in a password field
    expect(result.hasPlaceholders).toBe(true);
  });

  it('detects real-looking emails with @ and . in credential fields', () => {
    const code = `await page.fill('#email', 'jane.smith@acme.co');`;
    const result = detectPlaceholderCredentials(code);
    expect(result.hasPlaceholders).toBe(true);
  });

  it('detects suspicious credentials in type="email" fields', () => {
    const code = `await page.fill('input[type="email"]', 'user@domain.com');`;
    const result = detectPlaceholderCredentials(code);
    expect(result.hasPlaceholders).toBe(true);
  });
});

describe('login flow template fallbacks', () => {
  // These tests verify the logic-templates.ts generates proper fallback code
  // We import the function to test it directly

  it('generateLoginBeforeEach without loginFlow includes helpful comments', async () => {
    const { generateLoginBeforeEach } = await import('../../src/generator/logic-templates.js');
    const result = generateLoginBeforeEach(undefined, '    ');

    // Should include tab-click hint
    expect(result).toContain('button:has-text("Password")');
    // Should use comprehensive selector lists
    expect(result).toContain('#password-email');
    expect(result).toContain('#email');
    expect(result).toContain('#password');
    // Should use process.env
    expect(result).toContain('process.env.TEST_USER!');
    expect(result).toContain('process.env.TEST_PASSWORD!');
  });

  it('generateLoginBeforeEach with loginFlow includes mode toggle click', async () => {
    const { generateLoginBeforeEach } = await import('../../src/generator/logic-templates.js');
    const loginFlow = {
      loginUrl: '/login',
      usernameSelector: '#password-email',
      passwordSelector: '#password',
      submitSelector: 'button[type="submit"]',
      successIndicator: '[data-testid="dashboard"]',
      loginModeToggleSelector: 'button:has-text("Password")',
      loginModeToggleDescription: 'Switch to password login mode',
    };
    const result = generateLoginBeforeEach(loginFlow, '    ');

    // Should click the mode toggle before filling credentials
    expect(result).toContain("await page.click('button:has-text(\"Password\")')");
    // Should wait for toggle to be visible
    expect(result).toContain("await page.waitForSelector('button:has-text(\"Password\")')");
    // Should fill credentials with process.env
    expect(result).toContain('process.env.TEST_USER!');
    expect(result).toContain('process.env.TEST_PASSWORD!');
  });
});
