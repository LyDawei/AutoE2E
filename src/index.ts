import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger, setLogLevel } from './utils/logger.js';
import { ConfigError } from './utils/errors.js';
import { routeToScreenshotName } from './utils/route-helpers.js';
import { DEFAULTS } from './config/defaults.js';
import { GitHubClient } from './github/client.js';
import { filterVisuallyRelevantFiles, classifyChangedFiles } from './github/parser.js';
import { discoverRoutes, findAffectedRoutes } from './analyzer/route-mapper.js';
import { buildImportGraph } from './analyzer/import-graph.js';
import { OpenAIClient } from './ai/openai-client.js';
import { TestGenerator } from './generator/test-generator.js';
import { BaselineManager } from './visual/baseline-manager.js';
import { Reporter } from './visual/reporter.js';
import type { Route } from './analyzer/types.js';
import type {
  AIAnalysisResult,
  RouteTestRecommendation,
  ExtendedAIAnalysisResult,
  UnifiedTestRecommendation,
} from './ai/types.js';
import type { GeneratedTest, UnifiedGeneratedTest } from './generator/types.js';

export interface YokohamaConfig {
  /** OpenAI API key */
  openaiApiKey: string;
  /** Test environment URL */
  testUrl: string;
  /** GitHub token (optional, for private repos) */
  githubToken?: string;
  /** Test user for authenticated routes */
  testUser?: string;
  /** Test password for authenticated routes */
  testPassword?: string;
  /** Output directory for generated tests */
  outputDir?: string;
  /** Baselines directory */
  baselinesDir?: string;
  /** Reports directory */
  reportsDir?: string;
  /** Path to the SvelteKit project to analyze (for import graph) */
  projectPath?: string;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** OpenAI model to use */
  model?: string;
}

export interface AnalyzeOptions {
  /** Don't write files, just return what would be generated */
  dryRun?: boolean;
  /** Skip AI analysis and use heuristics only */
  skipAI?: boolean;
}

export interface AnalyzeResult {
  prNumber: number;
  routes: RouteTestRecommendation[];
  generatedTest: GeneratedTest;
  analysis?: AIAnalysisResult;
  filePath?: string;
}

/** Result from unified analysis (visual + logic) */
export interface UnifiedAnalyzeResult {
  prNumber: number;
  routes: UnifiedTestRecommendation[];
  generatedTest: UnifiedGeneratedTest;
  analysis?: ExtendedAIAnalysisResult;
  filePath?: string;
  /** Counts of changed file types */
  fileClassification: {
    visual: number;
    logic: number;
    mixed: number;
  };
}

export class Yokohama {
  private config: Required<
    Pick<YokohamaConfig, 'openaiApiKey' | 'testUrl' | 'outputDir' | 'baselinesDir' | 'reportsDir'>
  > &
    YokohamaConfig;

  private github: GitHubClient;
  private openai: OpenAIClient;
  private testGenerator: TestGenerator;
  private baselineManager: BaselineManager;
  private reporter: Reporter;

  constructor(config: YokohamaConfig) {
    if (!config.openaiApiKey) {
      throw new ConfigError('openaiApiKey is required');
    }
    if (!config.testUrl) {
      throw new ConfigError('testUrl is required');
    }

    this.config = {
      ...config,
      outputDir: config.outputDir || DEFAULTS.outputDir,
      baselinesDir: config.baselinesDir || DEFAULTS.baselinesDir,
      reportsDir: config.reportsDir || DEFAULTS.reportsDir,
    };

    if (config.logLevel) {
      setLogLevel(config.logLevel);
    }

    this.github = new GitHubClient(config.githubToken);
    this.openai = new OpenAIClient({
      apiKey: config.openaiApiKey,
      model: config.model,
    });
    this.testGenerator = new TestGenerator({ outputDir: this.config.outputDir });
    this.baselineManager = new BaselineManager(this.config.baselinesDir);
    this.reporter = new Reporter(this.config.reportsDir);
  }

