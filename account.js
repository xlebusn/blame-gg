'use strict';
/* Аккаунт через Telegram-бота: сайт получает одноразовый токен → бот спрашивает «Войти?» → сайт забирает сессию.
   Вошедшим данные (история, пати, свой аккаунт Dota, настройки) хранятся на сервере, подписка BLAME+ — за Telegram. */

const Account = {
  me: null, sid: null, serverSkew: 0,
  get logged() { return !!this.me; },
  get plusUntil() { return this.me ? this.me.plus_until * 1000 : 0; },
  get plus() { return this.me ? this.me.plus_until * 1000 > Date.now() + this.serverSkew : false; },

  async api(path, opt = {}) {
    if (!CONFIG.apiUrl) throw Error('Сервер не подключён');
    const r = await fetch(CONFIG.apiUrl + path, {
      ...opt, headers: { 'content-type': 'application/json', ...(this.sid ? { authorization: 'Bearer ' + this.sid } : {}) },
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && this.sid) this.forget();
    if (!r.ok) throw Object.assign(Error(j.error || 'Ошибка сервера'), { status: r.status });
    return j;
  },

  async load() {
    this.sid = store.get('blame.sid', null);
    if (!this.sid) { attachGuest(); return false; }
    try {
      const j = await this.api('/api/me');
      this.me = j.me; this.serverSkew = j.now * 1000 - Date.now();
      attachRemote(j.me.data || {});
      return true;
    } catch (e) { if (e.status !== 401) console.warn('me', e.message); attachGuest(); return false; }
  },

  forget() { this.sid = null; this.me = null; store.set('blame.sid', null); attachGuest(); },

  async logout() {
    try { await this.api('/api/auth/logout', { method: 'POST' }); } catch {}
    this.forget(); track('logout'); afterAuthChange();
  },

  async setAccount(acc) {
    if (!this.me) return;
    this.me.account_id = acc;
    try { await this.api('/api/me/account', { method: 'PUT', body: { account_id: acc } }); } catch (e) { toast('Не удалось сохранить аккаунт: ' + e.message); }
    afterAuthChange();
  },

  async setAutopush(on) {
    const j = await this.api('/api/me/autopush', { method: 'PUT', body: { on } }).catch(e => ({ ok: false, error: e.message }));
    if (j.ok && this.me) this.me.autopush = on;
    return j;
  },

  // Вход: открываем бота и ждём подтверждения.
  async login(reason = 'header') {
    track('login_start', { reason });
    let start;
    try { start = await this.api('/api/auth/start', { method: 'POST', body: {} }); }
    catch (e) { return toast('Вход сейчас недоступен: ' + e.message); }
    const tab = window.open(start.url, '_blank', 'noopener');
    modal(`<div class="pwHead"><span class="tgBadge">Telegram</span><h2>Подтверди вход в боте</h2>
      <p>Открылся @${esc(CONFIG.botUsername)}. Нажми там <b>«Войти на сайт»</b> — эта страница обновится сама.</p></div>
      <div class="loginWait"><span class="spin"></span><span id="loginState">Ждём подтверждения…</span></div>
      <div class="pwBtns"><a class="primary" href="${esc(start.url)}" target="_blank" rel="noopener">${tab ? 'Открыть бота ещё раз' : 'Открыть Telegram'}</a></div>
      <p class="hint">Бот попросит одно нажатие. Пароли и номер телефона не нужны.</p>`, 'login');
    const t0 = Date.now();
    while (document.getElementById('loginState') && Date.now() - t0 < 600000) {
      await new Promise(r => setTimeout(r, 2000));
      const j = await this.api('/api/auth/poll', { method: 'POST', body: { token: start.token } }).catch(() => ({ status: 'pending' }));
      if (j.status === 'ok') {
        store.set('blame.sid', j.session);
        const legacy = collectGuestData();
        await this.load();
        mergeGuestData(legacy);
        closeModal(); track('login_ok', { reason });
        toast(`Привет, ${this.me.name}! Теперь всё сохраняется.`);
        afterAuthChange();
        return true;
      }
      if (j.status === 'expired') { const el = document.getElementById('loginState'); if (el) el.textContent = 'Ссылка устарела — закрой окно и нажми «Войти» ещё раз.'; return false; }
    }
    return false;
  }
};
globalThis.Account = Account;

/* ---------- данные: сервер для вошедших, вкладка для гостей ---------- */
let saveTimer = null;
function attachRemote(data) {
  UD.remote = data;
  UD.onChange = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Account.api('/api/me/data', { method: 'PUT', body: { data: UD.remote } }).catch(e => toast('Не удалось сохранить: ' + e.message)), 800);
  };
}
function attachGuest() { UD.remote = null; UD.onChange = null; }

// Гостевые данные (вкладка + старые данные из localStorage) переносим в аккаунт при входе.
const GUEST_KEYS = ['history', 'party', 'ovr', 'me'];
function collectGuestData() {
  const out = {};
  for (const k of GUEST_KEYS) {
    let v = null;
    try { v = JSON.parse(sessionStorage.getItem('blame.' + k)); } catch {}
    if (v == null) v = store.get('blame.' + k, null); // данные из версии сайта до аккаунтов
    if (v != null) out[k] = v;
  }
  return out;
}
function mergeGuestData(g) {
  if (!Account.me) return;
  const r = UD.remote;
  if (g.history?.length) { const ids = new Set((r.history || []).map(x => x.id)); r.history = [...(r.history || []), ...g.history.filter(x => !ids.has(x.id))].sort((a, b) => b.ts - a.ts).slice(0, 30); }
  if (g.party?.length) { const ids = new Set((r.party || []).map(x => x.acc)); r.party = [...(r.party || []), ...g.party.filter(x => !ids.has(x.acc))].slice(0, CONFIG.partyPlus); }
  if (g.ovr) r.ovr = { ...g.ovr, ...(r.ovr || {}) };
  if (g.me && !Account.me.account_id) Account.setAccount(+g.me);
  UD.onChange?.();
  for (const k of GUEST_KEYS) { try { sessionStorage.removeItem('blame.' + k); localStorage.removeItem('blame.' + k); } catch {} }
}

