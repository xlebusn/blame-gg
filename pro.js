'use strict';
/* Досье игрока, рейтинг пати и карточки — функции BLAME+.
   Каждый матч разбирается один раз: в localStorage кладётся короткая сводка по 10 игрокам. */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SUM_KEY = id => 'blame.sum.' + id;
const SUM_VER = 1;

// Временно подменяем текущий матч, считаем, возвращаем всё как было.
function withMatch(m, fn) {
  const keep = {}; ['match', 'ps', 'override', 'arch', 'usedSays', 'lines', 'usedTpl', '_turn', '_fights', '_deaths'].forEach(k => { keep[k] = S[k]; });
  S.match = m; S.override = {};
  try { analyze(); return fn(); } finally { Object.assign(S, keep); }
}
function summarize() {
  const m = S.match, top = losers()[0];
  return {
    v: SUM_VER, id: m.match_id, t: m.start_time, dur: m.duration, parsed: isParsed(m),
    ps: S.ps.map(p => {
      const a = (!p.won && p === top) ? { t: ['Главный вклад в поражение', 'РУИНЕР'] } : (ARCH.find(x => x.test(p)) || fallbackOf(p));
      return { a: p.account_id || null, h: p.hero_id, n: pname(p), w: p.won ? 1 : 0, b: p.blame, f: p.final, pos: p.pos, r: (!p.won && p === top) ? 1 : 0,
        k: p.kills || 0, d: p.deaths || 0, as: p.assists || 0, at: a.t, wk: weakOf(p)[0] || null, team: p.team };
    })
  };
}
async function matchSummary(id) {
  const c = store.get(SUM_KEY(id), null);
  if (c && c.v === SUM_VER) return { sum: c, cached: true };
  const m = await getJSON(`${API}/matches/${id}`);
  if (!m.players?.length) throw Error('нет игроков');
  const sum = withMatch(m, summarize);
  store.set(SUM_KEY(id), sum);
  return { sum, cached: false };
}

/* ---------- досье ---------- */
async function buildDossier(acc, onProgress) {
  acc = +acc;
  const rm = await getJSON(`${API}/players/${acc}/recentMatches`);
  const ids = rm.slice(0, 20).map(x => x.match_id), games = [];
  for (let k = 0; k < ids.length; k++) {
    try {
      const { sum, cached } = await matchSummary(ids[k]);
      const me = sum.ps.find(x => x.a === acc);
      if (me) games.push({ s: sum, me });
      if (!cached) await sleep(300); // бережём лимит OpenDota (60 запросов в минуту)
    } catch (e) { if (/частоту/.test(e.message)) { await sleep(5000); k--; } }
    onProgress?.(k + 1, ids.length);
  }
  return dossierStats(games);
}
function dossierStats(games) {
  const n = games.length, wins = games.filter(g => g.me.w).length, losses = n - wins, ruins = games.filter(g => g.me.r).length;
  const avgB = Math.round(avg(games.map(g => g.me.b)));
  const heroes = {}, arch = {}, weak = {};
  games.forEach(({ me }) => {
    const h = heroes[me.h] ||= { h: me.h, n: 0, b: 0, w: 0, r: 0 }; h.n++; h.b += me.b; h.w += me.w; h.r += me.r;
    arch[me.at[1]] = (arch[me.at[1]] || 0) + 1;
    if (me.wk && !me.w) weak[me.wk] = (weak[me.wk] || 0) + 1;
  });
  const heroList = Object.values(heroes).map(h => ({ ...h, avg: Math.round(h.b / h.n) })).filter(h => h.n >= 2);
  // Худшие — выше своего среднего, лучшие — ниже; один герой не попадает в оба списка.
  const worstHeroes = heroList.filter(h => h.avg > avgB).sort((a, b) => b.avg - a.avg).slice(0, 3);
  return {
    games, n, wins, losses, ruins, avgB, ruinRate: losses ? ruins / losses : 0,
    worstHeroes,
    bestHeroes: heroList.filter(h => h.avg < avgB && !worstHeroes.includes(h)).sort((a, b) => a.avg - b.avg).slice(0, 2),
    arch: Object.entries(arch).sort((a, b) => b[1] - a[1]).slice(0, 4),
    weak: Object.entries(weak).sort((a, b) => b[1] - a[1])[0] || null
  };
}
function dossierVerdict(d) {
  if (d.n < 3) return { tone: 'neutral', t: T('Мало данных', 'МАЛО ИГР'), s: T('Недостаточно матчей для вывода.', 'Слишком мало игр, чтобы кого-то обвинять. Пока.') };
  if (d.ruinRate >= .4 && d.ruins >= 3) return { tone: 'bad', t: T('Часто главный виновник', 'ХРОНИЧЕСКИЙ РУИНЕР'),
    s: T(`В ${d.ruins} из ${d.losses} поражений — главный вклад в слив.`, `Руинил в ${d.ruins} из ${d.losses} поражений. Это уже не случайность, это почерк.`) };
  if (d.avgB <= 28 && d.ruinRate < .25) return { tone: 'good', t: T('Надёжный тиммейт', 'НАДЁЖНЫЙ ТИММЕЙТ'),
    s: T('Редко бывает причиной поражения.', 'С ним можно идти в пати. Если сливаете — то не из-за него.') };
  if (d.avgB >= 42) return { tone: 'bad', t: T('Нестабильная игра', 'ЛОУСКИЛЛ НА ПОТОКЕ'), s: T(`Средний индекс вины ${d.avgB} — выше нормы.`, `Средний индекс вины ${d.avgB}. Стабильно плохо — тоже стабильность.`) };
  return { tone: 'neutral', t: T('Обычный игрок', 'СЕРЕДНЯК'), s: T('Иногда тащит, иногда руинит.', 'То тащит, то руинит. Лотерея, а не тиммейт.') };
}

