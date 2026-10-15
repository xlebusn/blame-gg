'use strict';
/* BLAME+: доступ по коду месяца из закрытого поста на Boosty.
   В коде сайта лежат только SHA-256-хэши кодов. Новый код: node tools/gen-code.js 2026-11 */

// tools/gen-code.js дописывает сюда строки. Формат: { hash, until: 'YYYY-MM-DD' }.
const PREMIUM_CODES = [
  // codes:start
  { hash: '0d8f7d7e863b46be19686ded6a1be39f5eb091a300a2574b93be05bee0c7e068', until: '2026-10-31' },
  { hash: 'c579043e525b8a97ee7f266f2c221761b600f9ce6469df5d43b2ca7a3a61b257', until: '2026-11-30' },
  // codes:end
];
const GRACE_DAYS = 3; // код прошлого месяца работает ещё 3 дня, пока подписчик заберёт новый

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('blame.gg:' + s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const endOf = until => new Date(until + 'T23:59:59').getTime() + GRACE_DAYS * 864e5;

const Premium = {
  state() { return store.get('blame.plus', null); },
  get active() { const st = this.state(); return !!(st && endOf(st.until) > Date.now()); },
  get until() { return this.state()?.until; },
  async redeem(code) {
    const h = await sha256(normCode(code));
    const hit = PREMIUM_CODES.find(c => c.hash === h && endOf(c.until) > Date.now());
    if (!hit) { track('code_fail'); return false; }
    store.set('blame.plus', { until: hit.until, at: Date.now() });
    track('code_success');
    return true;
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
      <p class="vtext">Доступ до ${new Date(Premium.until).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}. Новый код появится в закрытом посте на Boosty в начале месяца.</p>
      <div class="pwBtns"><a class="ghost" href="${esc(CONFIG.boostyUrl)}" target="_blank" rel="noopener">Открыть Boosty</a></div>`);
  }
  const [title, sub] = PAYWALL_REASON[reason] || PAYWALL_REASON.header;
  modal(`<div class="pwHead"><span class="plusBadge">BLAME+</span><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>
    <div class="pwCompare">
      <div><b>Бесплатно</b><ul><li>Разбор любого матча</li><li>«Как слили», дуэли, драки</li><li>Заголовок досье и 3 матча</li><li>Пати до ${CONFIG.partyFree} человек</li><li>Карточка с плашкой</li></ul></div>
      <div class="plus"><b>BLAME+</b><ul><li><b>Досье на любого игрока</b>: 20 игр, худшие герои, главная проблема</li><li><b>Рейтинг пати</b> и руинер общих игр</li><li>Пати до ${CONFIG.partyPlus} человек</li><li><b>Карточки без плашки</b>, свой текст, стиль «Постер»</li></ul></div>
    </div>
    <div class="pwBuy"><a class="primary" href="${esc(CONFIG.boostyUrl)}" target="_blank" rel="noopener" data-act="boosty">Оформить за ${esc(CONFIG.price)}</a><small>или ${esc(CONFIG.priceYear)}</small></div>
    <form class="pwCode" id="codeForm"><input id="codeIn" placeholder="Код из поста на Boosty" autocomplete="off" aria-label="Код доступа"><button class="ghost" type="submit">Активировать</button></form>
    <p class="hint" id="codeMsg">Код лежит в закрытом посте для подписчиков на Boosty, каждый месяц новый. Вводится один раз, доступ сохранится в этом браузере.</p>`, 'pw');
  document.getElementById('codeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('codeMsg'), ok = await Premium.redeem(document.getElementById('codeIn').value);
    if (!ok) { msg.textContent = 'Код не подошёл или устарел. Проверь пост этого месяца на Boosty.'; msg.classList.add('err'); return; }
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
