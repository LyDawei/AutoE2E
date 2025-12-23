import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';
import { DEFAULTS } from '../config/defaults.js';
import type { ReportData, TestResult } from './types.js';

export class Reporter {
  private outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir || DEFAULTS.reportsDir;
  }

  /**
   * Get the output directory for a PR
   */
  getOutputDir(prNumber: number): string {
    return path.join(this.outputDir, `pr-${prNumber}`);
  }

  /**
   * Get the diff images directory for a PR
   */
  getDiffDir(prNumber: number): string {
    return path.join(this.getOutputDir(prNumber), 'diffs');
  }

  /**
   * Save a diff image
   */
  saveDiffImage(prNumber: number, screenshotName: string, diffImage: Buffer): string {
    const dir = this.getDiffDir(prNumber);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${screenshotName}-diff.png`);
    fs.writeFileSync(filePath, diffImage);
    return filePath;
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(data: ReportData): string {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Visual Regression Report - PR #${data.prNumber}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      background: ${data.passed ? '#22c55e' : '#ef4444'};
      color: white;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    header h1 {
      font-size: 24px;
      margin-bottom: 10px;
    }
    .meta {
      display: flex;
      gap: 30px;
      font-size: 14px;
      opacity: 0.9;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .stat h3 {
      font-size: 14px;
      color: #666;
      margin-bottom: 5px;
    }
    .stat .value {
      font-size: 32px;
      font-weight: bold;
    }
    .stat.passed .value { color: #22c55e; }
    .stat.failed .value { color: #ef4444; }
    .results {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .result {
      border-bottom: 1px solid #eee;
      padding: 20px;
    }
    .result:last-child {
      border-bottom: none;
    }
    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .result-route {
      font-size: 18px;
      font-weight: 600;
    }
    .badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge.passed {
      background: #dcfce7;
      color: #166534;
    }
    .badge.failed {
      background: #fee2e2;
      color: #991b1b;
    }
    .result-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      font-size: 14px;
      color: #666;
    }
    .images {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-top: 15px;
    }
    .image-container {
      text-align: center;
    }
    .image-container h4 {
      font-size: 12px;
      color: #666;
      margin-bottom: 8px;
    }
    .image-container img {
      max-width: 100%;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    .error {
      background: #fee2e2;
      color: #991b1b;
      padding: 10px;
      border-radius: 4px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Visual Regression Report - PR #${data.prNumber}</h1>
      <div class="meta">
        <span>Test URL: ${data.testUrl}</span>
        <span>Run at: ${data.runAt.toISOString()}</span>
        <span>Duration: ${(data.duration / 1000).toFixed(2)}s</span>
      </div>
    </header>

    <div class="summary">
      <div class="stat">
        <h3>Total Tests</h3>
        <div class="value">${data.results.length}</div>
      </div>
      <div class="stat passed">
        <h3>Passed</h3>
        <div class="value">${data.results.filter((r) => r.passed).length}</div>
      </div>
      <div class="stat failed">
        <h3>Failed</h3>
        <div class="value">${data.results.filter((r) => !r.passed).length}</div>
      </div>
    </div>

    <div class="results">
      ${data.results.map((result) => this.generateResultHTML(result)).join('')}
    </div>
  </div>
</body>
</html>`;

    return html;
  }

  private generateResultHTML(result: TestResult): string {
    const statusBadge = result.passed
      ? '<span class="badge passed">Passed</span>'
      : '<span class="badge failed">Failed</span>';

    const details = result.comparison
      ? `
        <div class="result-details">
          <div><strong>Diff Pixels:</strong> ${result.comparison.diffPixels}</div>
          <div><strong>Diff %:</strong> ${result.comparison.diffPercentage.toFixed(2)}%</div>
          <div><strong>Threshold:</strong> ${result.comparison.threshold}</div>
          <div><strong>Size:</strong> ${result.comparison.dimensions.width}x${result.comparison.dimensions.height}</div>
        </div>
      `
      : '';

    const images =
      !result.passed && result.diffPath
        ? `
        <div class="images">
          ${result.baselinePath ? `<div class="image-container"><h4>Baseline</h4><img src="${path.basename(result.baselinePath)}" alt="Baseline"></div>` : ''}
          ${result.actualPath ? `<div class="image-container"><h4>Actual</h4><img src="${path.basename(result.actualPath)}" alt="Actual"></div>` : ''}
          ${result.diffPath ? `<div class="image-container"><h4>Diff</h4><img src="diffs/${path.basename(result.diffPath)}" alt="Diff"></div>` : ''}
        </div>
      `
        : '';

    const error = result.error
      ? `<div class="error">${result.error}</div>`
      : '';

    return `
      <div class="result">
        <div class="result-header">
          <span class="result-route">${result.route}</span>
          ${statusBadge}
        </div>
        ${details}
        ${images}
        ${error}
      </div>
    `;
  }

  /**
   * Generate text summary
   */
  generateTextSummary(data: ReportData): string {
    const passed = data.results.filter((r) => r.passed).length;
    const failed = data.results.filter((r) => !r.passed).length;

    let summary = `
Visual Regression Report - PR #${data.prNumber}
${'='.repeat(50)}

Test URL: ${data.testUrl}
Run at: ${data.runAt.toISOString()}
Duration: ${(data.duration / 1000).toFixed(2)}s

Summary
-------
Total: ${data.results.length}
Passed: ${passed}
Failed: ${failed}
Status: ${data.passed ? 'PASSED' : 'FAILED'}

Results
-------
`;

    for (const result of data.results) {
      const status = result.passed ? '✓' : '✗';
      summary += `${status} ${result.route}`;

      if (result.comparison) {
        summary += ` (${result.comparison.diffPixels} diff pixels, ${result.comparison.diffPercentage.toFixed(2)}%)`;
      }

      if (result.error) {
        summary += ` - Error: ${result.error}`;
      }

      summary += '\n';
    }

    return summary.trim();
  }

  /**
   * Save the full report
   */
  saveReport(data: ReportData): { htmlPath: string; textPath: string } {
    const dir = this.getOutputDir(data.prNumber);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save HTML report
    const htmlPath = path.join(dir, 'report.html');
    fs.writeFileSync(htmlPath, this.generateHTMLReport(data));

    // Save text summary
    const textPath = path.join(dir, 'summary.txt');
    fs.writeFileSync(textPath, this.generateTextSummary(data));

    logger.success(`Report saved to ${dir}`);

    return { htmlPath, textPath };
  }

  /**
   * Clean up reports for a PR
   */
  cleanReports(prNumber: number): void {
    const dir = this.getOutputDir(prNumber);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
      logger.info(`Cleaned reports for PR #${prNumber}`);
    }
  }
}

export function createReporter(outputDir?: string): Reporter {
  return new Reporter(outputDir);
}