async function openDossier(acc, push = true) {
  acc = +acc; S.view = 'dossier'; S.dossierAcc = acc;
  if (push) history.replaceState(null, '', `?dossier=${acc}`);
  track('dossier_open', { plus: Premium.active ? 1 : 0 });
  const app = $('#app'); $('#hero').classList.add('compact'); app.classList.remove('hidden');
  app.innerHTML = `<section class="card"><div class="label">Досье руинера</div><div class="status"><span class="spin"></span><span id="dosProg">Ищем последние матчи…</span></div><div class="prog"><i id="dosBar"></i></div></section>`;
  app.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    await loadConstants();
    const pr = await getJSON(`${API}/players/${acc}`);
    const d = await buildDossier(acc, (k, n) => {
      const t = $('#dosProg'), b = $('#dosBar');
      if (t) t.textContent = `Разбираем матчи: ${k} из ${n}`; if (b) b.style.width = (k / n * 100) + '%';
    });
    if (S.view !== 'dossier' || S.dossierAcc !== acc) return;
    S.dossier = { acc, pr, d };
    renderDossier();
  } catch (e) { app.innerHTML = `<section class="card"><div class="empty">Не удалось собрать досье: ${esc(e.message)}. Возможно, профиль скрыт в настройках Dota 2.</div></section>`; }
}

