import { BaseStore, read, write } from './store.js';
import { authApi, guestbookApi, memberApi, characterApi, gradeFromServer, characterFromServer } from './api/index.js';

const LS_ME = 'eulji.memberId.v1';
const LS_JACKET = 'eulji.jacket.v1';
const PAGE_LIMIT = 100;
const MAX_PAGES = 5;

export class ApiStore extends BaseStore {
  constructor() {
    super();
    this.mode = 'api';
    this.liked = new Set();
    this.byId = new Map();
    this.memberId = read(LS_ME, null);
    this.pending = null;
    this.rankMap = null;
    this.countMap = new Map();
  }

  get loggedIn() { return authApi.isLoggedIn() && this.memberId != null; }

  async login({ email, password }) {
    const data = await authApi.login({ email, password });
    this.memberId = String(data.memberId);
    write(LS_ME, this.memberId);
    return this.memberId;
  }

  setPendingSignup(creds) { this.pending = creds; }

  logout() {
    authApi.logout();
    this.memberId = null;
    write(LS_ME, null);
  }

  myProfile() {
    const e = this.memberId != null ? this.byId.get(String(this.memberId)) : null;
    return e ? { id: e.id, name: e.name, grade: e.grade, char: e.char, jacket: e.jacket, message: e.message } : null;
  }

  async ready() {
    if (this.loggedIn) await this.reload();
    return this;
  }

  async reload() {
    const fresh = new Map();
    const liked = new Set();
    let cursor = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const { entries = [], nextCursor = null } = await guestbookApi.list({ sort: 'popular', cursor, limit: PAGE_LIMIT });
      for (const s of entries) {
        const e = this._fromServer(s);
        fresh.set(e.id, e);
        if (s.likedByMe) liked.add(e.id);
      }
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    for (const [id, e] of this.byId) if (!fresh.has(id) && e._live) fresh.set(id, e);
    this.byId = fresh;
    this.liked = liked;
    this._applyCommon();
    this._sync();
  }

  _fromServer(s) {
    const id = String(s.memberId);
    return {
      id,
      name: s.name,
      grade: gradeFromServer(s.grade),
      char: characterFromServer(s.characterId),
      jacket: this._jacketOf(id),
      message: s.guestbookMessage ?? '',
      likes: s.likeCount ?? 0,
      rank: s.rank ?? null,
      createdAt: s.createdAt ? Date.parse(s.createdAt) : Date.now(),
      elapsedTimeText: s.elapsedTimeText || '',
    };
  }

  _jacketOf(id) { return !!read(LS_JACKET, {})[id]; }
  _saveJacket(id, on) { const m = read(LS_JACKET, {}); m[id] = !!on; write(LS_JACKET, m); }

  _sync() {
    this.entries = [...this.byId.values()];
    this.emit();
  }
  get(id) { return this.byId.get(String(id)) || null; }

  async add(data) {
    if (!this.pending) throw new Error('가입 정보(이메일/비밀번호)가 없습니다.');
    const { email, password } = this.pending;
    await authApi.signup({ email, password, character: data.char, name: data.name, grade: data.grade, guestbookMessage: data.message });
    const id = await this.login({ email, password });
    this.pending = null;
    this._saveJacket(id, data.jacket);
    await this.reload();
    return id;
  }

  async update(id, data) {
    const res = await memberApi.updateProfile({ character: data.char, name: data.name, grade: data.grade, guestbookMessage: data.message });
    this._saveJacket(id, data.jacket);
    const cur = this.byId.get(String(id));
    const next = {
      ...(cur || { id: String(id), createdAt: Date.now(), rank: null }),
      name: res.name, grade: gradeFromServer(res.grade), char: characterFromServer(res.characterId),
      jacket: !!data.jacket, message: res.guestbookMessage, likes: res.likeCount ?? cur?.likes ?? 0,
    };
    this.byId.set(String(id), next);
    this._sync();
  }

  async toggleLike(id) {
    id = String(id);
    const res = await guestbookApi.setLike(id, !this.liked.has(id));
    res.likedByMe ? this.liked.add(id) : this.liked.delete(id);
    const cur = this.byId.get(id);
    if (cur) this.byId.set(id, { ...cur, likes: res.likeCount });
    this.countMap.set(id, res.likeCount);
    this._sync();
    return !!res.likedByMe;
  }

  applyEngagement({ counts = [], rankings = [] }) {
    for (const c of counts) this.countMap.set(String(c.memberId), c.likeCount);
    this.rankMap = new Map(rankings.map((r) => [String(r.memberId), r.rank]));
    for (const r of rankings) this.countMap.set(String(r.memberId), r.likeCount);
    this._applyCommon();
    this._sync();
  }

  _applyCommon() {
    for (const [id, e] of this.byId) {
      if (this.countMap.has(id)) e.likes = this.countMap.get(id);
      if (this.rankMap) e.rank = this.rankMap.get(id) ?? null;
    }
  }

  upsertIdentity(identity) {
    const id = String(identity.memberId);
    const base = this.byId.get(id);
    const e = {
      ...(base || { id, message: '', likes: this.countMap.get(id) ?? 0, rank: this.rankMap?.get(id) ?? null, createdAt: Date.now(), elapsedTimeText: '', jacket: this._jacketOf(id), _live: true }),
      name: identity.name, grade: gradeFromServer(identity.grade), char: characterFromServer(identity.characterId),
    };
    this.byId.set(id, e);
    this._sync();
    if (!base) this._fetchDetail(id);
    return e;
  }

  applyIdentity(identity) { this.upsertIdentity(identity); }

  async _fetchDetail(id) {
    try {
      const d = await characterApi.detail(id);
      const cur = this.byId.get(id);
      if (!cur) return;
      if (d.likedByMe) this.liked.add(id);
      this.byId.set(id, {
        ...cur, message: d.guestbookMessage ?? cur.message,
        likes: this.countMap.get(id) ?? d.likeCount ?? cur.likes,
        rank: this.rankMap ? (this.rankMap.get(id) ?? null) : (d.rank ?? null),
      });
      this._sync();
    } catch (err) { console.warn('[store] 상세 조회 실패', id, err); }
  }
}
