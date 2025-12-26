# AutoE2E

An agentic visual regression test harness for modern frontend frameworks that automatically analyzes GitHub pull requests and generates visual regression tests using AI.

## Overview

AutoE2E bridges the gap between code changes and visual testing by intelligently analyzing pull requests and automatically generating Playwright tests for affected routes. It uses OpenAI GPT-4 Turbo to understand code changes and determine which pages need visual regression testing.

## Supported Frameworks

AutoE2E supports multiple frontend frameworks with automatic detection:

| Framework | Routing Type | Page Files | Dynamic Routes |
|-----------|-------------|------------|----------------|
| **SvelteKit** | `src/routes/` | `+page.svelte` | `[param]`, `[...rest]` |
| **Next.js (App Router)** | `app/` | `page.tsx` | `[param]`, `[...slug]` |
| **Next.js (Pages Router)** | `pages/` | `index.tsx`, `[name].tsx` | `[param]`, `[...slug]` |
| **Nuxt** | `pages/` | `index.vue` | `[param]`, `[...slug]` |
| **Remix** | `app/routes/` | `_index.tsx`, `route.tsx` | `$param`, `$.tsx` |
| **React Router** | `app/routes/` | `route.tsx`, `_index.tsx` | `$param`, `$.tsx` |

The framework is automatically detected from the PR's repository via GitHub API. You can also specify a framework manually using the `--framework` option.

## Features

- **Multi-Framework Support** - Works with SvelteKit, Next.js, Nuxt, Remix, and React Router
- **Automatic Framework Detection** - Detects framework from the repository via GitHub API
- **Monorepo Support** - Handles npm/yarn/pnpm workspaces, Turborepo, Nx, and Lerna
- **Intelligent PR Analysis** - Analyzes GitHub PR diffs to identify visually relevant changes
- **AI-Powered Route Detection** - Uses GPT-4 to determine which routes are affected by code changes
- **Automatic Test Generation** - Creates Playwright test files for identified routes
- **Route Discovery** - Automatically discovers all routes in a project
- **Dependency Graph Analysis** - Traces affected routes through import dependencies
- **Visual Regression Testing** - Pixel-level image comparison with configurable thresholds
- **HTML Report Generation** - Creates visual diff reports for easy review
- **Baseline Management** - Handles screenshot baselines per PR
- **Smart Fallbacks** - Uses heuristic analysis when AI is unavailable

## Prerequisites

- Node.js 18+
- npm 8+
- OpenAI API key
- GitHub token (recommended, for higher API rate limits and private repos)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/LyDawei/AutoE2E.git
   cd AutoE2E
   ```

2. Run the setup script:
   ```bash
   ./scripts/setup.sh
   ```

   Or manually:
   ```bash
   npm install
   npm run build
   npx playwright install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your settings:
   ```
   OPENAI_API_KEY=sk-...                    # Required: OpenAI API key
   TEST_URL=https://staging.example.com     # Required: Test environment URL
   GITHUB_TOKEN=ghp_...                     # Recommended: For private repos and higher rate limits
   TEST_USER=test@example.com               # Optional: Test user credentials
   TEST_PASSWORD=testpassword123            # Optional: Test user password
   ```

## Usage

### Analyze a Pull Request

Analyze a GitHub PR and generate visual regression tests:

```bash
npm run analyze https://github.com/owner/repo/pull/123
```

#### Framework Override

If automatic detection doesn't work correctly, you can specify the framework:

```bash
npm run analyze https://github.com/owner/repo/pull/123 -- --framework nextjs
```

Available framework options:
- `sveltekit`
- `nextjs` (auto-detects App or Pages router)
- `nextjs-app`
- `nextjs-pages`
- `nuxt`
- `remix`
- `react-router`

#### Monorepo Support

For monorepos, specify the app path:

```bash
npm run analyze https://github.com/owner/repo/pull/123 -- --app packages/web
```

#### Local Project Path

For faster analysis with local route discovery:

```bash
npm run analyze https://github.com/owner/repo/pull/123 -- --project /path/to/local/clone
```

#### All CLI Options

```bash
npm run analyze <pr-url> [options]

Options:
  -o, --output <dir>      Output directory for generated tests (default: "./generated")
  --test-url <url>        Test environment URL (overrides TEST_URL env var)
  --project <path>        Path to project for local route discovery
  --framework <type>      Framework type (auto-detected if not specified)
  --app <path>            App path within monorepo (e.g., "packages/web")
  --dry-run               Preview what would be generated without writing files
  --skip-ai               Skip AI analysis and use heuristics only
  --model <model>         OpenAI model to use (default: "gpt-4-turbo-preview")
  -v, --verbose           Enable verbose logging
```

### Run Visual Regression Tests

```bash
npm run vrt generated/pr-123.spec.ts
```

### Update Baselines

```bash
npm run vrt:update generated/pr-123.spec.ts
```

### Manage Baselines

```bash
# List baselines for a PR
npm run baselines 123 --list

# Clean baselines for a PR
npm run baselines 123 --clean
```

### List Tests and Baselines

```bash
npm run list
```

## Project Structure