  /**
   * Analyze a GitHub PR and generate visual regression tests
   */
  async analyze(prUrl: string, options?: AnalyzeOptions): Promise<AnalyzeResult> {
    const dryRun = options?.dryRun ?? false;
    const skipAI = options?.skipAI ?? false;

    // Parse PR URL
    logger.step(1, 6, 'Parsing PR URL...');
    const prId = this.github.parsePRUrl(prUrl);

    // Fetch PR data
    logger.step(2, 6, 'Fetching PR data from GitHub...');
    const [pr, changedFiles, diff] = await Promise.all([
      this.github.getPullRequest(prId),
      this.github.getChangedFiles(prId),
      this.github.getDiff(prId),
    ]);

    logger.info(`PR #${pr.number}: ${pr.title}`);
    logger.info(`Changed files: ${changedFiles.length}`);

    // Filter to visually relevant files
    const visualFiles = filterVisuallyRelevantFiles(changedFiles);
    logger.info(`Visually relevant files: ${visualFiles.length}`);

    if (visualFiles.length === 0) {
      logger.warn('No visually relevant files changed');
    }

    // Discover routes (if project path provided)
    let routes: Route[] = [];
    let importGraph = { imports: new Map<string, string[]>(), importedBy: new Map<string, string[]>() };

    if (this.config.projectPath && fs.existsSync(this.config.projectPath)) {
      logger.step(3, 6, 'Discovering routes and building import graph...');
      routes = discoverRoutes(this.config.projectPath);
      importGraph = buildImportGraph(this.config.projectPath);
      logger.info(`Discovered ${routes.length} routes`);
    }

    // Analyze with AI or use heuristics
    let analysis: AIAnalysisResult | undefined;
    let routesToTest: RouteTestRecommendation[];

    if (!skipAI && visualFiles.length > 0) {
      logger.step(4, 6, 'Analyzing changes with AI...');
      try {
        analysis = await this.openai.analyzeChanges(
          diff,
          visualFiles.map((f) => f.filename),
          routes
        );
        routesToTest = analysis.routesToTest;
        logger.info(`AI identified ${routesToTest.length} routes to test`);
      } catch (error) {
        logger.warn(`AI analysis failed: ${error instanceof Error ? error.message : error}`);
        logger.info('Falling back to heuristic analysis');
        routesToTest = this.heuristicRouteAnalysis(visualFiles.map((f) => f.filename), routes, importGraph);
      }
    } else {
      logger.step(4, 6, 'Using heuristic analysis...');
      routesToTest = this.heuristicRouteAnalysis(visualFiles.map((f) => f.filename), routes, importGraph);
    }

    // Infer login flow if there are auth routes
    let loginFlow;
    const hasAuthRoutes = routesToTest.some((r) => r.authRequired);
    if (hasAuthRoutes && this.config.projectPath && !skipAI) {
      logger.step(5, 6, 'Inferring login flow...');
      try {
        loginFlow = await this.inferLoginFlow();
      } catch (error) {
        logger.warn(`Failed to infer login flow: ${error instanceof Error ? error.message : error}`);
      }
    } else {
      logger.step(5, 6, 'Skipping login flow inference...');
    }

    // Generate test file
    logger.step(6, 6, 'Generating test file...');
    let generatedTest: GeneratedTest;

    if (!skipAI && analysis) {
      // Use AI to generate test code
      try {
        const testCode = await this.openai.generateTestCode(
          routesToTest,
          this.config.testUrl,
          loginFlow,
          pr.number
        );
        generatedTest = this.testGenerator.generateFromCode(pr.number, testCode, routesToTest);
      } catch (error) {
        logger.warn(`AI test generation failed: ${error instanceof Error ? error.message : error}`);
        generatedTest = this.testGenerator.generate(pr.number, routesToTest, loginFlow);
      }
    } else {
      generatedTest = this.testGenerator.generate(pr.number, routesToTest, loginFlow);
    }

    // Write test file (unless dry run)
    let filePath: string | undefined;
    if (!dryRun) {
      filePath = this.testGenerator.write(generatedTest);
    } else {
      logger.info('Dry run - test file not written');
    }

    return {
      prNumber: pr.number,
      routes: routesToTest,
      generatedTest,
      analysis,
      filePath,
    };
  }

