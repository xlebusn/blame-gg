'use strict';
/* BLAME+: личный код из Telegram-бота. Сервер (blame-gg-bot) проверяет код и привязывает его к одному браузеру:
   второй человек с тем же кодом получит «Код уже используется другим пользователем». */

const RECHECK_MS = 6 * 3600e3; // раз в 6 часов перепроверяем код на сервере
function deviceId() {
  let d = store.get('blame.device', null);
  if (!d) { d = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join(''); store.set('blame.device', d); }
  return d;
}
async function codeApi(path, code) {
  if (!CONFIG.apiUrl) return { ok: false, status: 0, error: 'Сервер BLAME+ ещё не подключён. Попробуй позже.' };
  try {
    const r = await fetch(CONFIG.apiUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, device: deviceId() }) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok, status: r.status, until: j.until, error: j.error || 'Сервер не ответил, попробуй ещё раз.' };
  } catch { return { ok: false, status: 0, error: 'Нет связи с сервером BLAME+. Проверь интернет.' }; }
}

const Premium = {
  state() { return store.get('blame.plus2', null); },
  get active() { const st = this.state(); return !!(st && st.until * 1000 > Date.now()); },
  get until() { const st = this.state(); return st ? st.until * 1000 : null; },
  async redeem(code) {
    const r = await codeApi('/api/redeem', code);
    if (!r.ok) { track('code_fail', { status: r.status }); return r; }
    store.set('blame.plus2', { code, until: r.until, checkedAt: Date.now() });
    track('code_success');
    return r;
  },
  // Фоновая перепроверка: код могли отозвать, отвязать или подписка закончилась.
  async recheck() {
    const st = this.state(); if (!st || Date.now() - (st.checkedAt || 0) < RECHECK_MS) return;
    const r = await codeApi('/api/check', st.code);
    if (r.ok) { store.set('blame.plus2', { ...st, until: r.until, checkedAt: Date.now() }); return updatePlusBtn(); }
    if ([404, 409, 410].includes(r.status)) { store.set('blame.plus2', null); updatePlusBtn(); toast('BLAME+ отключён: ' + r.error); rerenderView(); }
  }
};

