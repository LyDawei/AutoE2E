import OpenAI from 'openai';
import { OpenAIError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { routeToScreenshotName } from '../utils/route-helpers.js';
import type { Route } from '../analyzer/types.js';
import type {
  AIAnalysisResult,
  LoginFlowAnalysis,
  RouteTestRecommendation,
  LogicAnalysisResult,
  ExtendedAIAnalysisResult,
  UnifiedTestRecommendation,
  InferredTestData,
  VisualChangeAnalysis,
  LogicChangeAnalysis,
} from './types.js';
import {
  buildDiffAnalysisPrompt,
  buildLoginFlowPrompt,
  buildTestGenerationPrompt,
  buildLogicAnalysisPrompt,
  buildUnifiedTestGenerationPrompt,
  parseAIResponse,
  extractCodeFromResponse,
} from './prompts.js';

export interface OpenAIClientConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  retryDelay?: number;
}

export class OpenAIClient {
  private client: OpenAI;
  private model: string;
  private maxRetries: number;
  private retryDelay: number;

  constructor(config: OpenAIClientConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'gpt-4-turbo-preview';
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
  }

  /**
   * Make a completion request with retry logic
   */
  private async complete(
    systemPrompt: string,
    userPrompt: string,
    responseFormat?: 'json' | 'text'
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
          response_format:
            responseFormat === 'json' ? { type: 'json_object' } : undefined,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new OpenAIError('Empty response from OpenAI');
        }

