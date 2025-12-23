import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';
import { DEFAULTS } from '../config/defaults.js';
import type { BaselineMetadata, BaselineInfo } from './types.js';

export class BaselineManager {
  private baselinesDir: string;

  constructor(baselinesDir?: string) {
    this.baselinesDir = baselinesDir || DEFAULTS.baselinesDir;
  }

  /**
   * Get the baseline directory for a PR
   */
  getBaselineDir(prNumber: number): string {
    return path.join(this.baselinesDir, `pr-${prNumber}`);
  }

  /**
   * Check if baselines exist for a PR
   */
  hasBaselines(prNumber: number): boolean {
    const dir = this.getBaselineDir(prNumber);
    if (!fs.existsSync(dir)) {
      return false;
    }

    // Check for at least one PNG file
    const files = fs.readdirSync(dir);
    return files.some((file) => file.endsWith('.png'));
  }

  /**
   * Get baseline image path for a route
   */
  getBaselinePath(prNumber: number, screenshotName: string): string {
    return path.join(this.getBaselineDir(prNumber), `${screenshotName}.png`);
  }

  /**
   * Get baseline image buffer
   */
  getBaseline(prNumber: number, screenshotName: string): Buffer | null {
    const filePath = this.getBaselinePath(prNumber, screenshotName);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath);
  }

  /**
   * Save a new baseline
   */
  saveBaseline(prNumber: number, screenshotName: string, image: Buffer): string {
    const dir = this.getBaselineDir(prNumber);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${screenshotName}.png`);
    fs.writeFileSync(filePath, image);
    logger.debug(`Saved baseline: ${filePath}`);

    return filePath;
  }

  /**
   * Update an existing baseline
   */
  updateBaseline(prNumber: number, screenshotName: string, image: Buffer): string {
    return this.saveBaseline(prNumber, screenshotName, image);
  }

  /**
   * Delete a baseline
   */
  deleteBaseline(prNumber: number, screenshotName: string): boolean {
    const filePath = this.getBaselinePath(prNumber, screenshotName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  /**
   * Delete all baselines for a PR
   */
  deleteAllBaselines(prNumber: number): number {
    const dir = this.getBaselineDir(prNumber);
    if (!fs.existsSync(dir)) {
      return 0;
    }

    const files = fs.readdirSync(dir);
    let deleted = 0;

    for (const file of files) {
      const filePath = path.join(dir, file);
      fs.unlinkSync(filePath);
      deleted++;
    }

    // Remove the directory
    fs.rmdirSync(dir);
    logger.info(`Deleted ${deleted} baselines for PR #${prNumber}`);

    return deleted;
  }

  /**
   * List all baselines for a PR
   */
  listBaselines(prNumber: number): BaselineInfo[] {
    const dir = this.getBaselineDir(prNumber);
    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
    const metadata = this.loadMetadata(prNumber);

    return files.map((file) => {
      const screenshotName = file.replace('.png', '');
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);

      return {
        prNumber,
        route: this.screenshotNameToRoute(screenshotName),
        screenshotName,
        filePath,
        capturedAt: stats.mtime,
        viewport: metadata?.viewport || DEFAULTS.viewport,
      };
    });
  }

  /**
   * Save metadata for baselines
   */
  saveMetadata(
    prNumber: number,
    testUrl: string,
    routes: Array<{ path: string; screenshotName: string }>
  ): void {
    const dir = this.getBaselineDir(prNumber);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const metadata: BaselineMetadata = {
      prNumber,
      capturedAt: new Date().toISOString(),
      testUrl,
      viewport: DEFAULTS.viewport,
      routes,
    };

    const filePath = path.join(dir, 'metadata.json');
    fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Load metadata for baselines
   */
  loadMetadata(prNumber: number): BaselineMetadata | null {
    const filePath = path.join(this.getBaselineDir(prNumber), 'metadata.json');
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as BaselineMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Convert screenshot name back to route (best effort)
   */
  private screenshotNameToRoute(name: string): string {
    if (name === 'home') {
      return '/';
    }
    return '/' + name.replace(/-/g, '/');
  }

  /**
   * List all PRs with baselines
   */
  listAllPRs(): number[] {
    if (!fs.existsSync(this.baselinesDir)) {
      return [];
    }

    return fs
      .readdirSync(this.baselinesDir)
      .filter((dir) => dir.match(/^pr-\d+$/))
      .map((dir) => parseInt(dir.replace('pr-', ''), 10))
      .sort((a, b) => b - a);
  }

  /**
   * Get total baseline storage size
   */
  getStorageSize(): number {
    if (!fs.existsSync(this.baselinesDir)) {
      return 0;
    }

    let totalSize = 0;

    function getSize(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          getSize(fullPath);
        } else {
          totalSize += fs.statSync(fullPath).size;
        }
      }
    }

    getSize(this.baselinesDir);
    return totalSize;
  }
}

export function createBaselineManager(baselinesDir?: string): BaselineManager {
  return new BaselineManager(baselinesDir);
}
