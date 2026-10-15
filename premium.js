'use strict';
/* BLAME+: подписка привязана к Telegram-аккаунту. Купить — в боте (Stars) или на Boosty, доступ — после входа на сайте. */

const Premium = {
  get active() { return !!globalThis.Account?.plus; },
  get until() { return globalThis.Account?.plusUntil || null; }
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
  document.body.classList.add('modalOpen');
  setTimeout(() => el.querySelector('input,button.primary,a.primary')?.focus(), 30);
  return el;
}
function closeModal() {
  document.getElementById('modal')?.remove();
  document.body.classList.remove('modalOpen');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function toast(text, action) {
  document.getElementById('toast')?.remove();
  const el = document.createElement('div');
  el.id = 'toast'; el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>${action === 'plus' ? '<button class="linkbtn" data-act="plus" data-reason="toast">Подробнее</button>' : action === 'login' ? '<button class="linkbtn" data-act="login">Войти</button>' : ''}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

const PLUS_FEATURES = [
  ['🎮', `До ${CONFIG.accountsPlus} своих аккаунтов`, 'смок, твинк, паб — стату и авто-разбор по каждому'],
  ['🔔', 'Авто-разбор каждой игры', 'бот сам присылает в Telegram, кто слил'],
  ['📁', 'Досье на любого игрока', '20 игр, сколько раз руинер, худшие герои, главная проблема'],
  ['👥', 'Рейтинг пати', 'кто из друзей чаще руинит, руинер ваших общих игр'],
  ['🖼', 'Чистые карточки', 'без плашки, со своей подписью и стилем «Постер»']
];
const PAYWALL_REASON = {
  dossier: 'Полное досье — в BLAME+',
  party: 'Кто главный руинер пати — в BLAME+',
  party_size: `Больше ${CONFIG.partyFree} друзей в пати — в BLAME+`,
  card: 'Карточка без плашки — в BLAME+',
  auto: 'Авто-разбор каждой игры — в BLAME+',
  accounts: `Несколько своих аккаунтов (до ${CONFIG.accountsPlus}) — в BLAME+`
};
function paywall(reason = 'header') {
  track('paywall_view', { reason, logged: Account.logged ? 1 : 0 });
  if (Premium.active) {
    return modal(`<div class="pwHead"><span class="plusBadge">BLAME+</span><h2>Подписка активна</h2>
      <p>До ${new Date(Premium.until).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · привязана к твоему Telegram.</p></div>
      <div class="pwList">${PLUS_FEATURES.map(([i, t, d]) => `<div><span>${i}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
      <div class="pwBtns"><button class="ghost" data-act="accMenu">Настройки и авто-разбор</button></div>`, 'pw');
  }
  const title = PAYWALL_REASON[reason] || 'BLAME+ — всё про руинеров';
  const buy = Account.logged
    ? `<div class="pwBuy"><a class="primary" href="${esc(CONFIG.botUrl)}?start=plus" target="_blank" rel="noopener" data-act="buyStars">⭐ Telegram · ${esc(CONFIG.price)}</a>
        <a class="ghost" href="${esc(CONFIG.boostyUrl)}" target="_blank" rel="noopener" data-act="buyBoosty">Boosty · ${esc(CONFIG.priceBoosty)}</a></div>
       <p class="hint">Stars включаются сами. Boosty: после оплаты напиши боту <code>/boosty твой_ник</code>. <button class="linkbtn" data-act="refreshPlus" id="refreshPlusBtn">Проверить оплату</button></p>`
    : `<div class="pwBuy"><button class="primary" data-act="loginPlus" data-reason="${esc(reason)}">Войти через Telegram</button>
        <a class="ghost" href="${esc(CONFIG.boostyUrl)}" target="_blank" rel="noopener" data-act="buyBoosty">Сначала Boosty · ${esc(CONFIG.priceBoosty)}</a></div>
       <p class="hint">Подписка привязана к Telegram: войди одним нажатием в боте — без паролей и кодов.</p>`;
  modal(`<div class="pwHead"><span class="plusBadge">BLAME+</span><h2>${esc(title)}</h2><p>${esc(CONFIG.price)} в Telegram или ${esc(CONFIG.priceBoosty)} на Boosty. Отмена в любой момент.</p></div>
    <div class="pwList">${PLUS_FEATURES.map(([i, t, d]) => `<div><span>${i}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
    ${buy}`, 'pw');
}

function donate() {
  track('donate_click');
  modal(`<div class="pwHead"><span class="heart">❤</span><h2>Поддержать BLAME.GG</h2>
    <p>Сайт и бот бесплатные. Если разборы зашли — закинь на развитие: сервера, новые фичи и прожарки.</p></div>
    <div class="pwBuy"><a class="primary" href="${esc(CONFIG.donateUrl)}" target="_blank" rel="noopener" data-act="donateGo">Перевести через Альфа-Банк</a>
    <a class="ghost" href="${esc(CONFIG.boostyUrl)}" target="_blank" rel="noopener">Или подписаться на Boosty</a></div>
    <p class="hint">Любая сумма. Спасибо, ты не руинер ❤</p>`, 'pw');
}

function updatePlusBtn() {
  const b = document.getElementById('plusBtn'); if (!b) return;
  b.textContent = Premium.active ? 'BLAME+ ✓' : 'BLAME+';
  b.classList.toggle('on', Premium.active);
}

// Старые ссылки ?redeem= из бота: коды больше не нужны.
function autoRedeemFromUrl() {
  const qp = new URLSearchParams(location.search); if (!qp.get('redeem')) return;
  qp.delete('redeem'); history.replaceState(null, '', location.pathname + (qp.toString() ? '?' + qp : ''));
  if (Account.logged) toast(Premium.active ? 'Ты уже вошёл — BLAME+ активен.' : 'Код больше не нужен. Оформи подписку в боте — она привяжется к твоему Telegram.', Premium.active ? undefined : 'plus');
  else toast('Коды больше не нужны. Войди через Telegram — подписка откроется сама.', 'login');
}
