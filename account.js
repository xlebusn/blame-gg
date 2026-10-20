'use strict';
/* Аккаунт через Telegram-бота: вход, несколько своих аккаунтов Dota (BLAME+ до 5), авто-разбор по каждому. */

const Account = {
  me: null, sid: null, serverSkew: 0,
  get logged() { return !!this.me; },
  get plusUntil() { return this.me ? this.me.plus_until * 1000 : 0; },
  get plus() { return this.me ? this.me.plus_until * 1000 > Date.now() + this.serverSkew : false; },
  get accounts() { return this.me?.accounts || []; },
  get accountLimit() { return this.me?.account_limit || (this.plus ? CONFIG.accountsPlus : CONFIG.accountsFree); },

  async api(path, opt = {}) {
    if (!CONFIG.apiUrl) throw Error('Сервер не подключён');
    const r = await fetch(CONFIG.apiUrl + path, {
      ...opt, headers: { 'content-type': 'application/json', ...(this.sid ? { authorization: 'Bearer ' + this.sid } : {}) },
      body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && this.sid) this.forget();
    if (!r.ok) throw Object.assign(Error(j.error || 'Ошибка сервера'), { status: r.status, need_plus: j.need_plus, ...j });
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

  applyAccounts(accounts) {
    if (!this.me || !accounts) return;
    this.me.accounts = accounts;
    const primary = accounts.find(a => a.is_primary) || accounts[0] || null;
    this.me.account_id = primary?.account_id || null;
    this.me.autopush = !!(primary?.autopush);
  },

  // Добавить аккаунт (plus) или заменить единственный (free).
  async addAccount(acc, name) {
    if (!this.me) return { ok: false, error: 'Нужно войти' };
    const id = +acc;
    const list = this.accounts;
    const exists = list.some(a => +a.account_id === id);
    // Без подписки второй аккаунт = замена единственного (как раньше «Это я»).
    const replace = !this.plus && list.length >= 1 && !exists;
    try {
      const j = replace
        ? await this.api('/api/me/account', { method: 'PUT', body: { account_id: id, name: name || null } })
        : await this.api('/api/me/accounts', { method: 'POST', body: { account_id: id, name: name || null, primary: !this.me.account_id } });
      this.applyAccounts(j.accounts);
      afterAuthChange();
      return j;
    } catch (e) {
      return { ok: false, error: e.message, need_plus: e.need_plus || e.status === 403 };
    }
  },

  // Совместимость со старым ME.set / mergeGuestData.
  async setAccount(acc) { return this.addAccount(acc); },

  async removeAccount(acc) {
    try {
      const j = await this.api('/api/me/accounts/' + acc, { method: 'DELETE' });
      this.applyAccounts(j.accounts);
      afterAuthChange();
      return j;
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async setPrimary(acc) {
    try {
      const j = await this.api('/api/me/accounts/' + acc, { method: 'PUT', body: { primary: true } });
      this.applyAccounts(j.accounts);
      afterAuthChange();
      return j;
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async setAccountAutopush(acc, on) {
    try {
      const j = await this.api('/api/me/accounts/' + acc, { method: 'PUT', body: { autopush: !!on } });
      this.applyAccounts(j.accounts);
      return j;
    } catch (e) { return { ok: false, error: e.message, need_plus: e.status === 403 }; }
  },

  async setAutopush(on) {
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (!primary) return { ok: false, error: 'Сначала укажи свой аккаунт Dota' };
    return this.setAccountAutopush(primary.account_id, on);
  },

  async login(reason = 'header') {
    track('login_start', { reason });
    let start;
    try { start = await this.api('/api/auth/start', { method: 'POST', body: {} }); }
    catch (e) { return toast('Вход сейчас недоступен: ' + e.message); }
    const tab = window.open(start.url, '_blank', 'noopener');
    modal(`<div class="pwHead"><span class="tgBadge">Telegram</span><h2>Подтверди вход в боте</h2>
      <p>В @${esc(CONFIG.botUsername)} нажми <b>«Войти на сайт»</b> — страница обновится сама.</p></div>
      <ol class="loginSteps"><li${tab ? ' class="done"' : ''}>Открыть бота</li><li class="on">Подтвердить вход</li><li>Вернуться сюда</li></ol>
      <div class="loginWait"><span class="spin"></span><span id="loginState">${tab ? 'Ждём подтверждения…' : 'Браузер мог заблокировать окно — открой бота вручную'}</span></div>
      <div class="pwBtns"><a class="primary" href="${esc(start.url)}" target="_blank" rel="noopener">${tab ? 'Открыть бота ещё раз' : 'Открыть Telegram'}</a>
        <button class="ghost" data-act="closeModal">Отмена</button></div>
      <p class="hint">Одно нажатие в боте. Пароли и номер телефона не нужны.</p>`, 'login');
    const t0 = Date.now();
    while (document.getElementById('loginState') && Date.now() - t0 < 600000) {
      await new Promise(r => setTimeout(r, 2000));
      if (!document.getElementById('loginState')) return false;
      const j = await this.api('/api/auth/poll', { method: 'POST', body: { token: start.token } }).catch(() => ({ status: 'pending' }));
      if (j.status === 'ok') {
        store.set('blame.sid', j.session);
        const legacy = collectGuestData();
        await this.load();
        mergeGuestData(legacy);
        closeModal(); track('login_ok', { reason });
        toast(this.plus ? `Привет, ${this.me.name}! BLAME+ уже активен.` : `Привет, ${this.me.name}! История и пати теперь сохраняются.`);
        afterAuthChange();
        return true;
      }
      if (j.status === 'expired') {
        const el = document.getElementById('loginState');
        if (el) el.textContent = 'Ссылка устарела — закрой окно и нажми «Войти» ещё раз.';
        return false;
      }
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

const GUEST_KEYS = ['history', 'party', 'ovr', 'me'];
function collectGuestData() {
  const out = {};
  for (const k of GUEST_KEYS) {
    let v = null;
    try { v = JSON.parse(sessionStorage.getItem('blame.' + k)); } catch {}
    if (v == null) v = store.get('blame.' + k, null);
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
  if (g.me && !Account.me.account_id) Account.addAccount(+g.me);
  UD.onChange?.();
  for (const k of GUEST_KEYS) { try { sessionStorage.removeItem('blame.' + k); localStorage.removeItem('blame.' + k); } catch {} }
}

/* ---------- шапка и меню ---------- */
function renderAuth() {
  const el = document.getElementById('authBox'); if (!el) return;
  if (!Account.me) { el.innerHTML = `<button class="ghost small tgBtn" data-act="login"><span class="ico">✈️</span><span class="lbl">Войти</span></button>`; return; }
  const n = Account.me.name || 'Игрок';
  el.innerHTML = `<button class="ghost small accBtn" data-act="accMenu" aria-haspopup="true"><span class="ava0">${esc(n[0].toUpperCase())}</span><span class="lbl">${esc(n)}</span>${Account.plus ? '<span class="plusDot" title="BLAME+"></span>' : ''}</button>`;
}

function accountMenu() {
  const me = Account.me; if (!me) return;
  const until = Account.plus ? new Date(Account.plusUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null;
  const list = Account.accounts;
  const lim = Account.accountLimit;
  const rows = list.length
    ? list.map(a => {
        const label = esc(a.name || `ID ${a.account_id}`);
        return `<div class="accDota" data-acc-id="${a.account_id}">
          <div class="accDotaMain">
            <b>${label}${a.is_primary ? ' <span class="pill ok">основной</span>' : ''}</b>
            <small>ID ${a.account_id}</small>
          </div>
          <div class="accDotaActs">
            <label class="switch ${Account.plus ? '' : 'locked'}" title="${Account.plus ? 'Авто-разбор в Telegram' : 'Авто-разбор — в BLAME+'}">
              <input type="checkbox" data-acc-auto="${a.account_id}" ${a.autopush ? 'checked' : ''}><span></span>
            </label>
            ${a.is_primary ? '' : `<button class="ghost small" data-act="accPrimary" data-acc="${a.account_id}">Основной</button>`}
            <button class="ghost small" data-act="accRemove" data-acc="${a.account_id}" title="Удалить">×</button>
          </div>
        </div>`;
      }).join('')
    : `<div class="accEmpty">Пока нет своих аккаунтов Dota. Добавь основной — на главной будет последний матч.</div>`;

  modal(`<div class="pwHead"><h2>${esc(me.name)}</h2><p>${me.username ? '@' + esc(me.username) + ' · ' : ''}вход через Telegram</p></div>
    <div class="accRows">
      <div class="accRow"><div><b>BLAME+</b><small>${until ? `активна до ${until}` : 'досье, пати, до ' + CONFIG.accountsPlus + ' аккаунтов, авто-разбор'}</small></div>${until ? '<span class="pill ok">Активна</span>' : '<button class="primary small" data-act="plus" data-reason="account">Подключить</button>'}</div>
    </div>
    <div class="accDotaHead"><b>Мои аккаунты Dota</b><small>${list.length}/${lim}${Account.plus ? '' : ' · ещё до ' + CONFIG.accountsPlus + ' в BLAME+'}</small></div>
    <div class="accDotaList">${rows}</div>
    <div class="pwBtns">
      <button class="primary small" data-act="pickMe">${list.length ? 'Добавить аккаунт' : 'Указать аккаунт'}</button>
      <button class="ghost" data-act="logout">Выйти</button>
    </div>
    <p class="hint">🔔 — авто-разбор после каждой игры. У BLAME+ он включается сам, тумблер только чтобы выключить. «Основной» показывается на главной и в /last.</p>`, 'acc wide');

  document.querySelectorAll('[data-acc-auto]').forEach(inp => {
    inp.addEventListener('change', async e => {
      const on = e.target.checked, id = +e.target.dataset.accAuto;
      if (on && !Account.plus) { e.target.checked = false; return paywall('auto'); }
      const r = await Account.setAccountAutopush(id, on);
      if (!r.ok) { e.target.checked = !on; return toast(r.error); }
      track('autopush', { on: on ? 1 : 0, account_id: id });
      toast(on ? 'Авто-разбор включён для этого аккаунта' : 'Авто-разбор выключен');
    });
  });
}

/* ---------- главная: последний матч primary + переключатель ---------- */
async function renderLastMatch() {
  const box = document.getElementById('lastMatch'); if (!box) return;
  const list = ME.list();
  const acc = ME.get();
  if (!acc) {
    box.innerHTML = Account.me
      ? `<div class="lmEmpty"><b>Укажи свой аккаунт Dota</b> — здесь появится разбор последней игры, а с BLAME+ можно добавить до ${CONFIG.accountsPlus}: авто-разбор в Telegram включится сам.<button class="ghost small" data-act="pickMe">Указать</button></div>`
      : `<div class="lmEmpty"><b>Войди через Telegram</b> — сохраним историю, пати и подписку между устройствами.<button class="ghost small tgBtn" data-act="login" data-reason="home_cta">Войти</button></div>`;
    return;
  }
  const primary = list.find(a => +a.account_id === +acc) || list[0];
  const switcher = list.length > 1
    ? `<div class="lmSwitch">${list.map(a => `<button type="button" class="chipBtn ${+a.account_id === +acc ? 'hot' : ''}" data-act="accPrimary" data-acc="${a.account_id}">${esc(a.name || a.account_id)}${a.is_primary ? '' : ''}</button>`).join('')}</div>`
    : '';
  box.innerHTML = `<div class="lm card"><div class="label">Твой последний матч${primary?.name ? ' · ' + esc(primary.name) : ''}</div>${switcher}<div class="status"><span class="spin"></span>Загружаем…</div></div>`;
  try {
    await loadConstants();
    const rm = await getJSON(`${API}/players/${acc}/recentMatches`);
    const x = rm[0]; if (!x) { box.innerHTML = switcher ? `<div class="lm card"><div class="label">Твой последний матч</div>${switcher}<div class="empty">Матчей не видно — профиль скрыт?</div></div>` : ''; return; }
    const w = (x.player_slot < 128) === x.radiant_win;
    box.innerHTML = `${switcher}<button class="lm card ${w ? 'w' : 'l'}" data-match="${x.match_id}">
      <div class="label">Твой последний матч${primary?.name ? ' · ' + esc(primary.name) : ''} · ${new Date(x.start_time * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>
      <div class="lmRow">${img(heroImg(x), 'hport sm')}<div><b class="${w ? 'g' : 'r'}">${w ? 'Победа' : 'Поражение'}</b><small>${esc(H(x).name)} · ${x.kills}/${x.deaths}/${x.assists} · ${mmss(x.duration)}</small></div>
      <span class="lmGo">${w ? T('Кто тащил?', 'Кого благодарить?') : T('Кто виноват?', 'Кто слил?')} →</span></div></button>`;
  } catch { box.innerHTML = ''; }
}

function afterAuthChange() {
  renderAuth(); updatePlusBtn(); updateMeBtn(); renderHistory(); renderLastMatch(); globalThis.rerenderView?.();
}
globalThis.afterAuthChange = afterAuthChange;

let lastRefresh = 0;
window.addEventListener('focus', async () => {
  if (!Account.sid || Date.now() - lastRefresh < 15000) return;
  lastRefresh = Date.now();
  const was = Account.plus;
  if (await Account.load() && Account.plus !== was) { toast(Account.plus ? 'BLAME+ активирован!' : 'Подписка BLAME+ закончилась'); afterAuthChange(); }
});
