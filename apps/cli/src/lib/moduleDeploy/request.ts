import { coreRequest, type CoreRequestConfig } from '../core';

export function createCoreRequest(options: { baseUrl: string; token: string }) {
  return async function <T>(config: Omit<CoreRequestConfig, 'baseUrl' | 'token'>): Promise<T> {
    return coreRequest<T>({
      baseUrl: options.baseUrl,
      token: options.token,
      ...config
    });
  };
}
