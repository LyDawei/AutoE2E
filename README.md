# AutoE2E

An agentic visual regression test harness for SvelteKit that automatically analyzes GitHub pull requests and generates visual regression tests using AI.

## Overview

AutoE2E bridges the gap between code changes and visual testing by intelligently analyzing pull requests and automatically generating Playwright tests for affected routes. It uses OpenAI GPT-4 Turbo to understand code changes and determine which pages need visual regression testing.

## Features

- **Intelligent PR Analysis** - Analyzes GitHub PR diffs to identify visually relevant changes
- **AI-Powered Route Detection** - Uses GPT-4 to determine which routes are affected by code changes
- **Automatic Test Generation** - Creates Playwright test files for identified routes
- **Route Discovery** - Automatically discovers all routes in a SvelteKit project
- **Dependency Graph Analysis** - Traces affected routes through import dependencies
- **Visual Regression Testing** - Pixel-level image comparison with configurable thresholds
- **HTML Report Generation** - Creates visual diff reports for easy review
- **Baseline Management** - Handles screenshot baselines per PR
- **Smart Fallbacks** - Uses heuristic analysis when AI is unavailable

## Prerequisites

- Node.js 18+
- npm 8+
- OpenAI API key
- GitHub token (optional, for private repos)

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
   GITHUB_TOKEN=ghp_...                     # Optional: For private repos
   TEST_USER=test@example.com               # Optional: Test user credentials
   TEST_PASSWORD=testpassword123            # Optional: Test user password
   ```

## Usage

### Analyze a Pull Request

Analyze a GitHub PR and generate visual regression tests:

```bash
npm run analyze https://github.com/owner/repo/pull/123
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
├── src/
│   ├── ai/                # OpenAI integration & prompts
│   ├── analyzer/          # Code analysis & route discovery
│   ├── generator/         # Playwright test generation
│   ├── github/            # GitHub API integration
│   ├── visual/            # Visual testing & reporting
│   ├── config/            # Configuration management
│   ├── utils/             # Utilities (logging, errors)
│   ├── cli.ts             # CLI commands
│   └── index.ts           # Main Yokohama class
├── tests/                 # Unit tests
├── scripts/
│   └── setup.sh           # Setup script
├── generated/             # Generated test files
├── baselines/             # Screenshot baselines
└── output/                # Reports and results
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
2. **Filter Changes** - Identifies visually relevant files (components, styles, layouts)
3. **Analyze with AI** - Uses GPT-4 to understand which routes are affected
4. **Discover Routes** - Maps the SvelteKit route structure
5. **Build Dependency Graph** - Traces imports to find affected routes
6. **Generate Tests** - Creates Playwright test files for each affected route
7. **Run Visual Tests** - Executes tests and captures screenshots
8. **Compare & Report** - Compares against baselines and generates reports

## Technologies

- **TypeScript** - Type-safe development
- **Playwright** - Web automation and visual testing
- **OpenAI GPT-4** - Intelligent code analysis
- **Vitest** - Unit testing
- **Pixelmatch** - Image comparison
- **Commander** - CLI framework

## License

MIT
