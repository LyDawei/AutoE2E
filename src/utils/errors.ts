export class AutoE2EError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'AutoE2EError';
  }
}

export class GitHubError extends AutoE2EError {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message, 'GITHUB_ERROR');
    this.name = 'GitHubError';
  }
}

export class OpenAIError extends AutoE2EError {
  constructor(message: string) {
    super(message, 'OPENAI_ERROR');
    this.name = 'OpenAIError';
  }
}

export class RouteAnalysisError extends AutoE2EError {
  constructor(message: string) {
    super(message, 'ROUTE_ANALYSIS_ERROR');
    this.name = 'RouteAnalysisError';
  }
}

export class BaselineError extends AutoE2EError {
  constructor(message: string) {
    super(message, 'BASELINE_ERROR');
    this.name = 'BaselineError';
  }
}

export class ConfigError extends AutoE2EError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}
