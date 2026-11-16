import { CONFIG } from './config.js';
import { ApiError } from './api/index.js';
import { sfx } from './audio.js';

const $ = (s) => document.querySelector(s);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LOGIN_ERRORS = {
  AUTH_INVALID_CREDENTIALS: '이메일 또는 비밀번호를 확인해 주세요.',
  AUTH_INVALID_INPUT: '입력값을 확인해 주세요.',
};

export function authGate(store) {
  const root = $('#auth');
  const form = $('#authForm');
  const email = $('#authEmail');
  const pw = $('#authPw');
  const submit = $('#authSubmit');
  let mode = 'login';
  let busy = false;

  $('#authYear').textContent = CONFIG.eventYear;
  $('#authTitle').textContent = CONFIG.eventTitle;

  const setErr = (which, msg) => {
    $(`#auth${which}Err`).textContent = msg || '';
    $(`#auth${which}Err`).closest('.field').classList.toggle('has-err', !!msg);
  };
  const clearErr = () => { setErr('Email'); setErr('Pw'); };

  const setMode = (m) => {
    mode = m;
    root.querySelectorAll('.seg__btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
    submit.textContent = m === 'login' ? '로그인' : '다음 (캐릭터 만들기)';
    pw.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('#authHint').textContent = m === 'login'
      ? '가입한 이메일과 비밀번호로 로그인해요. 로그인은 1시간 동안 유지돼요.'
      : '이메일과 비밀번호를 정한 뒤 캐릭터·이름·학년·방명록까지 입력하면 가입이 완료돼요.';
    clearErr();
  };

  root.querySelectorAll('.seg__btn').forEach((b) => b.addEventListener('click', () => { sfx.tap(); setMode(b.dataset.mode); }));
  setMode('login');
  root.hidden = false;
  root.classList.remove('is-leaving');
  email.focus({ preventScroll: true });

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      clearErr();
      const em = email.value.trim();
      const pass = pw.value;
      let bad = false;
      if (!EMAIL_RE.test(em)) { setErr('Email', '이메일 형식을 확인해 주세요.'); bad = true; }
      if (!pass.trim()) { setErr('Pw', '비밀번호를 입력해 주세요.'); bad = true; }
      if (bad) { sfx.error(); return; }

      const done = () => {
        root.classList.add('is-leaving');
        setTimeout(() => { if (root.classList.contains('is-leaving')) root.hidden = true; }, 380);
        resolve({ mode });
      };

      if (mode === 'signup') {
        store.setPendingSignup({ email: em, password: pass });
        sfx.next();
        done();
        return;
      }

      busy = true;
      submit.disabled = true;
      try {
        await store.login({ email: em, password: pass });
        done();
      } catch (err) {
        sfx.error();
        if (err instanceof ApiError) setErr('Pw', LOGIN_ERRORS[err.code] || err.message);
        else setErr('Pw', '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.');
      } finally {
        busy = false;
        submit.disabled = false;
      }
    });
  });
}