        return content;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof OpenAI.APIError) {
          // Don't retry on client errors (4xx except 429)
          if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
            throw new OpenAIError(`OpenAI API error: ${error.message}`);
          }
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.warn(`OpenAI request failed, retrying in ${delay}ms (attempt ${attempt}/${this.maxRetries})`);
          await this.sleep(delay);
        }
      }
    }

    throw new OpenAIError(`OpenAI request failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Analyze changes and determine which routes need testing
   */
  async analyzeChanges(
    diff: string,
    changedFiles: string[],
    routes: Route[]
  ): Promise<AIAnalysisResult> {
    logger.info('Analyzing changes with GPT-4...');

    const systemPrompt = `You are an expert SvelteKit developer and QA engineer.
You analyze code changes to determine visual regression testing needs.
Always respond with valid JSON matching the requested format.
Be conservative - it's better to test more routes than miss a visual regression.`;

    const userPrompt = buildDiffAnalysisPrompt(diff, changedFiles, routes);

    const response = await this.complete(systemPrompt, userPrompt, 'json');
    return parseAIResponse<AIAnalysisResult>(response);
  }

  /**
   * Infer login flow from page content
   */
  async inferLoginFlow(
    loginPageContent: string,
    layoutContent?: string
  ): Promise<LoginFlowAnalysis> {
    logger.info('Inferring login flow with GPT-4...');

    const systemPrompt = `You are an expert at analyzing web application login forms.
You extract CSS selectors and data-testid attributes for automation.
Always respond with valid JSON.
Prefer data-testid attributes when available, then id, then name, then type-based selectors.`;

    const userPrompt = buildLoginFlowPrompt(loginPageContent, layoutContent);

    const response = await this.complete(systemPrompt, userPrompt, 'json');
    return parseAIResponse<LoginFlowAnalysis>(response);
  }

  /**
   * Generate Playwright test code
   */
  async generateTestCode(
    routes: RouteTestRecommendation[],
    testUrl: string,
    loginFlow: LoginFlowAnalysis | undefined,
    prNumber: number
  ): Promise<string> {
    logger.info('Generating Playwright test code with GPT-4...');

    const systemPrompt = `You are an expert Playwright test engineer.
You write clean, maintainable visual regression tests.
Generate complete, valid TypeScript code that can be executed directly.
Do not include markdown formatting or explanations, only code.`;

    const userPrompt = buildTestGenerationPrompt(routes, testUrl, loginFlow, prNumber);

    const response = await this.complete(systemPrompt, userPrompt, 'text');
    return extractCodeFromResponse(response);
  }

  /**
   * Analyze logic/API changes in the diff
   */
  async analyzeLogicChanges(
    diff: string,
    changedFiles: string[],
    routes: Route[]
  ): Promise<LogicAnalysisResult> {
    logger.info('Analyzing logic changes with GPT-4...');

    const systemPrompt = `You are an expert SvelteKit developer and QA engineer.
You analyze code changes to determine functional/behavioral testing needs.
Focus on form handlers, API endpoints, data validation, and CRUD operations.
Always respond with valid JSON matching the requested format.
Be conservative - it's better to test more scenarios than miss important logic.`;

    const userPrompt = buildLogicAnalysisPrompt(diff, changedFiles, routes);

    const response = await this.complete(systemPrompt, userPrompt, 'json');
    return parseAIResponse<LogicAnalysisResult>(response);
  }

  /**
   * Perform unified analysis for both visual and logic changes
   */
  async analyzeUnified(
    diff: string,
    visualFiles: string[],
    logicFiles: string[],
    routes: Route[]
  ): Promise<ExtendedAIAnalysisResult> {
    logger.info('Performing unified analysis with GPT-4...');

    // Track analysis errors for reporting
    const errors: { type: 'visual' | 'logic'; message: string }[] = [];

    // Run both analyses in parallel for efficiency with proper typing
    const visualPromise: Promise<AIAnalysisResult | null> =
      visualFiles.length > 0
        ? this.analyzeChanges(diff, visualFiles, routes).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`Visual analysis failed: ${message}`);
            errors.push({ type: 'visual', message });
            return null;
          })
        : Promise.resolve(null);

    const logicPromise: Promise<LogicAnalysisResult | null> =
      logicFiles.length > 0
        ? this.analyzeLogicChanges(diff, logicFiles, routes).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`Logic analysis failed: ${message}`);
            errors.push({ type: 'logic', message });
            return null;
          })
        : Promise.resolve(null);

    const [visualAnalysis, logicAnalysis] = await Promise.all([visualPromise, logicPromise]);

    // Report partial failures to user
    if (errors.length > 0) {
      const failedTypes = errors.map(e => e.type).join(' and ');
      logger.warn(`Partial analysis failure: ${failedTypes} analysis failed. Results may be incomplete.`);
    }

    // If both failed, throw an error rather than returning empty results
    if (visualFiles.length > 0 && logicFiles.length > 0 && !visualAnalysis && !logicAnalysis) {
      throw new OpenAIError(`Both visual and logic analyses failed. Errors: ${errors.map(e => `${e.type}: ${e.message}`).join('; ')}`);
    }

    // Merge results into unified recommendations
    return this.mergeAnalysisResults(visualAnalysis, logicAnalysis);
  }

  /**
   * Merge visual and logic analysis results into unified recommendations
   */
  private mergeAnalysisResults(
    visual: AIAnalysisResult | null,
    logic: LogicAnalysisResult | null
  ): ExtendedAIAnalysisResult {
    const changes: Array<VisualChangeAnalysis | LogicChangeAnalysis> = [];
    const routeMap = new Map<string, UnifiedTestRecommendation>();
    let testData: InferredTestData | undefined;
    let confidence = 0;
    let reasoning = '';

    // Process visual analysis
    if (visual) {
      changes.push(...visual.changes);
      confidence = visual.confidence;
      reasoning = visual.reasoning;

      for (const route of visual.routesToTest) {
        const existing = routeMap.get(route.route);
        if (existing) {
          // Add visual test type to existing
          existing.testTypes.push({
            category: 'visual',
            subtype: 'screenshot',
            details: {
              screenshotName: routeToScreenshotName(route.route),
            },
          });
        } else {
          routeMap.set(route.route, {
            route: route.route,
            reason: route.reason,
            priority: route.priority,
            authRequired: route.authRequired,
            testTypes: [
              {
                category: 'visual',
                subtype: 'screenshot',
                details: {
                  screenshotName: routeToScreenshotName(route.route),
                },
              },
            ],
            waitStrategy: route.waitStrategy,
          });
        }
      }
    }

    // Process logic analysis
    if (logic) {
      changes.push(...logic.changes);
      testData = logic.testData;

      // Average confidence if both analyses exist
      if (visual) {
        confidence = (confidence + logic.confidence) / 2;
        reasoning = `Visual: ${reasoning}. Logic: ${logic.reasoning}`;
      } else {
        confidence = logic.confidence;
        reasoning = logic.reasoning;
      }

      for (const route of logic.routesToTest) {
        const existing = routeMap.get(route.route);
        if (existing) {
          // Add logic test types to existing
          existing.testTypes.push(...route.testTypes);
          // Use higher priority (lower rank = higher priority)
          if (this.priorityRank(route.priority) < this.priorityRank(existing.priority)) {
            existing.priority = route.priority;
          }
          // Combine reasons
          existing.reason = `${existing.reason}; ${route.reason}`;
        } else {
          routeMap.set(route.route, route);
        }
      }
    }

    return {
      changes,
      routesToTest: Array.from(routeMap.values()),
      loginFlow: visual?.loginFlow,
      testData,
      confidence,
      reasoning,
    };
  }

  /**
   * Generate unified test code with both visual and logic tests
   */
  async generateUnifiedTestCode(
    routes: UnifiedTestRecommendation[],
    testUrl: string,
    loginFlow: LoginFlowAnalysis | undefined,
    testData: InferredTestData | undefined,
    prNumber: number
  ): Promise<string> {
    logger.info('Generating unified Playwright test code with GPT-4...');

    const systemPrompt = `You are an expert Playwright test engineer.
You write comprehensive tests covering both visual regression and functional behavior.
Generate complete, valid TypeScript code that can be executed directly.
Do not include markdown formatting or explanations, only code.
For logic tests, always test through the UI (forms, buttons) not direct API calls.`;

    const userPrompt = buildUnifiedTestGenerationPrompt(
      routes,
      testUrl,
      loginFlow,
      testData,
      prNumber
    );

    const response = await this.complete(systemPrompt, userPrompt, 'text');
    return extractCodeFromResponse(response);
  }

  /**
   * Get numeric priority rank for comparison.
   * Lower rank = higher priority (0=high, 1=medium, 2=low).
   * This allows comparison with < operator: if (rankA < rankB) then A has higher priority.
   */
  private priorityRank(priority: 'high' | 'medium' | 'low'): number {
    switch (priority) {
      case 'high':
        return 0;
      case 'medium':
        return 1;
      case 'low':
        return 2;
    }
  }
}

export function createOpenAIClient(apiKey: string, model?: string): OpenAIClient {
  return new OpenAIClient({ apiKey, model });
}
