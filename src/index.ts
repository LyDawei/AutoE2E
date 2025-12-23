import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger, setLogLevel } from './utils/logger.js';
import { ConfigError } from './utils/errors.js';
import { DEFAULTS } from './config/defaults.js';
import { GitHubClient } from './github/client.js';
import { filterVisuallyRelevantFiles } from './github/parser.js';
import { discoverRoutes, findAffectedRoutes } from './analyzer/route-mapper.js';
import { buildImportGraph } from './analyzer/import-graph.js';
import { OpenAIClient } from './ai/openai-client.js';
import { TestGenerator } from './generator/test-generator.js';
import { BaselineManager } from './visual/baseline-manager.js';
import { Reporter } from './visual/reporter.js';
import type { Route } from './analyzer/types.js';
import type { AIAnalysisResult, RouteTestRecommendation } from './ai/types.js';
import type { GeneratedTest } from './generator/types.js';

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
export type { Route, AnalysisResult } from './analyzer/types.js';
export type { AIAnalysisResult, RouteTestRecommendation, LoginFlowAnalysis } from './ai/types.js';
export type { GeneratedTest, TestConfig } from './generator/types.js';
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
