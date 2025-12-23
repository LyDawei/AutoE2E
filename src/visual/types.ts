export interface ComparisonResult {
  match: boolean;
  diffPixels: number;
  diffPercentage: number;
  threshold: number;
  dimensions: {
    width: number;
    height: number;
  };
}

export interface BaselineInfo {
  prNumber: number;
  route: string;
  screenshotName: string;
  filePath: string;
  capturedAt: Date;
  viewport: {
    width: number;
    height: number;
  };
}

export interface BaselineMetadata {
  prNumber: number;
  capturedAt: string;
  testUrl: string;
  viewport: {
    width: number;
    height: number;
  };
  routes: Array<{
    path: string;
    screenshotName: string;
  }>;
}

export interface TestResult {
  route: string;
  screenshotName: string;
  passed: boolean;
  comparison?: ComparisonResult;
  error?: string;
  baselinePath?: string;
  actualPath?: string;
  diffPath?: string;
}

export interface TestRunResult {
  prNumber: number;
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
  duration: number;
  reportPath?: string;
}

export interface ReportData {
  prNumber: number;
  testUrl: string;
  runAt: Date;
  duration: number;
  passed: boolean;
  results: TestResult[];
}
