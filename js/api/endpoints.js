import { http, tokenStore } from './httpClient.js';
import { gradeToServer, characterToServer } from './mappers.js';

const enc = encodeURIComponent;

export const authApi = {
  signup({ email, password, character, name, grade, guestbookMessage }) {
    return http.post('/api/auth/signup', {
      email,
      password,
      characterId: characterToServer(character),
      name,
      grade: gradeToServer(grade),
      guestbookMessage,
    }, { auth: false });
  },

  async login({ email, password }) {
    const data = await http.post('/api/auth/login', { email, password }, { auth: false });
    if (data?.accessToken) tokenStore.set(data.accessToken);
    return data;
  },

  logout() { tokenStore.clear(); },
  isLoggedIn() { return !!tokenStore.get(); },
};

export const memberApi = {
  updateProfile({ character, name, grade, guestbookMessage }) {
    return http.put('/api/members/me/profile', {
      characterId: characterToServer(character),
      name,
      grade: gradeToServer(grade),
      guestbookMessage,
    });
  },
};

export const characterApi = {
  async labels(memberIds) {
    if (!memberIds?.length) return { characters: [] };
    return http.get('/api/characters', { query: { memberIds } });
  },

  detail(memberId) {
    return http.get(`/api/characters/${enc(memberId)}`);
  },
};

export const guestbookApi = {
  list({ sort = 'popular', cursor, limit, signal } = {}) {
    return http.get('/api/guestbook', { query: { sort, cursor, limit }, signal });
  },

  like(memberId) {
    return http.put(`/api/guestbook/${enc(memberId)}/like`);
  },

  unlike(memberId) {
    return http.delete(`/api/guestbook/${enc(memberId)}/like`);
  },

  setLike(memberId, liked) {
    return liked ? this.like(memberId) : this.unlike(memberId);
  },
};

export const rankingApi = {
  top() {
    return http.get('/api/rankings/top');
  },
};