```
src/
├── ai/                # OpenAI integration & prompts
├── analyzer/          # Code analysis & route discovery
├── frameworks/        # Framework adapters
│   ├── types.ts       # FrameworkAdapter interface
│   ├── base-adapter.ts # Abstract base class
│   ├── detector.ts    # Auto-detection logic
│   ├── registry.ts    # Adapter registry
│   ├── file-source.ts # Local & GitHub file access
│   ├── sveltekit/     # SvelteKit adapter
│   ├── nextjs/        # Next.js adapter (App + Pages)
│   ├── nuxt/          # Nuxt adapter
│   ├── remix/         # Remix adapter
│   └── react-router/  # React Router adapter
├── monorepo/          # Monorepo detection
│   ├── types.ts       # MonorepoConfig types
│   └── detector.ts    # Workspace detection
├── generator/         # Playwright test generation
├── github/            # GitHub API integration
├── visual/            # Visual testing & reporting
├── config/            # Configuration management
├── utils/             # Utilities (logging, errors)
├── cli.ts             # CLI commands
└── index.ts           # Main Yokohama class
tests/                 # Unit tests
scripts/
└── setup.sh           # Setup script
generated/             # Generated test files
baselines/             # Screenshot baselines
output/                # Reports and results
```

## Framework Detection

AutoE2E detects the framework using multiple indicators:

| Framework | High Confidence Detection |
|-----------|--------------------------|
| **SvelteKit** | `svelte.config.js` + `src/routes/` + `@sveltejs/kit` dependency |
| **Next.js** | `next.config.js` + `app/` or `pages/` + `next` dependency |
| **Nuxt** | `nuxt.config.ts` + `pages/` + `nuxt` dependency |
| **Remix** | `remix.config.js` + `app/routes/` + `@remix-run/*` dependency |
| **React Router** | `app/routes/` + `react-router` dependency (no Remix deps) |

For Next.js projects with both App Router (`app/`) and Pages Router (`pages/`), routes from both are discovered with App Router taking precedence for duplicate paths.

## Monorepo Support

AutoE2E automatically detects monorepo structures:

| Type | Detection |
|------|-----------|
| **npm workspaces** | `package.json` with `workspaces` field |
| **yarn workspaces** | `package.json` with `workspaces` + `yarn.lock` |
| **pnpm workspaces** | `pnpm-workspace.yaml` |
| **Turborepo** | `turbo.json` + workspace config |
| **Nx** | `nx.json` + `apps/`/`packages/` directories |
| **Lerna** | `lerna.json` |

When a monorepo is detected, use the `--app` flag to specify which workspace to analyze:

```bash
npm run analyze https://github.com/org/monorepo/pull/42 -- --app apps/web
```

## Development

### Build

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode
```

### Testing

```bash
npm test               # Run unit tests
npm run test:coverage  # Generate coverage report
```

### Linting

```bash
npm run lint           # Check code
npm run lint:fix       # Fix issues
```

## Configuration

### Playwright Settings

The Playwright configuration (`playwright.config.ts`) includes:

- **Viewport:** 1920x1080 (Desktop Chrome)
- **Max Diff Pixels:** 100
- **Threshold:** 0.2 (20% tolerance)
- **Screenshots:** Captured on test failures

### Output Directories

| Directory | Purpose |
|-----------|---------|
| `./generated/` | Generated Playwright test files |
| `./baselines/` | Screenshot baselines per PR |
| `./output/` | Reports and test results |

## How It Works

1. **Fetch PR Data** - Retrieves PR diff and changed files from GitHub
2. **Detect Framework** - Identifies the frontend framework from repo structure
3. **Detect Monorepo** - Identifies workspace structure if applicable
4. **Filter Changes** - Identifies visually relevant files (components, styles, layouts)
5. **Analyze with AI** - Uses GPT-4 to understand which routes are affected
6. **Discover Routes** - Maps the project's route structure using the detected framework adapter
7. **Build Dependency Graph** - Traces imports to find affected routes
8. **Generate Tests** - Creates Playwright test files for each affected route
9. **Run Visual Tests** - Executes tests and captures screenshots
10. **Compare & Report** - Compares against baselines and generates reports

## Adding New Framework Support

To add support for a new framework:

1. Create a new adapter in `src/frameworks/<framework>/adapter.ts`
2. Extend `BaseAdapter` and implement required methods:
   - `detect()` - Framework detection logic
   - `discoverRoutes()` - Route discovery
   - `getRoutesDirectory()` - Routes directory path
   - `isRouteFile()` / `isLayoutFile()` - File type detection
   - `getLoginPagePaths()` / `pathToRoute()` - Login page handling
3. Register the adapter in `src/frameworks/registry.ts`
4. Add to `SUPPORTED_FRAMEWORKS` in `src/config/defaults.ts`

## Technologies

- **TypeScript** - Type-safe development
- **Playwright** - Web automation and visual testing
- **OpenAI GPT-4** - Intelligent code analysis
- **Vitest** - Unit testing
- **Pixelmatch** - Image comparison
- **Commander** - CLI framework

## License

MIT
