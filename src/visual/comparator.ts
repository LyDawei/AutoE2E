import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { ComparisonResult } from './types.js';
import { DEFAULTS } from '../config/defaults.js';

export interface ComparatorOptions {
  threshold?: number;
  maxDiffPixels?: number;
  includeAA?: boolean;
}

export class VisualComparator {
  private threshold: number;
  private maxDiffPixels: number;
  private includeAA: boolean;

  constructor(options?: ComparatorOptions) {
    this.threshold = options?.threshold ?? DEFAULTS.diffThreshold;
    this.maxDiffPixels = options?.maxDiffPixels ?? DEFAULTS.maxDiffPixels;
    this.includeAA = options?.includeAA ?? false;
  }

  /**
   * Compare two images and return comparison metrics
   */
  compare(actual: Buffer, expected: Buffer): ComparisonResult {
    const actualPng = PNG.sync.read(actual);
    const expectedPng = PNG.sync.read(expected);

    // Check dimensions match
    if (actualPng.width !== expectedPng.width || actualPng.height !== expectedPng.height) {
      // Images have different dimensions - they don't match
      return {
        match: false,
        diffPixels: actualPng.width * actualPng.height,
        diffPercentage: 100,
        threshold: this.threshold,
        dimensions: {
          width: actualPng.width,
          height: actualPng.height,
        },
      };
    }

    const { width, height } = actualPng;
    const totalPixels = width * height;

    // Create diff image buffer (we'll discard it if not needed)
    const diff = new PNG({ width, height });

    const diffPixels = pixelmatch(
      actualPng.data,
      expectedPng.data,
      diff.data,
      width,
      height,
      {
        threshold: this.threshold,
        includeAA: this.includeAA,
      }
    );

    const diffPercentage = (diffPixels / totalPixels) * 100;
    const match = diffPixels <= this.maxDiffPixels;

    return {
      match,
      diffPixels,
      diffPercentage,
      threshold: this.threshold,
      dimensions: { width, height },
    };
  }

  /**
   * Generate a diff image highlighting differences
   */
  generateDiffImage(actual: Buffer, expected: Buffer): Buffer {
    const actualPng = PNG.sync.read(actual);
    const expectedPng = PNG.sync.read(expected);

    // Handle dimension mismatch by creating a side-by-side comparison
    if (actualPng.width !== expectedPng.width || actualPng.height !== expectedPng.height) {
      return this.createSideBySideImage(actualPng, expectedPng);
    }

    const { width, height } = actualPng;
    const diff = new PNG({ width, height });

    pixelmatch(
      actualPng.data,
      expectedPng.data,
      diff.data,
      width,
      height,
      {
        threshold: this.threshold,
        includeAA: this.includeAA,
        diffColor: [255, 0, 0], // Red for differences
        diffColorAlt: [0, 255, 0], // Green for anti-aliasing
      }
    );

    return PNG.sync.write(diff);
  }

  /**
   * Create a side-by-side comparison image for dimension mismatches
   */
  private createSideBySideImage(actual: PNG, expected: PNG): Buffer {
    const maxWidth = Math.max(actual.width, expected.width);
    const maxHeight = Math.max(actual.height, expected.height);
    const combinedWidth = maxWidth * 2 + 10; // 10px gap
    const combinedHeight = maxHeight;

    const combined = new PNG({
      width: combinedWidth,
      height: combinedHeight,
      fill: true,
    });

    // Fill with gray background
    for (let y = 0; y < combinedHeight; y++) {
      for (let x = 0; x < combinedWidth; x++) {
        const idx = (y * combinedWidth + x) * 4;
        combined.data[idx] = 128;
        combined.data[idx + 1] = 128;
        combined.data[idx + 2] = 128;
        combined.data[idx + 3] = 255;
      }
    }

    // Copy expected image (left side)
    for (let y = 0; y < expected.height; y++) {
      for (let x = 0; x < expected.width; x++) {
        const srcIdx = (y * expected.width + x) * 4;
        const dstIdx = (y * combinedWidth + x) * 4;
        combined.data[dstIdx] = expected.data[srcIdx];
        combined.data[dstIdx + 1] = expected.data[srcIdx + 1];
        combined.data[dstIdx + 2] = expected.data[srcIdx + 2];
        combined.data[dstIdx + 3] = expected.data[srcIdx + 3];
      }
    }

    // Copy actual image (right side)
    const offsetX = maxWidth + 10;
    for (let y = 0; y < actual.height; y++) {
      for (let x = 0; x < actual.width; x++) {
        const srcIdx = (y * actual.width + x) * 4;
        const dstIdx = (y * combinedWidth + (x + offsetX)) * 4;
        combined.data[dstIdx] = actual.data[srcIdx];
        combined.data[dstIdx + 1] = actual.data[srcIdx + 1];
        combined.data[dstIdx + 2] = actual.data[srcIdx + 2];
        combined.data[dstIdx + 3] = actual.data[srcIdx + 3];
      }
    }

    return PNG.sync.write(combined);
  }
}

export function createVisualComparator(options?: ComparatorOptions): VisualComparator {
  return new VisualComparator(options);
}