function locked(inner, reason) {
  if (Premium.active) return inner;
  return `<div class="locked"><div class="lockInner" aria-hidden="true">${inner}</div><div class="lockCta"><span class="plusBadge">BLAME+</span><b>${esc(PAYWALL_REASON[reason][0])}</b><button class="primary small" data-act="plus" data-reason="${reason}">Открыть за ${esc(CONFIG.price)}</button></div></div>`;
}
const gameRow = g => {
  const p = { hero_id: g.me.h };
  return `<button class="mrow ${g.me.w ? 'w' : 'l'}" data-match="${g.s.id}">${img(heroIcon(p), 'hicon')}<span class="mres">${g.me.w ? 'Победа' : 'Поражение'}</span>
    <span class="mhero">${esc(H(p).name)}${g.me.r ? ' <span class="tag bad mini">РУИНЕР</span>' : ''}</span><span class="mkda">${g.me.k}/${g.me.d}/${g.me.as}</span><span class="mdur">индекс ${g.me.b}</span><span class="mago">${new Date(g.s.t * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span></button>`;
};
function renderDossier() {
  const { acc, pr, d } = S.dossier, prof = pr.profile || {}, v = dossierVerdict(d), app = $('#app');
  const inParty = partyList().some(x => x.acc === acc);
  const heroCell = h => `<div class="dh">${img(heroIcon({ hero_id: h.h }), 'hicon')}<span><b>${esc(H({ hero_id: h.h }).name)}</b><small>${h.n} игр · индекс ${h.avg}${h.r ? ` · руинер ${h.r}×` : ''}</small></span></div>`;
  const details = `
    <div class="dgrid">
      <div><h3 class="sub3">${T('Чаще всего', 'Кем бывает')}</h3>${d.arch.map(([t, c]) => `<div class="dline"><span class="tag ${/РУИНЕР|ФИДЕР|ЛОУ|НЕВИДИМКА|ПАССАЖИР|AFK|БУКСИР/.test(t) ? 'bad' : /ТАЩЕР|СВЯТОЙ|НЕУБИВАЕМЫЙ|ПУШЕР|ДАМАГЕР|КРАСАВЧИК|НЕ ВИНОВАТ/.test(t) ? 'good' : 'neutral'}">${esc(t)}</span><em>${c}×</em></div>`).join('') || '<div class="empty">—</div>'}</div>
      <div><h3 class="sub3">${T('Худшие герои', 'Герои, на которых руинит')}</h3>${d.worstHeroes.map(heroCell).join('') || '<div class="empty">Нужно 2+ игры на герое</div>'}
        ${d.bestHeroes.length ? `<h3 class="sub3 mt">${T('Лучшие герои', 'Тут хотя бы норм')}</h3>${d.bestHeroes.map(heroCell).join('')}` : ''}</div>
      <div><h3 class="sub3">${T('Главная проблема в поражениях', 'Чем сливает')}</h3>${d.weak ? `<div class="tip2"><div class="th"><i style="background:${FACTORS[d.weak[0]].color}"></i><b>${FACTORS[d.weak[0]].label}</b><em>${d.weak[1]} из ${d.losses} поражений</em></div><p>${TIPS[d.weak[0]]}</p></div>` : '<div class="empty">Явной повторяющейся проблемы нет</div>'}</div>
    </div>
    <h3 class="sub3 mt">Все матчи</h3><div class="mlist">${d.games.slice(3).map(gameRow).join('')}</div>`;
  app.innerHTML = `<section class="card dossier">
    <div class="profHead">${img(prof.avatarfull, 'ava big')}<div><div class="label">Досье руинера</div><b class="dname">${esc(prof.personaname || 'Игрок ' + acc)}</b><small>${rankName(pr.rank_tier) || 'без ранга'} · ID ${acc}</small></div>
      <div class="dbtns"><button class="ghost small" data-party-add="${acc}" data-name="${esc(prof.personaname || acc)}" ${inParty ? 'disabled' : ''}>${inParty ? 'В пати ✓' : '+ В пати'}</button><button class="ghost small" data-act="copyDossier">Ссылка</button></div></div>
    <div class="dverdict ${v.tone}"><span class="tag ${v.tone}">${esc(v.t)}</span><p>${esc(v.s)}</p></div>
    <div class="dstats">
      <div><b>${d.n}</b><small>игр разобрано</small></div>
      <div><b>${d.n ? Math.round(d.wins / d.n * 100) : 0}%</b><small>побед (${d.wins}/${d.n})</small></div>
      <div class="${d.ruinRate >= .4 ? 'bad' : ''}"><b>${d.ruins}</b><small>раз руинер из ${d.losses} поражений</small></div>
      <div><b>${d.avgB}</b><small>средний индекс вины</small></div>
    </div>
    <h3 class="sub3 mt">Последние матчи</h3><div class="mlist">${d.games.slice(0, 3).map(gameRow).join('') || '<div class="empty">Матчей нет</div>'}</div>
    ${locked(details, 'dossier')}
  </section>`;
}

/* ---------- пати ---------- */
const partyList = () => store.get('blame.party', []);
const partySet = l => store.set('blame.party', l);
function partyAdd(acc, name) {
  acc = +acc; const l = partyList();
  if (l.some(x => x.acc === acc)) return toast('Уже в пати');
  const max = Premium.active ? CONFIG.partyPlus : CONFIG.partyFree;
  if (l.length >= max) return Premium.active ? toast(`В пати максимум ${max} человек`) : paywall('party_size');
  l.push({ acc, name: String(name || acc) }); partySet(l); track('party_add');
  toast(`${name} в пати (${l.length}/${max})`);
  if (S.view === 'party') renderParty(); else if (S.view === 'dossier') renderDossier();
}
function partyRemove(acc) { partySet(partyList().filter(x => x.acc !== +acc)); S.partyRes = null; renderParty(); }

