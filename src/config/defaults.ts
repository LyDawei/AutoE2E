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
export const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0';

export const SUPPORTED_FRAMEWORKS = [
  'sveltekit',
  'nextjs',
  'nextjs-app',
  'nextjs-pages',
  'nuxt',
  'remix',
  'react-router',
  'angular',
] as const;
export type SupportedFramework = (typeof SUPPORTED_FRAMEWORKS)[number];
