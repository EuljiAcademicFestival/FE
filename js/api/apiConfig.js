import { ENV } from '../env.js';

export const API_CONFIG = {
  frontendUrl: ENV.FRONTEND_URL,
  baseUrl: ENV.API_BASE_URL,
  timeoutMs: 10000,
  defaultTimeoutMs: 10000,
  tokenStorageKey: 'eulji.accessToken.v1',
  credentials: 'omit',
  wsUrl: ENV.WS_URL,
  wsPath: '/ws/festival',
};

export const isConfigured = (value) => typeof value === 'string' && value.length > 0;

export function resolveWsUrl() {
  if (isConfigured(API_CONFIG.wsUrl)) return API_CONFIG.wsUrl;
  if (isConfigured(API_CONFIG.baseUrl)) {
    return API_CONFIG.baseUrl.replace(/\/+$/, '').replace(/^http/i, 'ws') + API_CONFIG.wsPath;
  }
  return null;
}
