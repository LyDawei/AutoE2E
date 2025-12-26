import type { FrameworkAdapter, FrameworkType, AdapterFactory } from './types.js';

/**
 * Error thrown when a framework is not found in the registry
 */
export class FrameworkNotFoundError extends Error {
  constructor(framework: string) {
    super(`Unknown framework: ${framework}. Available frameworks: ${frameworkRegistry.getRegisteredFrameworks().join(', ')}`);
    this.name = 'FrameworkNotFoundError';
  }
}

/**
 * Registry for framework adapters using Singleton pattern.
 * Provides lazy instantiation and caching of adapter instances.
 */
class FrameworkRegistry {
  private adapters: Map<FrameworkType, AdapterFactory> = new Map();
  private instances: Map<FrameworkType, FrameworkAdapter> = new Map();

  /**
   * Register a framework adapter factory
   * @param name Framework identifier
   * @param factory Factory function that creates the adapter
   */
  register(name: FrameworkType, factory: AdapterFactory): void {
    this.adapters.set(name, factory);
    // Clear cached instance if re-registering
    this.instances.delete(name);
  }

  /**
   * Get adapter instance (lazy instantiation with caching)
   * @param name Framework identifier
   * @returns The framework adapter instance
   * @throws FrameworkNotFoundError if framework is not registered
   */
  get(name: FrameworkType): FrameworkAdapter {
    let instance = this.instances.get(name);
    if (!instance) {
      const factory = this.adapters.get(name);
      if (!factory) {
        throw new FrameworkNotFoundError(name);
      }
      instance = factory();
      this.instances.set(name, instance);
    }
    return instance;
  }

  /**
   * Get all registered adapter instances
   * @returns Array of all framework adapter instances
   */
  getAll(): FrameworkAdapter[] {
    return Array.from(this.adapters.keys()).map((name) => this.get(name));
  }

  /**
   * Check if a framework is registered
   * @param name Framework identifier to check
   * @returns True if the framework is registered
   */
  has(name: FrameworkType): boolean {
    return this.adapters.has(name);
  }

  /**
   * Get all registered framework names
   * @returns Array of registered framework identifiers
   */
  getRegisteredFrameworks(): FrameworkType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Clear all cached adapter instances (useful for testing)
   */
  clearInstances(): void {
    this.instances.clear();
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.adapters.clear();
    this.instances.clear();
  }
}

// Singleton instance
export const frameworkRegistry = new FrameworkRegistry();

/**
 * Get an adapter by framework type.
 * Convenience function that delegates to the registry.
 */
export function getAdapter(framework: FrameworkType): FrameworkAdapter {
  return frameworkRegistry.get(framework);
}

/**
 * Register all built-in framework adapters.
 * Called automatically when importing from frameworks/index.ts
 */
export function registerBuiltInAdapters(): void {
  // Lazy imports to avoid circular dependencies
  // These will be registered when the adapters are implemented
}
