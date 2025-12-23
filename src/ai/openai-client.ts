import OpenAI from 'openai';
import { OpenAIError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { Route } from '../analyzer/types.js';
import type {
  AIAnalysisResult,
  LoginFlowAnalysis,
  RouteTestRecommendation,
} from './types.js';
import {
  buildDiffAnalysisPrompt,
  buildLoginFlowPrompt,
  buildTestGenerationPrompt,
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
}

export function createOpenAIClient(apiKey: string, model?: string): OpenAIClient {
  return new OpenAIClient({ apiKey, model });
}
