export class YokohamaError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'YokohamaError';
  }
}

export class GitHubError extends YokohamaError {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message, 'GITHUB_ERROR');
    this.name = 'GitHubError';
  }
}

export class OpenAIError extends YokohamaError {
  constructor(message: string) {
    super(message, 'OPENAI_ERROR');
    this.name = 'OpenAIError';
  }
}

export class RouteAnalysisError extends YokohamaError {
  constructor(message: string) {
    super(message, 'ROUTE_ANALYSIS_ERROR');
    this.name = 'RouteAnalysisError';
  }
}

export class BaselineError extends YokohamaError {
  constructor(message: string) {
    super(message, 'BASELINE_ERROR');
    this.name = 'BaselineError';
  }
}

export class ConfigError extends YokohamaError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}