  /**
   * Analyze a GitHub PR and generate unified tests (visual + logic)
   * This is the new unified analysis that detects both visual and logic changes
   */
  async analyzeUnified(prUrl: string, options?: AnalyzeOptions): Promise<UnifiedAnalyzeResult> {
    const dryRun = options?.dryRun ?? false;
    const skipAI = options?.skipAI ?? false;

    // Parse PR URL
    logger.step(1, 7, 'Parsing PR URL...');
    const prId = this.github.parsePRUrl(prUrl);

    // Fetch PR data
    logger.step(2, 7, 'Fetching PR data from GitHub...');
    const [pr, changedFiles, diff] = await Promise.all([
      this.github.getPullRequest(prId),
      this.github.getChangedFiles(prId),
      this.github.getDiff(prId),
    ]);

    logger.info(`PR #${pr.number}: ${pr.title}`);
    logger.info(`Changed files: ${changedFiles.length}`);

    // Classify files into visual vs logic
    logger.step(3, 7, 'Classifying changed files...');
    const classified = classifyChangedFiles(changedFiles);

    logger.info(`Visual files: ${classified.visual.length}`);
    logger.info(`Logic files: ${classified.logic.length}`);
    logger.info(`Mixed files: ${classified.mixed.length}`);

    // Include mixed files in both analyses
    const allVisualFiles = [...classified.visual, ...classified.mixed];
    const allLogicFiles = [...classified.logic, ...classified.mixed];

    if (allVisualFiles.length === 0 && allLogicFiles.length === 0) {
      logger.warn('No relevant files changed (visual or logic)');
    }

    // Discover routes with enhanced server-side info
    let routes: Route[] = [];
    let importGraph = { imports: new Map<string, string[]>(), importedBy: new Map<string, string[]>() };

    if (this.config.projectPath && fs.existsSync(this.config.projectPath)) {
      logger.step(4, 7, 'Discovering routes and server logic...');
      routes = discoverRoutes(this.config.projectPath);
      importGraph = buildImportGraph(this.config.projectPath);
      logger.info(`Discovered ${routes.length} routes`);

      const routesWithServerLogic = routes.filter((r) => r.serverFiles.length > 0);
      logger.info(`Routes with server logic: ${routesWithServerLogic.length}`);
    }

    // Unified AI analysis
    let analysis: ExtendedAIAnalysisResult | undefined;
    let routesToTest: UnifiedTestRecommendation[];

    if (!skipAI && (allVisualFiles.length > 0 || allLogicFiles.length > 0)) {
      logger.step(5, 7, 'Analyzing changes with AI (visual + logic)...');
      try {
        analysis = await this.openai.analyzeUnified(
          diff,
          allVisualFiles.map((f) => f.filename),
          allLogicFiles.map((f) => f.filename),
          routes
        );
        routesToTest = analysis.routesToTest;
        logger.info(`AI identified ${routesToTest.length} routes to test`);

        // Log test type breakdown
        const visualCount = routesToTest.filter((r) =>
          r.testTypes.some((t) => t.category === 'visual')
        ).length;
        const logicCount = routesToTest.filter((r) =>
          r.testTypes.some((t) => t.category === 'logic')
        ).length;
        logger.info(`  Visual tests: ${visualCount}, Logic tests: ${logicCount}`);
      } catch (error) {
        logger.warn(`AI analysis failed: ${error instanceof Error ? error.message : error}`);
        logger.info('Falling back to heuristic analysis');
        routesToTest = this.heuristicUnifiedAnalysis(
          allVisualFiles.map((f) => f.filename),
          allLogicFiles.map((f) => f.filename),
          routes,
          importGraph
        );
      }
    } else {
      logger.step(5, 7, 'Using heuristic analysis...');
      routesToTest = this.heuristicUnifiedAnalysis(
        allVisualFiles.map((f) => f.filename),
        allLogicFiles.map((f) => f.filename),
        routes,
        importGraph
      );
    }

    // Infer login flow if there are auth routes
    let loginFlow;
    const hasAuthRoutes = routesToTest.some((r) => r.authRequired);
    if (hasAuthRoutes && this.config.projectPath && !skipAI) {
      logger.step(6, 7, 'Inferring login flow...');
      try {
        loginFlow = await this.inferLoginFlow();
      } catch (error) {
        logger.warn(`Failed to infer login flow: ${error instanceof Error ? error.message : error}`);
      }
    } else {
      logger.step(6, 7, 'Skipping login flow inference...');
    }

    // Generate unified test file
    logger.step(7, 7, 'Generating unified test file...');
    let generatedTest: UnifiedGeneratedTest;

    if (!skipAI && analysis) {
      // Use AI to generate test code
      try {
        const testCode = await this.openai.generateUnifiedTestCode(
          routesToTest,
          this.config.testUrl,
          loginFlow,
          analysis.testData,
          pr.number
        );
        generatedTest = this.testGenerator.generateUnifiedFromCode(pr.number, testCode, routesToTest);
      } catch (error) {
        logger.warn(`AI test generation failed: ${error instanceof Error ? error.message : error}`);
        generatedTest = this.testGenerator.generateUnified(pr.number, routesToTest, loginFlow);
      }
    } else {
      generatedTest = this.testGenerator.generateUnified(pr.number, routesToTest, loginFlow);
    }

    // Write test file (unless dry run)
    let filePath: string | undefined;
    if (!dryRun) {
      filePath = this.testGenerator.write(generatedTest);
    } else {
      logger.info('Dry run - test file not written');
    }

    return {
      prNumber: pr.number,
      routes: routesToTest,
      generatedTest,
      analysis,
      filePath,
      fileClassification: {
        visual: classified.visual.length,
        logic: classified.logic.length,
        mixed: classified.mixed.length,
      },
    };
  }

