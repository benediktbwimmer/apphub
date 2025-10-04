const ERROR_PATTERNS: RegExp[] = [
  /"level"\s*:\s*50/,
  /\bFATAL\b/i,
  /Unhandled request error/i,
  /Unhandled rejection/i,
  /Unhandled promise rejection/i,
  /\berror\":\"[^"]+\"/i
];

const IGNORED_PATTERNS: RegExp[] = [
  /kubectl client unavailable/i,
  /failed to connect to proxy at startup/i
];

export interface LogAnalysisResult {
  errors: string[];
}

export function analyzeLogs(logs: string): LogAnalysisResult {
  const errors: string[] = [];
  const lines = logs.split(/\r?\n/);
  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (IGNORED_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }
    if (ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
      errors.push(line.trim());
    }
  }
  return { errors };
}
