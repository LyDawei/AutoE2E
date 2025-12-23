#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { Yokohama } from './index.js';
import { setLogLevel } from './utils/logger.js';
import { loadEnvConfig } from './config/env.js';
import { DEFAULTS } from './config/defaults.js';

const program = new Command();

program
  .name('yokohama')
  .description('Agentic visual regression test harness for SvelteKit')
  .version('1.0.0');

// Analyze command
program
  .command('analyze <pr-url>')
  .description('Analyze a GitHub PR and generate Playwright visual regression tests')
  .option('-o, --output <dir>', 'Output directory for generated tests', DEFAULTS.outputDir)
  .option('--test-url <url>', 'Test environment URL (overrides TEST_URL env var)')
  .option('--project <path>', 'Path to SvelteKit project for route discovery')
  .option('--dry-run', 'Preview what would be generated without writing files')
  .option('--skip-ai', 'Skip AI analysis and use heuristics only')
  .option('--model <model>', 'OpenAI model to use', 'gpt-4-turbo-preview')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (prUrl: string, options) => {
    if (options.verbose) {
      setLogLevel('debug');
    }

    const spinner = ora('Initializing...').start();

    try {
      // Load environment config
      const envConfig = loadEnvConfig();

      const yokohama = new Yokohama({
        openaiApiKey: envConfig.openaiApiKey,
        testUrl: options.testUrl || envConfig.testUrl,
        githubToken: envConfig.githubToken,
        testUser: envConfig.testUser,
        testPassword: envConfig.testPassword,
        outputDir: options.output,
        projectPath: options.project,
        model: options.model,
        logLevel: options.verbose ? 'debug' : 'info',
      });

      spinner.text = 'Analyzing PR...';

      const result = await yokohama.analyze(prUrl, {
        dryRun: options.dryRun,
        skipAI: options.skipAi,
      });

      spinner.succeed('Analysis complete!');

      console.log('');
      console.log(chalk.bold('Results:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`PR Number: ${chalk.cyan(`#${result.prNumber}`)}`);
      console.log(`Routes to test: ${chalk.cyan(result.routes.length)}`);

      if (result.routes.length > 0) {
        console.log('');
        console.log(chalk.bold('Routes:'));
        for (const route of result.routes) {
          const priority = route.priority === 'high'
            ? chalk.red(route.priority)
            : route.priority === 'medium'
              ? chalk.yellow(route.priority)
              : chalk.green(route.priority);
          const auth = route.authRequired ? chalk.magenta(' (auth)') : '';
          console.log(`  ${chalk.cyan(route.route)}${auth} - ${priority}`);
          console.log(`    ${chalk.gray(route.reason)}`);
        }
      }

      if (result.filePath) {
        console.log('');
        console.log(`Generated test: ${chalk.green(result.filePath)}`);
      } else if (options.dryRun) {
        console.log('');
        console.log(chalk.yellow('Dry run - no files written'));
        console.log('');
        console.log(chalk.bold('Generated test content:'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(result.generatedTest.content);
      }

      if (result.analysis) {
        console.log('');
        console.log(`AI Confidence: ${chalk.cyan((result.analysis.confidence * 100).toFixed(0) + '%')}`);
      }

      console.log('');
      console.log(chalk.gray('Run the tests with:'));
      console.log(chalk.cyan(`  npx playwright test ${result.generatedTest.filePath}`));
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// Run command (placeholder - tests are run via Playwright directly)
program
  .command('run <pr-number>')
  .description('Run visual regression tests for a PR')
  .option('--update-baselines', 'Update baselines instead of comparing')
  .action(async (prNumber: string, options) => {
    const prNum = parseInt(prNumber, 10);
    if (isNaN(prNum)) {
      console.error(chalk.red('Invalid PR number'));
      process.exit(1);
    }

    const testFile = `${DEFAULTS.outputDir}/pr-${prNum}.spec.ts`;

    console.log(chalk.bold('Running tests...'));
    console.log('');
    console.log('Execute the following command to run the tests:');
    console.log('');

    if (options.updateBaselines) {
      console.log(chalk.cyan(`  npx playwright test ${testFile} --update-snapshots`));
    } else {
      console.log(chalk.cyan(`  npx playwright test ${testFile}`));
    }

    console.log('');
    console.log(chalk.gray('Note: Yokohama generates Playwright tests that you run with Playwright CLI.'));
  });

// Baselines command
program
  .command('baselines <pr-number>')
  .description('Manage baselines for a PR')
  .option('--clean', 'Remove all baselines for the PR')
  .option('--list', 'List all baselines for the PR')
  .action(async (prNumber: string, options) => {
    const prNum = parseInt(prNumber, 10);
    if (isNaN(prNum)) {
      console.error(chalk.red('Invalid PR number'));
      process.exit(1);
    }

    try {
      const envConfig = loadEnvConfig();

      const yokohama = new Yokohama({
        openaiApiKey: envConfig.openaiApiKey,
        testUrl: envConfig.testUrl,
      });

      if (options.clean) {
        const deleted = yokohama.deleteBaselines(prNum);
        console.log(chalk.green(`Deleted ${deleted} baselines for PR #${prNum}`));
        return;
      }

      // Default: list baselines
      const baselines = yokohama.listBaselines(prNum);

      if (baselines.length === 0) {
        console.log(chalk.yellow(`No baselines found for PR #${prNum}`));
        return;
      }

      console.log(chalk.bold(`Baselines for PR #${prNum}:`));
      console.log('');

      for (const baseline of baselines) {
        console.log(`  ${chalk.cyan(baseline.screenshotName)}`);
        console.log(`    Route: ${baseline.route}`);
        console.log(`    Captured: ${baseline.capturedAt.toISOString()}`);
        console.log(`    Viewport: ${baseline.viewport.width}x${baseline.viewport.height}`);
        console.log('');
      }
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .description('List all generated tests and baselines')
  .action(async () => {
    try {
      const envConfig = loadEnvConfig();

      const yokohama = new Yokohama({
        openaiApiKey: envConfig.openaiApiKey,
        testUrl: envConfig.testUrl,
      });

      const testFiles = yokohama.getTestGenerator().listTestFiles();
      const prs = yokohama.getBaselineManager().listAllPRs();

      console.log(chalk.bold('Generated Tests:'));
      if (testFiles.length === 0) {
        console.log(chalk.gray('  No tests generated yet'));
      } else {
        for (const file of testFiles) {
          console.log(`  ${chalk.cyan(file)}`);
        }
      }

      console.log('');
      console.log(chalk.bold('PRs with Baselines:'));
      if (prs.length === 0) {
        console.log(chalk.gray('  No baselines yet'));
      } else {
        for (const pr of prs) {
          const baselines = yokohama.listBaselines(pr);
          console.log(`  PR #${chalk.cyan(pr)} - ${baselines.length} baselines`);
        }
      }
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program.parse();
