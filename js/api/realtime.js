import { resolveWsUrl } from './apiConfig.js';
import { tokenStore } from './httpClient.js';

const PING_MS = 10_000;
const MOVE_MIN_INTERVAL_MS = 100;

export class RealtimeClient {
  constructor(handlers = {}) {
    this.h = handlers;
    this.ws = null;
    this.status = 'offline';
    this.memberId = null;
    this.wanted = false;
    this._reset();
    this._retry = 0;
  }

  get online() { return this.status === 'online'; }

  _reset() {
    this.seq = 0;
    this.stateRev = -1;
    this.engageRev = -1;
    this.playerSeq = new Map();
    this.lastMoveAt = 0;
  }

  _setStatus(s) { if (this.status !== s) { this.status = s; this.h.onStatus?.(s); } }

  connect() {
    const url = resolveWsUrl();
    if (!url) { this._setStatus('offline'); return false; }
    this.wanted = true;
    this._open(url);
    return true;
  }

  disconnect() {
    this.wanted = false;
    clearTimeout(this._retryTimer);
    this._stopPing();
    this.ws?.close(1000, 'client');
    this.ws = null;
    this._setStatus('offline');
  }

  _open(url) {
    this._reset();
    this._setStatus('connecting');
    let ws;
    try { ws = new WebSocket(url); } catch { this._scheduleRetry(); return; }
    this.ws = ws;

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this._stopPing();
      this.ws = null;
      this._setStatus('offline');
      if (!this.wanted) return;
      if (ev.code === 1008 && /AUTH/i.test(ev.reason || '')) { this.wanted = false; this.h.onAuthFailed?.(ev.reason); return; }
      this._scheduleRetry(ev.code);
    };
    ws.onerror = () => {};
  }

  _scheduleRetry() {
    clearTimeout(this._retryTimer);
    const delay = Math.min(15_000, 800 * 2 ** this._retry++) + Math.random() * 400;
    this._retryTimer = setTimeout(() => { const u = resolveWsUrl(); if (this.wanted && u) this._open(u); }, delay);
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(obj)); return true; }
    return false;
  }

  _onMessage({ type, data }) {
    switch (type) {
      case 'AUTH_REQUIRED': {
        this._setStatus('authenticating');
        const accessToken = tokenStore.get();
        if (!accessToken) { this.wanted = false; this.h.onAuthFailed?.('NO_TOKEN'); this.ws?.close(1000); return; }
        this._send({ type: 'AUTH', accessToken });
        break;
      }
      case 'WELCOME':
        this._retry = 0;
        this.memberId = data.memberId;
        this._setStatus('online');
        this._startPing();
        for (const p of data.players || []) this.playerSeq.set(p.identity.memberId, p.sequence ?? -1);
        this.h.onWelcome?.(data);
        break;
      case 'PLAYER_JOINED':
        this.playerSeq.set(data.identity.memberId, data.sequence ?? -1);
        this.h.onPlayerJoined?.(data);
        break;
      case 'PLAYER_LEFT':
        this.playerSeq.delete(data.memberId);
        this.h.onPlayerLeft?.(data);
        break;
      case 'PLAYER_UPDATED':
        this.h.onPlayerUpdated?.(data);
        break;
      case 'STATE': {
        if (data.revision <= this.stateRev) break;
        this.stateRev = data.revision;
        const fresh = [];
        for (const p of data.players || []) {
          if (p.memberId === this.memberId) continue;
          if ((p.sequence ?? -1) < (this.playerSeq.get(p.memberId) ?? -1)) continue;
          this.playerSeq.set(p.memberId, p.sequence ?? -1);
          fresh.push(p);
        }
        if (fresh.length) this.h.onState?.(fresh);
        break;
      }
      case 'ENGAGEMENT_STATE':
        if (data.revision <= this.engageRev) break;
        this.engageRev = data.revision;
        this.h.onEngagement?.(data);
        break;
      case 'PONG':
        break;
      default:
        break;
    }
  }

  sendMove({ x, y, z, yaw }, { force = false } = {}) {
    if (!this.online) return false;
    const now = performance.now();
    if (!force && now - this.lastMoveAt < MOVE_MIN_INTERVAL_MS) return false;
    this.lastMoveAt = now;
    return this._send({ type: 'MOVE', sequence: this.seq++, x, y, z, yaw });
  }

  syncEngagement() { return this._send({ type: 'SYNC_ENGAGEMENT' }); }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => this._send({ type: 'PING' }), PING_MS);
  }
  _stopPing() { clearInterval(this._pingTimer); this._pingTimer = null; }
}
