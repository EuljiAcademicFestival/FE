import { API_CONFIG, isConfigured } from './apiConfig.js';

export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN', message = '요청에 실패했습니다.', data = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export const tokenStore = {
  get() {
    try {
      return sessionStorage.getItem(API_CONFIG.tokenStorageKey) ?? localStorage.getItem(API_CONFIG.tokenStorageKey);
    } catch { return null; }
  },
  set(token) {
    try {
      sessionStorage.setItem(API_CONFIG.tokenStorageKey, token);
      localStorage.removeItem(API_CONFIG.tokenStorageKey);
    } catch {}
  },
  clear() {
    try {
      sessionStorage.removeItem(API_CONFIG.tokenStorageKey);
      localStorage.removeItem(API_CONFIG.tokenStorageKey);
    } catch {}
  },
};

export class HttpClient {
  constructor({ onUnauthorized } = {}) {
    this.onUnauthorized = onUnauthorized || null;
  }

  get isReady() { return isConfigured(API_CONFIG.baseUrl); }

  async request(method, path, { query, body, auth = true, signal } = {}) {
    if (!this.isReady) {
      throw new ApiError({ code: 'API_NOT_CONFIGURED', message: '서버 주소가 설정되지 않았습니다.' });
    }

    const url = this._buildUrl(path, query);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = tokenStore.get();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const ctrl = new AbortController();
    const timeoutMs = typeof API_CONFIG.timeoutMs === 'number' ? API_CONFIG.timeoutMs : API_CONFIG.defaultTimeoutMs;
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
    if (signal) {
      if (signal.aborted) ctrl.abort(signal.reason);
      else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
    }

    const init = { method, headers, signal: ctrl.signal };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (isConfigured(API_CONFIG.credentials)) {
      init.credentials = API_CONFIG.credentials;
    }

    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (signal?.aborted) throw err;
      const timedOut = err?.name === 'TimeoutError' || ctrl.signal.reason?.name === 'TimeoutError';
      throw new ApiError({
        code: timedOut ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR',
        message: timedOut ? '서버 응답이 지연되고 있습니다.' : '서버에 연결할 수 없습니다.',
      });
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    try { payload = await res.json(); } catch {}

    if (!res.ok) {
      const error = new ApiError({
        status: res.status,
        code: payload?.code || `HTTP_${res.status}`,
        message: payload?.message || res.statusText || '요청에 실패했습니다.',
        data: payload?.data ?? null,
      });
      if (res.status === 401) {
        tokenStore.clear();
        this.onUnauthorized?.(error);
      }
      throw error;
    }
    return payload?.data ?? null;
  }

  get(path, opts) { return this.request('GET', path, opts); }
  post(path, body, opts) { return this.request('POST', path, { ...opts, body }); }
  put(path, body, opts) { return this.request('PUT', path, { ...opts, body }); }
  delete(path, opts) { return this.request('DELETE', path, opts); }

  _buildUrl(path, query) {
    const base = API_CONFIG.baseUrl.replace(/\/+$/, '');
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const s = qs.toString();
    return `${base}${path}${s ? `?${s}` : ''}`;
  }
}

export const http = new HttpClient();