/* ---------- шапка: кнопка входа и меню аккаунта ---------- */
function renderAuth() {
  const el = document.getElementById('authBox'); if (!el) return;
  if (!Account.me) { el.innerHTML = `<button class="ghost small tgBtn" data-act="login"><span class="ico">✈️</span><span class="lbl">Войти</span></button>`; return; }
  const n = Account.me.name || 'Игрок';
  el.innerHTML = `<button class="ghost small accBtn" data-act="accMenu" aria-haspopup="true"><span class="ava0">${esc(n[0].toUpperCase())}</span><span class="lbl">${esc(n)}</span>${Account.plus ? '<span class="plusDot" title="BLAME+"></span>' : ''}</button>`;
}
function accountMenu() {
  const me = Account.me; if (!me) return;
  const until = Account.plus ? new Date(Account.plusUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null;
  modal(`<div class="pwHead"><h2>${esc(me.name)}</h2><p>${me.username ? '@' + esc(me.username) + ' · ' : ''}вход через Telegram</p></div>
    <div class="accRows">
      <div class="accRow"><div><b>BLAME+</b><small>${until ? `активна до ${until}` : 'не подключена'}</small></div>${until ? '<span class="pill ok">Активна</span>' : '<button class="primary small" data-act="plus" data-reason="account">Подключить</button>'}</div>
      <div class="accRow"><div><b>Мой аккаунт Dota</b><small>${me.account_id ? `ID ${me.account_id}` : 'не указан — тогда на главной будет твой последний матч'}</small></div><button class="ghost small" data-act="pickMe">${me.account_id ? 'Сменить' : 'Указать'}</button></div>
      <div class="accRow"><div><b>Авто-разбор в Telegram</b><small>После каждой твоей игры бот присылает, кто слил</small></div>
        <label class="switch ${Account.plus ? '' : 'locked'}"><input type="checkbox" id="autoSw" ${me.autopush ? 'checked' : ''}><span></span></label></div>
    </div>
    <div class="pwBtns"><button class="ghost" data-act="logout">Выйти</button></div>`, 'acc');
  document.getElementById('autoSw').addEventListener('change', async e => {
    const on = e.target.checked;
    if (on && !Account.plus) { e.target.checked = false; return paywall('auto'); }
    if (on && !Account.me.account_id) { e.target.checked = false; toast('Сначала укажи свой аккаунт Dota'); return; }
    const r = await Account.setAutopush(on);
    if (!r.ok) { e.target.checked = !on; return toast(r.error); }
    track('autopush', { on: on ? 1 : 0 });
    toast(on ? 'Авто-разбор включён: бот напишет после следующей игры' : 'Авто-разбор выключен');
  });
}

/* ---------- главная: «Твой последний матч» для вошедших с указанным аккаунтом ---------- */
async function renderLastMatch() {
  const box = document.getElementById('lastMatch'); if (!box) return;
  const acc = ME.get();
  if (!acc) {
    box.innerHTML = Account.me ? `<div class="lmEmpty"><b>Укажи свой аккаунт Dota</b> — и здесь сразу будет разбор твоей последней игры.<button class="ghost small" data-act="pickMe">Указать</button></div>` : '';
    return;
  }
  box.innerHTML = `<div class="lm card"><div class="label">Твой последний матч</div><div class="status"><span class="spin"></span>Загружаем…</div></div>`;
  try {
    await loadConstants();
    const rm = await getJSON(`${API}/players/${acc}/recentMatches`);
    const x = rm[0]; if (!x) { box.innerHTML = ''; return; }
    const w = (x.player_slot < 128) === x.radiant_win;
    box.innerHTML = `<button class="lm card ${w ? 'w' : 'l'}" data-match="${x.match_id}">
      <div class="label">Твой последний матч · ${new Date(x.start_time * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>
      <div class="lmRow">${img(heroImg(x), 'hport sm')}<div><b class="${w ? 'g' : 'r'}">${w ? 'Победа' : 'Поражение'}</b><small>${esc(H(x).name)} · ${x.kills}/${x.deaths}/${x.assists} · ${mmss(x.duration)}</small></div>
      <span class="lmGo">${w ? T('Кто тащил?', 'Кого благодарить?') : T('Кто виноват?', 'Кто слил?')} →</span></div></button>`;
  } catch { box.innerHTML = ''; }
}

function afterAuthChange() {
  renderAuth(); updatePlusBtn(); updateMeBtn(); renderHistory(); renderLastMatch(); globalThis.rerenderView?.();
}

// Подписку могли оплатить в боте, пока страница открыта: обновляем статус при возвращении во вкладку.
let lastRefresh = 0;
window.addEventListener('focus', async () => {
  if (!Account.sid || Date.now() - lastRefresh < 15000) return;
  lastRefresh = Date.now();
  const was = Account.plus;
  if (await Account.load() && Account.plus !== was) { toast(Account.plus ? 'BLAME+ активирован! 🎉' : 'Подписка BLAME+ закончилась'); afterAuthChange(); }
});