  /**
   * Heuristic-based route analysis when AI is unavailable
   */
  private heuristicRouteAnalysis(
    changedFiles: string[],
    routes: Route[],
    importGraph: { imports: Map<string, string[]>; importedBy: Map<string, string[]> }
  ): RouteTestRecommendation[] {
    if (routes.length === 0) {
      // No routes discovered, can't make recommendations
      return [];
    }

    const affectedRoutes = findAffectedRoutes(changedFiles, routes, importGraph.importedBy);
    const recommendations: RouteTestRecommendation[] = [];

    for (const [route, reasons] of affectedRoutes) {
      recommendations.push({
        route: route.path,
        reason: `Changed files: ${reasons.join(', ')}`,
        priority: reasons.length > 2 ? 'high' : reasons.length > 1 ? 'medium' : 'low',
        authRequired: route.isAuthProtected,
        waitStrategy: 'networkidle',
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Heuristic-based unified route analysis when AI is unavailable
   */
  private heuristicUnifiedAnalysis(
    visualFiles: string[],
    logicFiles: string[],
    routes: Route[],
    importGraph: { imports: Map<string, string[]>; importedBy: Map<string, string[]> }
  ): UnifiedTestRecommendation[] {
    if (routes.length === 0) {
      return [];
    }

    const routeMap = new Map<string, UnifiedTestRecommendation>();

    // Process visual files
    const visualAffected = findAffectedRoutes(visualFiles, routes, importGraph.importedBy);
    for (const [route, reasons] of visualAffected) {
      const existing = routeMap.get(route.path);
      if (existing) {
        existing.testTypes.push({
          category: 'visual',
          subtype: 'screenshot',
          details: {
            screenshotName: routeToScreenshotName(route.path),
          },
        });
      } else {
        routeMap.set(route.path, {
          route: route.path,
          reason: `Changed files: ${reasons.join(', ')}`,
          priority: reasons.length > 2 ? 'high' : reasons.length > 1 ? 'medium' : 'low',
          authRequired: route.isAuthProtected,
          testTypes: [
            {
              category: 'visual',
              subtype: 'screenshot',
              details: {
                screenshotName: routeToScreenshotName(route.path),
              },
            },
          ],
          waitStrategy: 'networkidle',
        });
      }
    }

    // Process logic files
    const logicAffected = findAffectedRoutes(logicFiles, routes, importGraph.importedBy);
    for (const [route, reasons] of logicAffected) {
      try {
        // Check if route has form handler or API endpoint
        const hasLogicCapability = route.hasFormHandler || route.hasApiEndpoint;
        if (!hasLogicCapability) continue;

        const existing = routeMap.get(route.path);

        // Generate heuristic steps and assertions with error boundaries
        let heuristicSteps: ReturnType<typeof this.generateHeuristicSteps> = [];
        let heuristicAssertions: ReturnType<typeof this.generateHeuristicAssertions> = [];

        try {
          heuristicSteps = this.generateHeuristicSteps(route);
        } catch (stepError) {
          logger.warn(`Failed to generate heuristic steps for ${route.path}: ${stepError instanceof Error ? stepError.message : stepError}`);
        }

        try {
          heuristicAssertions = this.generateHeuristicAssertions(route);
        } catch (assertionError) {
          logger.warn(`Failed to generate heuristic assertions for ${route.path}: ${assertionError instanceof Error ? assertionError.message : assertionError}`);
        }

        const logicTestType = {
          category: 'logic' as const,
          subtype: route.hasFormHandler ? 'form-submission' as const : 'crud-operation' as const,
          details: {
            action: route.hasFormHandler
              ? `Test form actions: ${route.actions.join(', ') || 'default'}`
              : `Test API: ${route.apiMethods.join(', ')}`,
            steps: heuristicSteps,
            assertions: heuristicAssertions,
          },
        };

        if (existing) {
          existing.testTypes.push(logicTestType);
          // Upgrade priority if needed
          if (reasons.length > 2 && existing.priority !== 'high') {
            existing.priority = 'high';
          }
        } else {
          routeMap.set(route.path, {
            route: route.path,
            reason: `Changed logic files: ${reasons.join(', ')}`,
            priority: reasons.length > 2 ? 'high' : reasons.length > 1 ? 'medium' : 'low',
            authRequired: route.isAuthProtected,
            testTypes: [logicTestType],
            waitStrategy: 'networkidle',
          });
        }
      } catch (routeError) {
        logger.warn(`Failed to process route ${route.path}: ${routeError instanceof Error ? routeError.message : routeError}`);
      }
    }

    return Array.from(routeMap.values()).sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Generate heuristic test steps based on route information.
   * Used when AI is unavailable for logic test generation.
   *
   * WARNING: These steps use generic selectors that may not match your application.
   * The generated tests will likely need manual adjustment to work correctly.
   * Consider using data-testid attributes in your application for reliable selectors.
   */
  private generateHeuristicSteps(
    route: Route
  ): Array<{ type: 'navigate' | 'fill' | 'click' | 'select' | 'check' | 'wait' | 'upload'; target?: string; value?: string; description: string }> {
    const steps: Array<{ type: 'navigate' | 'fill' | 'click' | 'select' | 'check' | 'wait' | 'upload'; target?: string; value?: string; description: string }> = [];

    if (route.hasFormHandler) {
      // Generate form interaction steps
      // NOTE: These selectors are generic and will need manual adjustment
      steps.push({
        type: 'wait',
        target: 'form',
        description: '[HEURISTIC] Wait for form to be visible - verify selector matches your form',
      });

      // Add generic form field interactions
      steps.push({
        type: 'fill',
        target: 'input:not([type="hidden"]):not([type="submit"]):first-of-type',
        value: 'test-value',
        description: '[HEURISTIC] Fill first visible input field - update selector and value for your form',
      });

      steps.push({
        type: 'click',
        target: 'button[type="submit"], input[type="submit"], form button:last-of-type',
        description: '[HEURISTIC] Submit the form - verify submit button selector',
      });
    } else if (route.hasApiEndpoint) {
      // For API endpoints accessed via UI, generate basic interaction
      // NOTE: These selectors are generic and will need manual adjustment
      steps.push({
        type: 'wait',
        target: '[data-testid], button, a[href]',
        description: '[HEURISTIC] Wait for interactive elements - update for your UI',
      });

      if (route.apiMethods.includes('POST') || route.apiMethods.includes('PUT')) {
        steps.push({
          type: 'click',
          target: 'button:not([type="submit"]), [data-testid*="create"], [data-testid*="add"]',
          description: '[HEURISTIC] Click action button - update selector for your UI',
        });
      }
    }

    // Log warning if heuristic steps are generated
    if (steps.length > 0) {
      logger.warn(`Generated heuristic test steps for ${route.path}. These use generic selectors and will need manual verification.`);
    }

    return steps;
  }

  /**
   * Generate heuristic assertions based on route information.
   * Used when AI is unavailable for logic test generation.
   *
   * WARNING: These assertions use generic selectors that may not match your application.
   * The generated tests will likely need manual adjustment to work correctly.
   */
  private generateHeuristicAssertions(
    route: Route
  ): Array<{ type: 'visible' | 'text' | 'url' | 'count' | 'attribute' | 'toast' | 'redirect'; target?: string; expected: string; description: string }> {
    const assertions: Array<{ type: 'visible' | 'text' | 'url' | 'count' | 'attribute' | 'toast' | 'redirect'; target?: string; expected: string; description: string }> = [];

    if (route.hasFormHandler) {
      // Check for success indicators after form submission
      // NOTE: These selectors are generic and will need manual adjustment
      assertions.push({
        type: 'toast',
        expected: '',
        description: '[HEURISTIC] Check for success/error toast - update expected text for your app',
      });

      // Alternative: check URL change or success message
      assertions.push({
        type: 'visible',
        target: '.success, .error, [role="alert"], [data-testid*="message"]',
        expected: 'visible',
        description: '[HEURISTIC] Check for form feedback - update selector for your UI',
      });
    } else if (route.hasApiEndpoint) {
      // For API endpoints, check for state changes
      // NOTE: These selectors are generic and will need manual adjustment
      assertions.push({
        type: 'visible',
        target: '[data-testid], .result, .response, .data',
        expected: 'visible',
        description: '[HEURISTIC] Check for data display - update selector for your UI',
      });
    }

    return assertions;
  }

  /**
   * Infer login flow from the project
   */
  private async inferLoginFlow() {
    if (!this.config.projectPath) return undefined;

    const loginPagePath = path.join(this.config.projectPath, 'src/routes/login/+page.svelte');
    const authLoginPath = path.join(this.config.projectPath, 'src/routes/(auth)/login/+page.svelte');

    let loginContent: string | undefined;
    if (fs.existsSync(loginPagePath)) {
      loginContent = fs.readFileSync(loginPagePath, 'utf-8');
    } else if (fs.existsSync(authLoginPath)) {
      loginContent = fs.readFileSync(authLoginPath, 'utf-8');
    }

    if (!loginContent) {
      return undefined;
    }

    return this.openai.inferLoginFlow(loginContent);
  }

  /**
   * Check if baselines exist for a PR
   */
  hasBaselines(prNumber: number): boolean {
    return this.baselineManager.hasBaselines(prNumber);
  }

  /**
   * List baselines for a PR
   */
  listBaselines(prNumber: number) {
    return this.baselineManager.listBaselines(prNumber);
  }

  /**
   * Delete baselines for a PR
   */
  deleteBaselines(prNumber: number): number {
    return this.baselineManager.deleteAllBaselines(prNumber);
  }

  /**
   * Get the GitHub client for direct API access
   */
  getGitHubClient(): GitHubClient {
    return this.github;
  }

  /**
   * Get the test generator for direct access
   */
  getTestGenerator(): TestGenerator {
    return this.testGenerator;
  }

  /**
   * Get the baseline manager for direct access
   */
  getBaselineManager(): BaselineManager {
    return this.baselineManager;
  }

  /**
   * Get the reporter for direct access
   */
  getReporter(): Reporter {
    return this.reporter;
  }
}

// Re-export types
export type { Route, AnalysisResult, HttpMethod } from './analyzer/types.js';
export type {
  AIAnalysisResult,
  RouteTestRecommendation,
  LoginFlowAnalysis,
  ExtendedAIAnalysisResult,
  UnifiedTestRecommendation,
  LogicChangeAnalysis,
  LogicAnalysisResult,
  InferredTestData,
  TestTypeSpec,
  LogicTestDetails,
  VisualTestDetails,
} from './ai/types.js';
export type { GeneratedTest, TestConfig, UnifiedGeneratedTest } from './generator/types.js';
export type { ComparisonResult, TestResult, TestRunResult, ReportData } from './visual/types.js';
export type { PRIdentifier, PullRequest, ChangedFile } from './github/types.js';

// Re-export utilities
export { logger, setLogLevel } from './utils/logger.js';
export { GitHubClient, createGitHubClient } from './github/client.js';
export { OpenAIClient, createOpenAIClient } from './ai/openai-client.js';
export { TestGenerator, createTestGenerator } from './generator/test-generator.js';
export { BaselineManager, createBaselineManager } from './visual/baseline-manager.js';
export { VisualComparator, createVisualComparator } from './visual/comparator.js';
export { Reporter, createReporter } from './visual/reporter.js';