function openParty(push = true) {
  S.view = 'party'; if (push) history.replaceState(null, '', '?party=1');
  track('party_open');
  $('#hero').classList.add('compact'); $('#app').classList.remove('hidden');
  renderParty();
  $('#app').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderParty() {
  const l = partyList(), app = $('#app'), max = Premium.active ? CONFIG.partyPlus : CONFIG.partyFree;
  app.innerHTML = `<section class="card party">
    <div class="label">${T('Рейтинг пати', 'Кто руинит в нашей пати')}</div>
    <p class="vtext">${T('Добавь друзей, с которыми играешь, и посмотри, кто чаще всего становится главным виновником поражений.', 'Добавь друзей и узнай, кого выгонять из пати. Считаем по последним 20 играм каждого.')}</p>
    <div class="pmembers">${l.map(x => `<span class="pm"><button class="linkplain" data-dossier="${x.acc}">${esc(x.name)}</button><button class="mx" data-party-rm="${x.acc}" aria-label="Убрать">×</button></span>`).join('') || '<div class="empty">Пати пустая. Добавь друзей по нику или Steam ID, или кнопкой «+ пати» в таблице матча.</div>'}</div>
    <form class="search small" id="partyForm"><input id="partyQ" placeholder="Ник, Steam ID или ссылка на профиль" autocomplete="off"><button class="ghost" type="submit">Найти</button></form>
    <div id="partyPick"></div>
    <div class="pfoot"><small>${l.length}/${max} в пати${Premium.active ? '' : ` · в BLAME+ до ${CONFIG.partyPlus}`}</small>
      <button class="primary" data-act="partyRun" ${l.length < 2 ? 'disabled' : ''}>${T('Посчитать рейтинг', 'Найти руинера пати')}</button></div>
    <div id="partyRes">${S.partyRes ? partyResultHtml(S.partyRes) : ''}</div>
  </section>`;
  document.getElementById('partyForm').addEventListener('submit', async e => {
    e.preventDefault(); const q = document.getElementById('partyQ').value.trim(), box = document.getElementById('partyPick'); if (!q) return;
    box.innerHTML = '<div class="status"><span class="spin"></span>Ищем…</div>';
    try {
      const s64 = q.match(/(7656119\d{10})/), link = q.match(/(?:opendota|dotabuff|stratz)\.com\/players?\/(\d+)/);
      let list;
      if (s64 || link || /^\d{1,10}$/.test(q)) {
        const acc = s64 ? String(BigInt(s64[1]) - STEAM64) : link ? link[1] : q;
        const pr = await getJSON(`${API}/players/${acc}`);
        list = [{ account_id: +acc, personaname: pr.profile?.personaname || acc, avatarfull: pr.profile?.avatarfull }];
      } else list = (await getJSON(`${API}/search?q=${encodeURIComponent(q)}`)).slice(0, 8);
      box.innerHTML = list.length ? `<div class="plist">${list.map(u => `<button class="pcard" data-party-add="${u.account_id}" data-name="${esc(u.personaname)}">${img(u.avatarfull, 'ava')}<span><b>${esc(u.personaname)}</b><small>ID ${u.account_id} · добавить</small></span></button>`).join('')}</div>` : '<div class="empty">Никого не нашли</div>';
    } catch (err) { box.innerHTML = `<div class="empty">Ошибка: ${esc(err.message)}</div>`; }
  });
}

async function runParty() {
  const l = partyList(); if (l.length < 2) return;
  track('party_run', { n: l.length, plus: Premium.active ? 1 : 0 });
  const box = document.getElementById('partyRes'), res = [];
  for (let k = 0; k < l.length; k++) {
    box.innerHTML = `<div class="status"><span class="spin"></span>Собираем досье: ${esc(l[k].name)} (${k + 1} из ${l.length})…</div><div class="prog"><i style="width:${k / l.length * 100}%"></i></div>`;
    try { res.push({ m: l[k], d: await buildDossier(l[k].acc) }); } catch { res.push({ m: l[k], d: null }); }
    if (S.view !== 'party') return;
  }
  S.partyRes = partyAggregate(res);
  box.innerHTML = partyResultHtml(S.partyRes);
}
function partyAggregate(res) {
  const ok = res.filter(r => r.d && r.d.n);
  const rows = ok.map(r => ({ m: r.m, n: r.d.n, ruins: r.d.ruins, losses: r.d.losses, rate: r.d.ruinRate, avgB: r.d.avgB }))
    .sort((a, b) => b.rate - a.rate || b.avgB - a.avgB);
  // Общие игры: матч, где двое и больше из пати играли за одну команду.
  const accs = new Set(ok.map(r => r.m.acc)), seen = new Map();
  ok.forEach(r => r.d.games.forEach(g => seen.set(g.s.id, g.s)));
  let shared = 0, sharedLost = 0; const sharedRuin = {};
  seen.forEach(s => {
    const mine = s.ps.filter(p => accs.has(p.a)); if (mine.length < 2) return;
    const team = mine[0].team; if (!mine.every(p => p.team === team)) return;
    shared++;
    if (!mine[0].w) { sharedLost++; const worst = mine.slice().sort((a, b) => b.f - a.f)[0]; sharedRuin[worst.a] = (sharedRuin[worst.a] || 0) + 1; }
  });
  const sr = Object.entries(sharedRuin).sort((a, b) => b[1] - a[1])[0];
  return { rows, failed: res.filter(r => !r.d || !r.d.n).map(r => r.m.name), shared, sharedLost, sharedRuiner: sr ? { m: ok.find(r => r.m.acc === +sr[0]).m, c: sr[1] } : null };
}
function partyResultHtml(r) {
  if (!r.rows.length) return '<div class="empty">Не удалось собрать досье. Проверь, что профили открыты.</div>';
  const top = r.rows[0];
  const table = `<div class="prank">${r.rows.map((x, k) => `<div class="prow ${k === 0 ? 'top' : ''}"><span class="pnum">${k + 1}</span><button class="linkplain" data-dossier="${x.m.acc}"><b>${esc(x.m.name)}</b></button>
    <div class="pbar"><i style="width:${Math.round(x.rate * 100)}%"></i></div><span class="pval"><b>${x.ruins}/${x.losses}</b><small>руинер в поражениях</small></span><span class="pval"><b>${x.avgB}</b><small>индекс</small></span></div>`).join('')}</div>
    ${r.shared ? `<p class="note">Общих игр в пати: <b>${r.shared}</b>, из них проиграно ${r.sharedLost}.${r.sharedRuiner ? ` ${T('В общих поражениях чаще всех виноват', 'В общих сливах чаще всех руинил')} <b>${esc(r.sharedRuiner.m.name)}</b> (${r.sharedRuiner.c} раз).` : ''}</p>` : '<p class="hint">Общих игр в последних 20 матчах не нашлось.</p>'}`;
  const head = `<div class="pwinner"><small>${T('Чаще всех главный виновник', 'Главный руинер пати')}</small><b>${Premium.active ? esc(top.m.name) : '████████'}</b><span>${Premium.active ? T(`руинер в ${top.ruins} из ${top.losses} поражений`, `руинил в ${top.ruins} из ${top.losses} поражений. Пора поговорить.`) : 'Имя и весь рейтинг — в BLAME+'}</span></div>`;
  return head + locked(table, 'party') + (r.failed.length ? `<p class="hint">Не удалось собрать: ${esc(r.failed.join(', '))} (скрытый профиль?).</p>` : '');
}

/* ---------- карточка ---------- */
function openCardDialog() {
  if (!Premium.active) {
    exportPng({ watermark: true }); track('share_png', { plus: 0 });
    setTimeout(() => toast('Карточка без плашки и со своим текстом — в BLAME+', 'plus'), 700);
    return;
  }
  const top = losers()[0];
  modal(`<div class="pwHead"><span class="plusBadge">BLAME+</span><h2>Карточка для чата</h2></div>
    <label class="fl">Подпись<input id="cardCap" maxlength="80" value="${esc(TONE === 'toxic' ? archetype(top).say.slice(0, 80) : '')}"></label>
    <label class="fl">Стиль<select id="cardStyle"><option value="dark">Тёмный</option><option value="poster">Постер</option></select></label>
    <div class="pwBtns"><button class="primary" data-act="cardGo">Скачать PNG</button></div>`);
}

/* ---------- маршруты и события ---------- */
function rerenderView() {
  if (S.view === 'dossier' && S.dossier) renderDossier();
  else if (S.view === 'party') renderParty();
  else if (S.match) render();
}
document.addEventListener('click', e => {
  const b = e.target.closest('button,a'); if (!b) return;
  const ds = b.dataset;
  if (ds.dossier) { e.stopPropagation(); return openDossier(ds.dossier); }
  if (ds.partyAdd) { e.stopPropagation(); return partyAdd(ds.partyAdd, ds.name); }
  if (ds.partyRm) return partyRemove(ds.partyRm);
  switch (ds.act) {
    case 'plus': return paywall(ds.reason || 'header');
    case 'boosty': return track('paywall_boosty');
    case 'closeModal': return closeModal();
    case 'partyRun': return runParty();
    case 'donate': e.preventDefault(); return donate();
    case 'copyDossier': return copy(location.href, b);
    case 'cardGo': {
      exportPng({ caption: document.getElementById('cardCap').value, style: document.getElementById('cardStyle').value });
      track('share_png', { plus: 1 }); return closeModal();
    }
  }
}, true);

document.getElementById('plusBtn')?.addEventListener('click', () => paywall('header'));
document.getElementById('partyBtn')?.addEventListener('click', () => openParty());
updatePlusBtn();
{
  const qp = new URLSearchParams(location.search);
  if (qp.get('dossier')) openDossier(qp.get('dossier'), false);
  else if (qp.get('party')) openParty(false);
}
