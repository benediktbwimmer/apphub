import { DEFAULT_API_BASE_URL, type ApiConfig } from './api/ApiProvider';

type EnvValue = string | boolean | undefined;

type MetaEnv = {
  VITE_API_BASE_URL?: EnvValue;
  VITE_API_TOKEN?: EnvValue;
};

function readEnvBaseUrl(): string | null {
  const raw = (import.meta.env as MetaEnv | undefined)?.VITE_API_BASE_URL;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.replace(/\/$/, '');
}

function readEnvToken(): string {
  const raw = (import.meta.env as MetaEnv | undefined)?.VITE_API_TOKEN;
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.trim();
}

export function resolveDefaultApiConfig(): ApiConfig {
  return {
    baseUrl: readEnvBaseUrl() ?? DEFAULT_API_BASE_URL,
    token: readEnvToken()
  } satisfies ApiConfig;
}
