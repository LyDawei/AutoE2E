export const DEFAULTS = {
  viewport: {
    width: 1920,
    height: 1080,
  },
  outputDir: './generated',
  baselinesDir: './baselines',
  reportsDir: './output',
  maxDiffPixels: 100,
  diffThreshold: 0.2,
  screenshotTimeout: 30000,
  networkIdleTimeout: 5000,
} as const;

export const GITHUB_API_BASE = 'https://api.github.com';

export const SUPPORTED_FRAMEWORKS = ['sveltekit'] as const;
export type SupportedFramework = (typeof SUPPORTED_FRAMEWORKS)[number];
