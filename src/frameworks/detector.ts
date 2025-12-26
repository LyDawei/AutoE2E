import type {
  FrameworkDetectionResult,
  FrameworkType,
  AdapterContext,
  FrameworkAdapter,
} from './types.js';
import { frameworkRegistry } from './registry.js';
import { logger } from '../utils/logger.js';

/**
 * Detection order - frameworks are checked in this order
 * More specific frameworks (like Remix) should come before
 * less specific ones (like React Router) that might match the same project
 */
const DETECTION_ORDER: FrameworkType[] = [
  'sveltekit',
  'remix', // Must come before react-router
  'react-router',
  'nextjs-app',
  'nextjs-pages',
  'nextjs',
  'nuxt',
];

/**
 * Auto-detect the framework used in a project
 *
 * @param ctx Adapter context with file access
 * @returns Detection result with the detected framework and confidence
 */
export async function detectFramework(
  ctx: AdapterContext
): Promise<FrameworkDetectionResult> {
  const results: Array<{ adapter: FrameworkAdapter; result: FrameworkDetectionResult }> = [];

  logger.debug('Starting framework detection...');

  // Run detection on all registered adapters in order
  for (const frameworkName of DETECTION_ORDER) {
    if (!frameworkRegistry.has(frameworkName)) {
      continue;
    }

    const adapter = frameworkRegistry.get(frameworkName);
    try {
      const result = await adapter.detect(ctx);

      logger.debug(`${adapter.displayName}: ${result.confidence} confidence - ${result.reason}`);

      if (result.confidence !== 'none') {
        results.push({ adapter, result });

        // If we get high confidence, we can stop early
        if (result.confidence === 'high') {
          logger.debug(`High confidence match found: ${adapter.displayName}`);
          return result;
        }
      }
    } catch (error) {
      logger.debug(`Error detecting ${adapter.displayName}: ${error}`);
    }
  }

  // Sort by confidence (high > medium > low)
  const confidenceOrder = { high: 0, medium: 1, low: 2, none: 3 };
  results.sort((a, b) => confidenceOrder[a.result.confidence] - confidenceOrder[b.result.confidence]);

  // Return highest confidence match
  if (results.length > 0) {
    const best = results[0];
    logger.debug(`Best match: ${best.adapter.displayName} (${best.result.confidence})`);
    return best.result;
  }

  return {
    framework: null,
    confidence: 'none',
    reason: 'No supported framework detected',
  };
}

/**
 * Detect all frameworks in a project (for hybrid setups)
 *
 * @param ctx Adapter context with file access
 * @returns Array of detection results, sorted by confidence
 */
export async function detectAllFrameworks(
  ctx: AdapterContext
): Promise<FrameworkDetectionResult[]> {
  const results: FrameworkDetectionResult[] = [];

  for (const frameworkName of DETECTION_ORDER) {
    if (!frameworkRegistry.has(frameworkName)) {
      continue;
    }

    const adapter = frameworkRegistry.get(frameworkName);
    try {
      const result = await adapter.detect(ctx);
      if (result.confidence !== 'none') {
        results.push(result);
      }
    } catch {
      // Skip this framework on error
    }
  }

  // Sort by confidence
  const confidenceOrder = { high: 0, medium: 1, low: 2, none: 3 };
  results.sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);

  return results;
}

/**
 * Get adapter for a specific framework
 *
 * @param framework Framework type
 * @returns The framework adapter
 * @throws If framework is not registered
 */
export function getAdapter(framework: FrameworkType): FrameworkAdapter {
  return frameworkRegistry.get(framework);
}

/**
 * Check if a framework is supported
 *
 * @param framework Framework type
 * @returns True if the framework is supported
 */
export function isFrameworkSupported(framework: string): framework is FrameworkType {
  return frameworkRegistry.has(framework as FrameworkType);
}

/**
 * Get list of all supported framework names
 *
 * @returns Array of supported framework identifiers
 */
export function getSupportedFrameworks(): FrameworkType[] {
  return frameworkRegistry.getRegisteredFrameworks();
}
