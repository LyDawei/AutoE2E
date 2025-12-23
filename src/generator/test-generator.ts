import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';
import type { RouteTestRecommendation, LoginFlowAnalysis } from '../ai/types.js';
import type { GeneratedTest, TestGeneratorOptions } from './types.js';
import { generateTestFile, generateFallbackTestFile } from './templates.js';
import { DEFAULTS } from '../config/defaults.js';

export class TestGenerator {
  private options: TestGeneratorOptions;

  constructor(options?: Partial<TestGeneratorOptions>) {
    this.options = {
      outputDir: options?.outputDir || DEFAULTS.outputDir,
      overwrite: options?.overwrite ?? true,
    };
  }

  /**
   * Generate a test file from AI-analyzed routes
   */
  generate(
    prNumber: number,
    routes: RouteTestRecommendation[],
    loginFlow?: LoginFlowAnalysis
  ): GeneratedTest {
    if (routes.length === 0) {
      logger.warn('No routes to test, generating empty test file');
    }

    const content = generateTestFile(prNumber, routes, loginFlow);
    const filePath = this.getTestFilePath(prNumber);

    return {
      prNumber,
      filePath,
      content,
      routes,
      createdAt: new Date(),
    };
  }

  /**
   * Generate a fallback test file when AI is unavailable
   */
  generateFallback(
    prNumber: number,
    routes: Array<{ path: string; isAuthProtected: boolean }>
  ): GeneratedTest {
    logger.info('Generating fallback test file without AI analysis');

    const content = generateFallbackTestFile(prNumber, routes);
    const filePath = this.getTestFilePath(prNumber);

    const recommendations: RouteTestRecommendation[] = routes.map((r) => ({
      route: r.path,
      reason: 'Fallback - route may be affected',
      priority: 'medium' as const,
      authRequired: r.isAuthProtected,
    }));

    return {
      prNumber,
      filePath,
      content,
      routes: recommendations,
      createdAt: new Date(),
    };
  }

  /**
   * Generate test file from AI-generated code
   */
  generateFromCode(prNumber: number, code: string, routes: RouteTestRecommendation[]): GeneratedTest {
    const filePath = this.getTestFilePath(prNumber);

    return {
      prNumber,
      filePath,
      content: code,
      routes,
      createdAt: new Date(),
    };
  }

  /**
   * Write the generated test to disk
   */
  write(test: GeneratedTest): string {
    // Ensure output directory exists
    const dir = path.dirname(test.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check if file exists
    if (fs.existsSync(test.filePath) && !this.options.overwrite) {
      throw new Error(`Test file already exists: ${test.filePath}. Use --overwrite to replace.`);
    }

    // Write the file
    fs.writeFileSync(test.filePath, test.content, 'utf-8');
    logger.success(`Generated test file: ${test.filePath}`);

    return test.filePath;
  }

  /**
   * Get the test file path for a PR
   */
  getTestFilePath(prNumber: number): string {
    return path.join(this.options.outputDir, `pr-${prNumber}.spec.ts`);
  }

  /**
   * Check if a test file exists for a PR
   */
  hasTestFile(prNumber: number): boolean {
    return fs.existsSync(this.getTestFilePath(prNumber));
  }

  /**
   * Read an existing test file
   */
  readTestFile(prNumber: number): string | null {
    const filePath = this.getTestFilePath(prNumber);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * Delete a test file
   */
  deleteTestFile(prNumber: number): boolean {
    const filePath = this.getTestFilePath(prNumber);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Deleted test file: ${filePath}`);
      return true;
    }
    return false;
  }

  /**
   * List all generated test files
   */
  listTestFiles(): string[] {
    if (!fs.existsSync(this.options.outputDir)) {
      return [];
    }

    return fs
      .readdirSync(this.options.outputDir)
      .filter((file) => file.match(/^pr-\d+\.spec\.ts$/))
      .map((file) => path.join(this.options.outputDir, file));
  }
}

export function createTestGenerator(options?: Partial<TestGeneratorOptions>): TestGenerator {
  return new TestGenerator(options);
}
