// Types
export type {
  FrameworkType,
  FrameworkAdapter,
  FrameworkDetectionResult,
  DetectionConfidence,
  ImportAlias,
  LoginPageInfo,
  FileSource,
  AdapterContext,
  AdapterFactory,
} from './types.js';

// Registry
export { frameworkRegistry, FrameworkNotFoundError, getAdapter } from './registry.js';

// Detector
export {
  detectFramework,
  detectAllFrameworks,
  isFrameworkSupported,
  getSupportedFrameworks,
} from './detector.js';

// File Sources
export { LocalFileSource, GitHubFileSource, createFileSource } from './file-source.js';

// Base Adapter
export { BaseAdapter } from './base-adapter.js';

// Framework Adapters
export { SvelteKitAdapter, createSvelteKitAdapter } from './sveltekit/index.js';
export { NextJsAdapter, createNextJsAdapter } from './nextjs/index.js';
export { NuxtAdapter, createNuxtAdapter } from './nuxt/index.js';
export { RemixAdapter, createRemixAdapter } from './remix/index.js';
export { ReactRouterAdapter, createReactRouterAdapter } from './react-router/index.js';

// Register all built-in adapters
import { frameworkRegistry } from './registry.js';
import { createSvelteKitAdapter } from './sveltekit/index.js';
import { createNextJsAdapter } from './nextjs/index.js';
import { createNuxtAdapter } from './nuxt/index.js';
import { createRemixAdapter } from './remix/index.js';
import { createReactRouterAdapter } from './react-router/index.js';

// Auto-register adapters on import
frameworkRegistry.register('sveltekit', createSvelteKitAdapter);
frameworkRegistry.register('nextjs', () => createNextJsAdapter('hybrid'));
frameworkRegistry.register('nextjs-app', () => createNextJsAdapter('app'));
frameworkRegistry.register('nextjs-pages', () => createNextJsAdapter('pages'));
frameworkRegistry.register('nuxt', createNuxtAdapter);
frameworkRegistry.register('remix', createRemixAdapter);
frameworkRegistry.register('react-router', createReactRouterAdapter);