/* ---------- аналитика (Яндекс Метрика) ---------- */
function track(goal, params) {
  try { if (CONFIG.metrikaId && window.ym) window.ym(CONFIG.metrikaId, 'reachGoal', goal, params); } catch {}
}
(function loadMetrika() {
  if (!CONFIG.metrikaId) return;
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  const sc = document.createElement('script'); sc.async = true; sc.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(sc);
  window.ym(CONFIG.metrikaId, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
})();

/* ---------- модалки и тосты ---------- */
function modal(html, cls = '') {
  closeModal();
  const el = document.createElement('div');
  el.className = 'modalWrap'; el.id = 'modal';
  el.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true"><button class="mclose" data-act="closeModal" aria-label="Закрыть">×</button>${html}</div>`;
  el.addEventListener('click', e => { if (e.target === el) closeModal(); });
  document.body.appendChild(el);
  setTimeout(() => el.querySelector('input,button.primary,a.primary')?.focus(), 30);
  return el;
}
function closeModal() { document.getElementById('modal')?.remove(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function toast(text, action) {
  document.getElementById('toast')?.remove();
  const el = document.createElement('div');
  el.id = 'toast'; el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>${action === 'plus' ? '<button class="linkbtn" data-act="plus" data-reason="toast">Подробнее</button>' : ''}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

const PAYWALL_REASON = {
  dossier: ['Полное досье — в BLAME+', 'Вся история руина, худшие герои, главная проблема и все 20 матчей.'],
  party: ['Кто главный руинер пати — в BLAME+', 'Рейтинг пати целиком и кто руинит в ваших общих играх.'],
  party_size: ['Больше друзей в пати — в BLAME+', `Бесплатно — до ${CONFIG.partyFree} человек, в BLAME+ — до ${CONFIG.partyPlus}.`],
  card: ['Карточка без плашки — в BLAME+', 'Чистая картинка, свой текст и стиль «Постер».'],
  header: ['BLAME+', 'Досье на любого игрока, рейтинг пати и чистые карточки.'],
  toast: ['BLAME+', 'Досье на любого игрока, рейтинг пати и чистые карточки.']
};
function paywall(reason = 'header') {
  track('paywall_view', { reason });
  if (Premium.active) {
    return modal(`<div class="pwHead"><span class="plusBadge">BLAME+</span><h2>Подписка активна</h2></div>
      <p class="vtext">Доступ до ${new Date(Premium.until).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}. Код привязан к этому браузеру. Перенести на другой: команда /reset в боте.</p>
      <div class="pwBtns"><a class="ghost" href="${esc(CONFIG.botUrl)}" target="_blank" rel="noopener">Открыть бота</a></div>`);
  }
  const [title, sub] = PAYWALL_REASON[reason] || PAYWALL_REASON.header;
  modal(`<div class="pwHead"><span class="plusBadge">BLAME+</span><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>
    <div class="pwCompare">
      <div><b>Бесплатно</b><ul><li>Разбор любого матча</li><li>«Как слили», дуэли, драки</li><li>Заголовок досье и 3 матча</li><li>Пати до ${CONFIG.partyFree} человек</li><li>Карточка с плашкой</li></ul></div>
      <div class="plus"><b>BLAME+</b><ul><li><b>Досье на любого игрока</b>: 20 игр, худшие герои, главная проблема</li><li><b>Рейтинг пати</b> и руинер общих игр</li><li>Пати до ${CONFIG.partyPlus} человек</li><li><b>Карточки без плашки</b>, свой текст, стиль «Постер»</li></ul></div>
    </div>
    <div class="pwBuy"><a class="primary" href="${esc(CONFIG.botUrl)}?start=plus" target="_blank" rel="noopener" data-act="boosty">Оформить в Telegram за ${esc(CONFIG.price)}</a><a class="ghost small" href="${esc(CONFIG.boostyUrl)}" target="_blank" rel="noopener" data-act="boostyAlt">или через Boosty</a></div>
    <form class="pwCode" id="codeForm"><input id="codeIn" placeholder="RUIN-XXXX-XXXX" autocomplete="off" aria-label="Личный код"><button class="ghost" type="submit">Активировать</button></form>
    <p class="hint" id="codeMsg">После оплаты бот пришлёт <b>личный код</b> (команда /code). Он работает только у тебя и привязывается к одному браузеру. Оплатил на Boosty — напиши боту /boosty.</p>`, 'pw');
  document.getElementById('codeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('codeMsg'), btn = e.submitter; if (btn) btn.disabled = true;
    const r = await Premium.redeem(document.getElementById('codeIn').value);
    if (btn) btn.disabled = false;
    if (!r.ok) { msg.textContent = r.error; msg.classList.add('err'); return; }
    closeModal(); updatePlusBtn(); toast('BLAME+ активирован. Добро пожаловать!'); rerenderView();
  });
}

function donate() {
  track('donate_click');
  window.open(CONFIG.donateUrl, '_blank', 'noopener');
}

function updatePlusBtn() {
  const b = document.getElementById('plusBtn'); if (!b) return;
  b.textContent = Premium.active ? 'BLAME+ ✓' : 'BLAME+';
  b.classList.toggle('on', Premium.active);
}

function autoRedeemFromUrl() {
  const qp = new URLSearchParams(location.search), code = qp.get('redeem'); if (!code) return;
  qp.delete('redeem'); history.replaceState(null, '', location.pathname + (qp.toString() ? '?' + qp : ''));
  paywall('header');
  const inp = document.getElementById('codeIn'), form = document.getElementById('codeForm');
  if (inp && form) { inp.value = code; form.requestSubmit(); }
}
