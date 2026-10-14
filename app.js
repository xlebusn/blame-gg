'use strict';
const API = 'https://api.opendota.com/api';
const CDN = 'https://cdn.cloudflare.steamstatic.com';
const STEAM64 = 76561197960265728n;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const fmt = n => Math.round(n || 0).toLocaleString('ru-RU');
const kfmt = n => Math.abs(n) >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(Math.round(n));
const mmss = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const avg = a => { a = a.filter(x => x != null && !isNaN(x)); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const S = { mode: 'match', heroes: {}, items: {}, itemIds: {}, match: null, ps: [], override: {}, tab: 'verdict', meSlot: null, parse: '' };

/* ---------- данные ---------- */
async function getJSON(url, opt) {
  const r = await fetch(url, opt);
  if (r.status === 429) throw Error('OpenDota ограничил частоту запросов, подожди минуту');
  if (!r.ok) throw Error(r.status === 404 ? 'не найдено' : 'OpenDota ответил ' + r.status);
  return r.json();
}

async function loadConstants() {
  if (Object.keys(S.heroes).length) return;
  const c = store.get('blame.const', null);
  if (c && Date.now() - c.ts < 3 * 864e5) { Object.assign(S, { heroes: c.heroes, itemIds: c.itemIds, items: c.items }); return; }
  const [heroes, itemIds, items] = await Promise.all([
    getJSON(API + '/constants/heroes'), getJSON(API + '/constants/item_ids'), getJSON(API + '/constants/items')
  ]);
  const hs = {}, is = {};
  for (const [k, v] of Object.entries(heroes)) hs[k] = { name: v.localized_name, img: v.img, icon: v.icon, roles: v.roles || [] };
  for (const [k, v] of Object.entries(items)) is[k] = { dname: v.dname, img: v.img };
  Object.assign(S, { heroes: hs, itemIds, items: is });
  store.set('blame.const', { ts: Date.now(), heroes: hs, itemIds, items: is });
}

const H = p => S.heroes[p.hero_id] || { name: 'Герой #' + p.hero_id, roles: [] };
const heroImg = p => H(p).img ? CDN + H(p).img : '';
const heroIcon = heroImg; // квадратные иконки 32px плохо смотрятся в 16:9, берём портрет
const itemOf = id => { const n = S.itemIds[id]; return n ? S.items[n] : null; };
const pname = p => p.personaname || p.name || 'Аноним';
const img = (src, cls = '', alt = '') => `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">`;
const POS = { 1: 'Керри', 2: 'Мид', 3: 'Оффлейн', 4: 'Четвёрка', 5: 'Пятёрка' };
const posLabel = n => `Pos ${n} · ${POS[n]}`;
const teamName = (m, t) => t === 'radiant' ? (m.radiant_name || 'Свет') : (m.dire_name || 'Тьма');
function rankName(t) { const n = +t || 0, m = Math.floor(n / 10), s = n % 10; const nm = { 1: 'Herald', 2: 'Guardian', 3: 'Crusader', 4: 'Archon', 5: 'Legend', 6: 'Ancient', 7: 'Divine', 8: 'Immortal' }[m]; return nm ? (s && m < 8 ? `${nm} ${s}` : nm) : ''; }

/* ---------- роли ---------- */
function inferRoles(team) {
  const res = new Map(), farm = p => (p.last_hits || 0) + (p.denies || 0) * .3 + (p.net_worth || 0) / 250;
  const set = (p, pos, src) => { if (p && !res.has(p.i) && ![...res.values()].some(r => r.pos === pos)) res.set(p.i, { pos, src }); };
  const hasLane = team.filter(p => p.lane_role).length >= 4;
  if (hasLane) {
    const lane = l => team.filter(p => p.lane_role === l).sort((a, b) => farm(b) - farm(a));
    const mid = lane(2), safe = lane(1), off = lane(3);
    set(mid[0], 2, 'линия');
    set(safe[0], 1, 'линия'); set(safe[1], 5, 'линия');
    set(off[0], 3, 'линия'); set(off[1], 4, 'линия');
  }
  const rest = team.filter(p => !res.has(p.i)).sort((a, b) => farm(b) - farm(a));
  if (rest.length === 5) {
    // Нет данных о линиях: три самых фармящих героя — коры, двое — саппорты.
    const cores = rest.slice(0, 3), sups = rest.slice(3);
    const carryBias = p => farm(p) * (H(p).roles.includes('Carry') ? 1.15 : 1) * (H(p).roles.includes('Support') ? .85 : 1);
    const carry = cores.slice().sort((a, b) => carryBias(b) - carryBias(a))[0];
    const others = cores.filter(p => p !== carry).sort((a, b) => (b.xp_per_min || 0) - (a.xp_per_min || 0));
    set(carry, 1, 'эвристика'); set(others[0], 2, 'эвристика'); set(others[1], 3, 'эвристика');
    set(sups[0], 4, 'эвристика'); set(sups[1], 5, 'эвристика');
  } else {
    const free = [1, 2, 3, 4, 5].filter(x => ![...res.values()].some(r => r.pos === x));
    rest.forEach((p, k) => set(p, free[k] || 5, 'эвристика'));
  }
  team.forEach(p => { if (!res.has(p.i)) res.set(p.i, { pos: 5, src: 'эвристика' }); });
  return res;
}

/* ---------- модель ---------- */
const METRICS = {
  gpm: ['gold_per_min', p => p.gold_per_min || 0],
  lh: ['last_hits_per_min', (p, d) => (p.last_hits || 0) / d],
  xpm: ['xp_per_min', p => p.xp_per_min || 0],
  hd: ['hero_damage_per_min', (p, d) => (p.hero_damage || 0) / d],
  dth: ['deaths_per_min', (p, d) => -(p.deaths || 0) / d],
  td: ['tower_damage', p => p.tower_damage || 0],
  heal: ['hero_healing_per_min', (p, d) => (p.hero_healing || 0) / d],
  ast: ['assists_per_min', (p, d) => (p.assists || 0) / d]
};
const FACTORS = {
  farm: { label: 'Фарм', color: 'var(--f-farm)' },
  xp: { label: 'Опыт', color: 'var(--f-xp)' },
  fight: { label: 'Драки', color: 'var(--f-fight)' },
  deaths: { label: 'Смерти', color: 'var(--f-deaths)' },
  obj: { label: 'Строения', color: 'var(--f-obj)' },
  util: { label: 'Помощь команде', color: 'var(--f-util)' }
};
// Сколько каждый фактор весит для позиции: саппорта не судим за фарм, керри — за вижен.
const WEIGHTS = {
  1: { farm: .30, xp: .10, fight: .20, deaths: .20, obj: .15, util: .05 },
  2: { farm: .22, xp: .15, fight: .25, deaths: .20, obj: .13, util: .05 },
  3: { farm: .14, xp: .14, fight: .26, deaths: .20, obj: .14, util: .12 },
  4: { farm: .05, xp: .10, fight: .30, deaths: .25, obj: .05, util: .25 },
  5: { farm: 0, xp: .08, fight: .28, deaths: .26, obj: .04, util: .34 }
};
const TIPS = {
  farm: 'Между драками будь там, где волна: каждые 30–40 секунд без крипов — минус предмет к 20-й минуте. Цель на следующую игру — +1 добивание в минуту.',
  xp: 'Не стой на базе и не ходи пустым: ротации через лагеря и линии, а после смерти сразу на ближайшую волну.',
  fight: 'Заходи в драку с полным набором (байбек, BKB/сейв), бей главную цель, а не того, кто ближе. Если бой не берётся, не вкладывай в него ресурсы.',
  deaths: 'Перед каждым выходом в тёмную зону посчитай врагов на миникарте. Нет трёх-четырёх — фармишь ближе к своим. Сейв-предмет покупай раньше.',
  obj: 'Выиграл драку — сразу ломай строение или иди на Рошана. Убийства без давления на карту не приносят победу.',
  util: 'Обсы перед тайм-окнами (Рошан, ночь, пуш), сейв-предметы и лечение команды в драке. Помощь — это 30% твоей оценки на этой позиции.'
};

function pct(p, k, all, d) {
  const [bk, get] = METRICS[k];
  const b = p.benchmarks?.[bk];
  if (b && typeof b.pct === 'number' && isFinite(b.pct)) return { v: b.pct, src: 'hero' };
  const v = get(p, d), vals = all.map(x => get(x, d));
  const below = vals.filter(x => x < v).length, eq = vals.filter(x => x === v).length - 1;
  return { v: (below + eq / 2) / Math.max(1, vals.length - 1), src: 'match' };
}

function score(p, all, d) {
  const P = {}; for (const k in METRICS) P[k] = pct(p, k, all, d);
  const kpq = clamp(p.kp / 72);
  const wards = p.obs_placed != null ? clamp(((p.obs_placed || 0) + (p.sen_placed || 0) * .5) / Math.max(1, d / 4)) : null;
  const q = {
    farm: avg([P.gpm.v, P.lh.v]), xp: P.xpm.v, fight: .6 * P.hd.v + .4 * kpq,
    deaths: P.dth.v, obj: P.td.v, util: avg([P.heal.v, P.ast.v, kpq, wards])
  };
  const w = WEIGHTS[p.pos], parts = {}; let s = 0;
  for (const k in w) { parts[k] = 100 * w[k] * (1 - q[k]); s += parts[k]; }
  Object.assign(p, { q, P, parts, blame: Math.round(s), benchSrc: P.gpm.src });
}

function analyze() {
  const m = S.match, d = Math.max(1, (m.duration || 60) / 60);
  const ps = m.players.map((p, i) => ({ ...p, i, team: p.player_slot < 128 ? 'radiant' : 'dire' }));
  ps.forEach(p => { p.won = (p.team === 'radiant') === !!m.radiant_win; });
  for (const t of ['radiant', 'dire']) {
    const team = ps.filter(p => p.team === t), roles = inferRoles(team);
    const tk = team.reduce((a, p) => a + (p.kills || 0), 0) || 1, td = team.reduce((a, p) => a + (p.hero_damage || 0), 0) || 1;
    team.forEach(p => {
      const r = roles.get(p.i);
      Object.assign(p, { autoPos: r.pos, posSrc: r.src, pos: +S.override[p.i] || r.pos, kp: 100 * ((p.kills || 0) + (p.assists || 0)) / tk, dmgShare: 100 * (p.hero_damage || 0) / td });
    });
  }
  ps.forEach(p => score(p, ps, d));
  S.ps = ps;
}

const losers = () => S.ps.filter(p => !p.won).sort((a, b) => b.blame - a.blame);
const winners = () => S.ps.filter(p => p.won).sort((a, b) => a.blame - b.blame);
const isParsed = m => !!(m.od_data?.has_parsed || m.radiant_gold_adv?.length);

function confidence(top, second) {
  const gap = second ? top.blame - second.blame : 20;
  return Math.round(clamp(40 + Math.min(25, gap * 1.6) + (top.benchSrc === 'hero' ? 12 : 0) + (isParsed(S.match) ? 10 : 0) + (top.posSrc === 'линия' || S.override[top.i] ? 6 : 0), 30, 95));
}

function factorInfo(p, k) {
  const d = Math.max(1, (S.match.duration || 60) / 60);
  const src = p.benchSrc === 'hero' ? `игр на ${H(p).name}` : 'игроков этого матча';
  const worse = x => `хуже, чем в ${Math.round((1 - x) * 100)}% ${src}`;
  const better = x => `лучше, чем в ${Math.round(x * 100)}% ${src}`;
  const cmp = (x, comp) => comp ? `оценка ${Math.round(x * 100)}/100` : (x < .5 ? worse(x) : better(x));
  const q = p.q[k];
  return {
    farm: `${fmt(p.gold_per_min)} GPM и ${fmt(p.last_hits)} добиваний: ${cmp(q)}`,
    xp: `${fmt(p.xp_per_min)} XPM, ${p.level || '?'} уровень: ${cmp(q)}`,
    fight: `${fmt(p.hero_damage)} урона (${p.dmgShare.toFixed(0)}% команды), участие в убийствах ${p.kp.toFixed(0)}%: ${cmp(q, 1)}`,
    deaths: `${p.deaths || 0} смертей (${((p.deaths || 0) / d).toFixed(2)} в минуту): ${cmp(q)}`,
    obj: `${fmt(p.tower_damage)} урона по строениям: ${cmp(q)}`,
    util: `${fmt(p.hero_healing)} лечения, ${p.assists || 0} ассистов${p.obs_placed != null ? `, ${p.obs_placed} обсов` : ''}: ${cmp(q, 1)}`
  }[k];
}
const weakOf = p => Object.keys(p.parts).filter(k => WEIGHTS[p.pos][k] >= .08 && p.q[k] < .5).sort((a, b) => p.parts[b] - p.parts[a]);
const strongOf = p => Object.keys(p.q).filter(k => WEIGHTS[p.pos][k] >= .1 && p.q[k] >= .7).sort((a, b) => p.q[b] - p.q[a]);

/* ---------- поиск ---------- */
function setStatus(t, busy) { const el = $('#status'); el.innerHTML = t ? `${busy ? '<span class="spin"></span>' : ''}${esc(t)}` : ''; }

function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('#q').placeholder = mode === 'match' ? 'Match ID или ссылка на матч' : 'Ник, Steam ID или ссылка на профиль';
}

async function onSearch(q) {
  q = q.trim(); if (!q) return;
  $('#picker').innerHTML = '';
  if (S.mode === 'match') {
    const id = (q.match(/(\d{6,})/) || [])[1];
    if (!id) return setStatus('Не вижу Match ID: нужны цифры, например 9044981443');
    return loadMatch(id);
  }
  try {
    let acc = null;
    const s64 = q.match(/(7656119\d{10})/), link = q.match(/(?:opendota|dotabuff|stratz)\.com\/players?\/(\d+)/);
    if (s64) acc = String(BigInt(s64[1]) - STEAM64);
    else if (link) acc = link[1];
    else if (/^\d{1,10}$/.test(q)) acc = q;
    if (acc) return showPlayer(acc);
    setStatus('Ищем игроков…', true);
    const list = await getJSON(`${API}/search?q=${encodeURIComponent(q)}`);
    setStatus(list.length ? 'Выбери профиль' : 'Никого не нашли. Попробуй Steam ID или ссылку на профиль');
    $('#picker').innerHTML = `<div class="plist">${list.slice(0, 12).map(u => `<button class="pcard" data-acc="${u.account_id}">${img(u.avatarfull, 'ava')}<span><b>${esc(u.personaname)}</b><small>ID ${u.account_id}${u.last_match_time ? ' · играл ' + new Date(u.last_match_time).toLocaleDateString('ru-RU') : ''}</small></span></button>`).join('')}</div>`;
  } catch (e) { setStatus('Ошибка: ' + e.message); }
}

async function showPlayer(acc) {
  setStatus('Загружаем последние матчи…', true);
  try {
    await loadConstants();
    const [pr, rm] = await Promise.all([getJSON(`${API}/players/${acc}`), getJSON(`${API}/players/${acc}/recentMatches`)]);
    const prof = pr.profile || {};
    const wins = rm.filter(x => (x.player_slot < 128) === x.radiant_win).length;
    setStatus('');
    $('#picker').innerHTML = `<div class="card profile">
      <div class="profHead">${img(prof.avatarfull, 'ava big')}<div><b>${esc(prof.personaname || 'Профиль скрыт')}</b><small>${rankName(pr.rank_tier) || 'без ранга'} · последние ${rm.length}: ${wins}W / ${rm.length - wins}L</small></div>
      <button class="ghost small" data-act="saveMe" data-acc="${acc}">Это я</button></div>
      <div class="mlist">${rm.map(x => { const w = (x.player_slot < 128) === x.radiant_win; return `<button class="mrow ${w ? 'w' : 'l'}" data-match="${x.match_id}" data-acc="${acc}">
        ${img(heroIcon(x), 'hicon')}<span class="mres">${w ? 'Победа' : 'Поражение'}</span><span class="mhero">${esc(H(x).name)}</span>
        <span class="mkda">${x.kills}/${x.deaths}/${x.assists}</span><span class="mdur">${mmss(x.duration)}</span><span class="mago">${new Date(x.start_time * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span></button>`; }).join('') || '<div class="empty">Матчей не найдено. Возможно, профиль скрыт в настройках Dota 2.</div>'}</div></div>`;
  } catch (e) { setStatus('Ошибка: ' + e.message); }
}

async function loadMatch(id, me) {
  setStatus('Загружаем матч, героев и предметы…', true);
  try {
    await loadConstants();
    const m = await getJSON(`${API}/matches/${id}`);
    if (!m.players?.length) throw Error('в матче нет данных игроков');
    if (me) store.set('blame.me', +me);
    S.match = m; S.override = store.get('blame.ovr.' + id, {}); S.tab = 'verdict'; S.parse = '';
    analyze();
    const myId = store.get('blame.me', null);
    const mine = S.ps.find(p => myId && p.account_id === +myId);
    S.meSlot = mine ? mine.i : null;
    history.replaceState(null, '', `?match=${id}`);
    pushHistory();
    setStatus('');
    $('#picker').innerHTML = '';
    render();
    $('#app').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { setStatus('Ошибка: ' + e.message); }
}

function pushHistory() {
  const m = S.match, top = losers()[0];
  const h = store.get('blame.history', []).filter(x => x.id !== m.match_id);
  h.unshift({ id: m.match_id, ts: Date.now(), hero: top?.hero_id, name: top ? pname(top) : '', score: `${m.radiant_score}:${m.dire_score}` });
  store.set('blame.history', h.slice(0, 10));
  renderHistory();
}
function renderHistory() {
  const h = store.get('blame.history', []);
  $('#history').innerHTML = h.length ? `<div class="histLabel">Недавние разборы</div><div class="hist">${h.map(x => `<button class="chip" data-match="${x.id}">${img(heroIcon({ hero_id: x.hero }), 'hicon sm')}<span>${x.id}</span><small>${esc(x.score)}</small></button>`).join('')}</div>` : '';
}

/* ---------- рендер ---------- */
function stack(p, max = 80) {
  return `<div class="stack" style="--w:${clamp(p.blame / max) * 100}%">${Object.keys(p.parts).filter(k => p.parts[k] > .3).map(k => `<i style="flex:${p.parts[k]};background:${FACTORS[k].color}" title="${FACTORS[k].label}: ${p.parts[k].toFixed(1)}"></i>`).join('')}</div>`;
}
function ring(v, cls = '') {
  const r = 46, c = 2 * Math.PI * r, f = clamp(v / 80);
  return `<svg class="ring ${cls}" viewBox="0 0 110 110" aria-label="Индекс вины ${v}"><circle cx="55" cy="55" r="${r}" class="track"/><circle cx="55" cy="55" r="${r}" class="val" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 55 55)"/><text x="55" y="56">${v}</text><text x="55" y="76" class="sub">из 100</text></svg>`;
}
const legend = () => `<div class="legend">${Object.entries(FACTORS).map(([, f]) => `<span><i style="background:${f.color}"></i>${f.label}</span>`).join('')}</div>`;

function render() {
  $('#hero').classList.add('compact');
  const app = $('#app'), m = S.match;
  app.classList.remove('hidden');
  const parsed = isParsed(m);
  const team = t => S.ps.filter(p => p.team === t);
  const tabs = [['verdict', 'Вердикт'], ['players', 'Игроки'], ['timeline', 'Ход игры'], ['me', 'Мой разбор']];
  app.innerHTML = `
  <div class="matchHead card">
    <div class="side rad ${m.radiant_win ? 'win' : ''}"><span class="tname">${esc(teamName(m, 'radiant'))}</span>${m.radiant_win ? '<span class="badge">Победа</span>' : ''}<div class="mini">${team('radiant').map(p => img(heroIcon(p), 'hicon', H(p).name)).join('')}</div></div>
    <div class="mid"><div class="score"><b class="rad">${m.radiant_score}</b><span>:</span><b class="dire">${m.dire_score}</b></div>
      <div class="meta">${mmss(m.duration)} · ${new Date(m.start_time * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} · #${m.match_id}</div>
      <div class="meta"><span class="pill ${parsed ? 'ok' : 'warn'}">${parsed ? 'Реплей разобран' : 'Только базовая статистика'}</span></div></div>
    <div class="side dire ${!m.radiant_win ? 'win' : ''}"><span class="tname">${esc(teamName(m, 'dire'))}</span>${!m.radiant_win ? '<span class="badge">Победа</span>' : ''}<div class="mini">${team('dire').map(p => img(heroIcon(p), 'hicon', H(p).name)).join('')}</div></div>
  </div>
  ${parsed ? '' : `<div class="banner"><div><b>Реплей не разобран.</b> Нет графика золота, драк и вардов, поэтому оценка менее точная. Разбор обычно занимает 1–5 минут.</div><button class="primary small" data-act="parse" ${S.parse ? 'disabled' : ''}>${S.parse ? esc(S.parse) : 'Разобрать реплей'}</button></div>`}
  <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}
    <span class="grow"></span><button class="ghost small" data-act="copyLink">Ссылка</button><button class="ghost small" data-act="png">Картинка</button></nav>
  <div id="tabBody"></div>`;
  renderTab();
}

function renderTab() {
  const body = $('#tabBody');
  body.innerHTML = ({ verdict: verdictTab, players: playersTab, timeline: timelineTab, me: meTab })[S.tab]();
  if (S.tab === 'timeline') bindChart();
}

function verdictTab() {
  const m = S.match, L = losers(), W = winners(), top = L[0], second = L[1];
  const conf = confidence(top, second), gap = second ? top.blame - second.blame : 0;
  const weak = weakOf(top).slice(0, 3);
  const loseT = top.team, winT = loseT === 'radiant' ? 'dire' : 'radiant';
  const gapText = !second ? '' : gap >= 12 ? `Отрыв от следующего игрока ${gap} очков, так что вердикт уверенный.`
    : gap >= 5 ? `Следом идёт ${esc(pname(second))} (${esc(H(second).name)}), разница ${gap} очков. Проиграли скорее вдвоём.`
      : `Разница со следующим всего ${gap} очков: вина распределена по команде, не вешай всё на одного.`;
  const mvp = W[0];
  const strongEnemy = mvp && avg(Object.values(mvp.q)) > .78 ? `<p class="note">Учти и соперника: ${esc(pname(mvp))} на ${esc(H(mvp).name)} сыграл лучше, чем в ${Math.round(avg(Object.values(mvp.q)) * 100)}% игр по средним метрикам. Часть поражения — просто сильный противник.</p>` : '';
  const lead = leadInfo(loseT);
  return `
  <div class="grid vgrid">
    <article class="card culprit">
      <div class="cbg" style="background-image:url('${esc(heroImg(top))}')"></div>
      <div class="ctop">
        <div class="label red">Главный вклад в поражение</div>
        <div class="who">${img(heroImg(top), 'hport', H(top).name)}<div><h2>${esc(pname(top))}</h2><div class="sub">${esc(H(top).name)} · ${posLabel(top.pos)} ${rankName(top.rank_tier) ? '· ' + rankName(top.rank_tier) : ''}</div>
          <div class="kda"><b>${top.kills}</b>/<b class="d">${top.deaths}</b>/<b>${top.assists}</b> · ${fmt(top.gold_per_min)} GPM · ${fmt(top.net_worth)} NW</div></div>
          ${ring(top.blame)}</div>
      </div>
      <p class="vtext">Сильнее всего индекс вины подняли: ${weak.length ? weak.map(k => `<b>${FACTORS[k].label.toLowerCase()}</b>`).join(', ') : 'несколько факторов понемногу'}. ${gapText}</p>
      ${lead ? `<p class="note">${lead}</p>` : ''}
      ${strongEnemy}
      <div class="reasons">${weak.map(k => `<div class="reason"><i style="background:${FACTORS[k].color}"></i><div><b>${FACTORS[k].label}</b><span>${esc(factorInfo(top, k))}</span></div><em>+${top.parts[k].toFixed(0)}</em></div>`).join('') || '<div class="empty">Явных провалов нет: индекс собран из мелких сигналов.</div>'}</div>
      <div class="cfoot"><span class="conf"><span class="bar"><i style="width:${conf}%"></i></span>Уверенность ${conf}%</span><button class="ghost small" data-me="${top.i}">Подробный разбор →</button></div>
    </article>

    <aside class="card ranking">
      <div class="label">Индекс вины · ${esc(teamName(m, loseT))}</div>
      ${L.map((p, k) => `<button class="rrow ${k === 0 ? 'top' : ''}" data-me="${p.i}">${img(heroIcon(p), 'hicon')}<span class="rname"><b>${esc(pname(p))}</b><small>${esc(H(p).name)} · Pos ${p.pos}</small></span>${stack(p)}<span class="rnum">${p.blame}</span></button>`).join('')}
      ${legend()}
      <p class="hint">Индекс 0–100: насколько игрок хуже типичной игры на этом герое (по данным OpenDota) с учётом позиции. Позицию можно поправить во вкладке «Игроки».</p>
    </aside>
  </div>

  <div class="grid awards">
    ${award('good', 'Не вини его', L[L.length - 1], 'Лучший в проигравшей команде')}
    ${second ? award('warn', 'Тоже постарался', second, 'Второй по индексу вины') : ''}
    ${award('mvp', 'MVP соперника', mvp, `${esc(teamName(m, winT))}: самая сильная игра`)}
  </div>`;
}

function award(tone, title, p, desc) {
  if (!p) return '';
  const st = strongOf(p)[0];
  return `<button class="card award ${tone}" data-me="${p.i}"><div class="label">${title}</div><div class="aw">${img(heroImg(p), 'hport sm')}<div><b>${esc(pname(p))}</b><small>${esc(H(p).name)} · ${posLabel(p.pos)}</small></div><span class="anum">${p.blame}</span></div>
  <p>${desc}${st ? `. Сильная сторона: ${FACTORS[st].label.toLowerCase()}` : ''}.</p><small class="kd">${p.kills}/${p.deaths}/${p.assists} · ${fmt(p.gold_per_min)} GPM · ${fmt(p.hero_damage)} урона</small></button>`;
}

function leadInfo(loseT) {
  const g = S.match.radiant_gold_adv; if (!g?.length) return '';
  const sign = loseT === 'radiant' ? 1 : -1;
  let best = 0, at = 0, last = -1;
  g.forEach((v, i) => { const x = v * sign; if (x > best) { best = x; at = i; } if (x > 0) last = i; });
  if (best < 3000) return `Проигравшие почти не выходили вперёд по золоту: максимум +${fmt(best)}.`;
  return `Игра была выигрышной: на ${at}-й минуте проигравшие были впереди на <b>${fmt(best)}</b> золота, последний раз вели на ${last}-й минуте. Смотри «Ход игры», что случилось дальше.`;
}

function playersTab() {
  const m = S.match;
  const table = t => {
    const ps = S.ps.filter(p => p.team === t).sort((a, b) => a.pos - b.pos);
    const won = ps[0]?.won;
    return `<div class="card tcard"><div class="thead ${t}"><b>${esc(teamName(m, t))}</b><span class="pill ${won ? 'ok' : 'bad'}">${won ? 'Победа' : 'Поражение'}</span></div>
    <div class="tscroll"><table><thead><tr><th>Игрок</th><th>Позиция</th><th>K/D/A</th><th>GPM</th><th>XPM</th><th>Урон</th><th>Строения</th><th>Предметы</th><th>Индекс</th></tr></thead><tbody>
    ${ps.map(p => `<tr class="${S.meSlot === p.i ? 'me' : ''}">
      <td><button class="pl" data-me="${p.i}">${img(heroIcon(p), 'hicon')}<span><b>${esc(pname(p))}</b><small>${esc(H(p).name)}${rankName(p.rank_tier) ? ' · ' + rankName(p.rank_tier) : ''}</small></span></button></td>
      <td><select data-pos="${p.i}" aria-label="Позиция">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${p.pos === n ? 'selected' : ''}>${n} · ${POS[n]}</option>`).join('')}</select>${S.override[p.i] ? '<small class="src">вручную</small>' : `<small class="src">${p.posSrc}</small>`}</td>
      <td class="num">${p.kills}/<span class="d">${p.deaths}</span>/${p.assists}</td>
      <td class="num">${fmt(p.gold_per_min)}${chip(p.P.gpm.v)}</td>
      <td class="num">${fmt(p.xp_per_min)}${chip(p.P.xpm.v)}</td>
      <td class="num">${kfmt(p.hero_damage || 0)}${chip(p.P.hd.v)}</td>
      <td class="num">${kfmt(p.tower_damage || 0)}</td>
      <td><div class="items">${[0, 1, 2, 3, 4, 5].map(k => { const it = itemOf(p['item_' + k]); return it ? img(CDN + it.img, 'item', it.dname) : '<span class="item empty"></span>'; }).join('')}${(() => { const it = itemOf(p.item_neutral); return it ? img(CDN + it.img, 'item neutral', it.dname) : ''; })()}</div></td>
      <td><span class="bnum ${p.blame >= 45 ? 'hi' : p.blame >= 30 ? 'mid' : 'lo'}">${p.blame}</span></td></tr>`).join('')}
    </tbody></table></div></div>`;
  };
  const lt = losers()[0].team;
  return `<p class="hint top">Маленькие числа — перцентиль: лучше скольких процентов игр на этом герое. Позицию можно поменять, и индекс сразу пересчитается.</p>
  ${table(lt)}${table(lt === 'radiant' ? 'dire' : 'radiant')}`;
}
const chip = v => `<small class="pc ${v >= .7 ? 'g' : v < .3 ? 'r' : ''}">${Math.round(v * 100)}</small>`;

/* ---------- ход игры ---------- */
function fightsOf(m) {
  return (m.teamfights || []).map(f => {
    let rg = 0, dg = 0; const died = [];
    (f.players || []).forEach((x, i) => {
      const p = S.ps[i]; if (!p) return;
      if (p.team === 'radiant') rg += x.gold_delta || 0; else dg += x.gold_delta || 0;
      if (x.deaths) died.push(p);
    });
    return { t: f.start, end: f.end, deaths: f.deaths || died.length, swing: rg - dg, winner: rg >= dg ? 'radiant' : 'dire', died };
  });
}
function objectivesOf(m) {
  return (m.objectives || []).map(o => {
    if (o.type === 'building_kill' && o.key) {
      const rad = o.key.includes('goodguys'), what = o.key.includes('rax') ? 'барак' : o.key.includes('fort') ? 'трон' : 'башню';
      return { t: o.time, kind: 'b', by: rad ? 'dire' : 'radiant', text: `${rad ? 'Тьма' : 'Свет'} снесли ${what}` };
    }
    if (o.type === 'CHAT_MESSAGE_ROSHAN_KILL') return { t: o.time, kind: 'r', by: o.team === 2 ? 'radiant' : 'dire', text: `${o.team === 2 ? 'Свет' : 'Тьма'} убили Рошана` };
    if (o.type === 'CHAT_MESSAGE_FIRSTBLOOD') { const p = S.ps.find(x => x.player_slot === o.player_slot); return { t: o.time, kind: 'f', by: p?.team, text: `Первая кровь: ${p ? H(p).name : ''}` }; }
    return null;
  }).filter(Boolean);
}

function timelineTab() {
  const m = S.match;
  if (!isParsed(m)) {
    const nw = t => S.ps.filter(p => p.team === t).reduce((a, p) => a + (p.net_worth || 0), 0);
    const r = nw('radiant'), d = nw('dire'), tot = r + d || 1;
    return `<div class="card"><div class="label">Итоговая стоимость команд</div>
      <div class="nwbar"><i class="rad" style="width:${r / tot * 100}%">${kfmt(r)}</i><i class="dire" style="width:${d / tot * 100}%">${kfmt(d)}</i></div>
      <p class="hint">Поминутный график, драки, Рошан и снос строений появятся после разбора реплея. Кнопка «Разобрать реплей» выше.</p></div>`;
  }
  const fights = fightsOf(m), objs = objectivesOf(m), loseT = losers()[0].team;
  const key = fights.filter(f => f.winner !== loseT).sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing)).slice(0, 3);
  const keySet = new Set(key);
  const culprit = losers()[0];
  const events = [
    ...fights.map(f => ({ t: f.t, html: fightRow(f, keySet.has(f), loseT, culprit) })),
    ...objs.filter(o => o.kind !== 'f' || true).map(o => ({ t: o.t, html: `<div class="ev obj ${o.by}"><span class="et">${mmss(o.t)}</span><span class="ek">${o.kind === 'r' ? 'Рошан' : o.kind === 'f' ? 'Кровь' : 'Строение'}</span><span class="etx">${esc(o.text)}</span></div>` }))
  ].sort((a, b) => a.t - b.t);
  return `
  <div class="card chartCard"><div class="chartTop"><div class="label">Преимущество по золоту и опыту</div>
    <div class="legend"><span><i style="background:var(--rad)"></i>Свет впереди</span><span><i style="background:var(--dire)"></i>Тьма впереди</span><span><i class="dash"></i>Опыт</span><span><i class="dot"></i>Драка</span></div></div>
    <div class="chartWrap" id="chartWrap">${goldChart(m, fights, objs)}<div id="tip" class="tip hidden"></div></div>
    ${leadInfo(loseT) ? `<p class="note">${leadInfo(loseT)}</p>` : ''}
  </div>
  ${key.length ? `<div class="card"><div class="label red">Переломные драки</div>${key.map(f => fightRow(f, true, loseT, culprit)).join('')}</div>` : ''}
  <div class="card"><div class="label">Все события</div><div class="evlist">${events.map(e => e.html).join('') || '<div class="empty">Событий нет</div>'}</div></div>`;
}

function fightRow(f, key, loseT, culprit) {
  const lostDead = f.died.filter(p => p.team === loseT), winDead = f.died.filter(p => p.team !== loseT);
  const wonByLoser = f.winner === loseT;
  return `<div class="ev fight ${key ? 'key' : ''} ${f.winner}"><span class="et">${mmss(f.t)}</span><span class="ek">${wonByLoser ? 'Выиграли' : 'Проиграли'}</span>
  <span class="etx">Погибли: ${lostDead.map(p => img(heroIcon(p), 'hicon sm' + (p === culprit ? ' culp' : ''), H(p).name)).join('') || '—'} <span class="vs">против</span> ${winDead.map(p => img(heroIcon(p), 'hicon sm', H(p).name)).join('') || '—'}</span>
  <span class="esw ${wonByLoser ? 'g' : 'r'}">${wonByLoser ? '+' : '−'}${kfmt(Math.abs(f.swing))}</span></div>`;
}

function goldChart(m, fights, objs) {
  const g = m.radiant_gold_adv, x = m.radiant_xp_adv || [], n = g.length;
  const W = 1000, Ht = 300, pt = 16, pb = 46, pl = 44, pr = 12, ch = Ht - pt - pb;
  const max = Math.max(2000, ...g.map(Math.abs), ...x.map(Math.abs)) * 1.05;
  const X = i => pl + i * (W - pl - pr) / Math.max(1, n - 1), Y = v => pt + ch / 2 * (1 - v / max), y0 = Y(0);
  const line = a => a.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const area = `${line(g)}L${X(n - 1)},${y0}L${X(0)},${y0}Z`;
  const ticks = [max * .8, max * .4, -max * .4, -max * .8].map(v => Math.round(v / 1000) * 1000).filter((v, i, a) => v && a.indexOf(v) === i);
  const minutes = []; for (let i = 0; i < n; i += n > 50 ? 10 : 5) minutes.push(i);
  const tx = t => X(clamp(t / 60, 0, n - 1));
  S.chart = { n, X, W, g, x, fights, objs };
  return `<svg id="gchart" viewBox="0 0 ${W} ${Ht}" preserveAspectRatio="none" role="img" aria-label="График преимущества по золоту">
    <defs><clipPath id="cTop"><rect x="0" y="0" width="${W}" height="${y0}"/></clipPath><clipPath id="cBot"><rect x="0" y="${y0}" width="${W}" height="${Ht}"/></clipPath>
    <linearGradient id="gRad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--rad)" stop-opacity=".55"/><stop offset="1" stop-color="var(--rad)" stop-opacity=".05"/></linearGradient>
    <linearGradient id="gDire" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="var(--dire)" stop-opacity=".55"/><stop offset="1" stop-color="var(--dire)" stop-opacity=".05"/></linearGradient></defs>
    ${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="tick"/><text x="${pl - 6}" y="${Y(v) + 4}" class="ax" text-anchor="end">${v > 0 ? '+' : ''}${kfmt(v)}</text>`).join('')}
    ${minutes.map(i => `<text x="${X(i)}" y="${Ht - pb + 16}" class="ax" text-anchor="middle">${i}′</text>`).join('')}
    <path d="${area}" fill="url(#gRad)" clip-path="url(#cTop)"/><path d="${area}" fill="url(#gDire)" clip-path="url(#cBot)"/>
    <path d="${line(g)}" class="gl" clip-path="url(#cTop)" stroke="var(--rad)"/><path d="${line(g)}" class="gl" clip-path="url(#cBot)" stroke="var(--dire)"/>
    ${x.length ? `<path d="${line(x)}" class="xl"/>` : ''}
    <line x1="${pl}" x2="${W - pr}" y1="${y0}" y2="${y0}" class="zero"/>
    ${fights.map(f => `<circle cx="${tx(f.t)}" cy="${Ht - 14}" r="${3 + Math.min(6, f.deaths)}" class="fdot ${f.winner}"/>`).join('')}
    ${objs.filter(o => o.kind === 'r').map(o => `<rect x="${tx(o.t) - 5}" y="${Ht - 19}" width="10" height="10" transform="rotate(45 ${tx(o.t)} ${Ht - 14})" class="rosh ${o.by}"/>`).join('')}
    <line id="hov" x1="0" x2="0" y1="${pt}" y2="${Ht - pb}" class="hov" style="display:none"/>
  </svg>`;
}

function bindChart() {
  const svg = $('#gchart'), tip = $('#tip'), wrap = $('#chartWrap'); if (!svg) return;
  const c = S.chart;
  const move = e => {
    const r = svg.getBoundingClientRect(), cx = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width * c.W;
    let i = 0, best = 1e9; for (let k = 0; k < c.n; k++) { const dx = Math.abs(c.X(k) - cx); if (dx < best) { best = dx; i = k; } }
    const hov = $('#hov'); hov.setAttribute('x1', c.X(i)); hov.setAttribute('x2', c.X(i)); hov.style.display = '';
    const gv = c.g[i], xv = c.x[i];
    const near = [...c.fights.map(f => ({ t: f.t, text: `Драка: ${f.winner === 'radiant' ? 'Свет' : 'Тьма'} ${f.swing >= 0 ? '+' : '−'}${kfmt(Math.abs(f.swing))}` })), ...c.objs]
      .filter(o => Math.floor(o.t / 60) === i).slice(0, 4);
    tip.innerHTML = `<b>${i}-я минута</b><div class="${gv >= 0 ? 'rad' : 'dire'}">Золото: ${gv >= 0 ? 'Свет' : 'Тьма'} +${fmt(Math.abs(gv))}</div>${xv != null ? `<div>Опыт: ${xv >= 0 ? 'Свет' : 'Тьма'} +${fmt(Math.abs(xv))}</div>` : ''}${near.map(o => `<small>${esc(o.text)}</small>`).join('')}`;
    tip.classList.remove('hidden');
    const px = c.X(i) / c.W * r.width;
    tip.style.left = Math.min(Math.max(px, 80), r.width - 80) + 'px';
  };
  wrap.addEventListener('mousemove', move); wrap.addEventListener('touchmove', move, { passive: true });
  wrap.addEventListener('mouseleave', () => { tip.classList.add('hidden'); $('#hov').style.display = 'none'; });
}

/* ---------- мой разбор ---------- */
function radar(p) {
  const keys = Object.keys(FACTORS), R = 90, C = 120, ang = k => -Math.PI / 2 + k * 2 * Math.PI / keys.length;
  const pt = (k, v) => [C + Math.cos(ang(k)) * R * v, C + Math.sin(ang(k)) * R * v];
  const poly = vs => vs.map((v, k) => pt(k, v).map(z => z.toFixed(1)).join(',')).join(' ');
  return `<svg class="radar" viewBox="0 0 240 240" aria-label="Профиль игры">
    ${[.25, .5, .75, 1].map(s => `<polygon points="${poly(keys.map(() => s))}" class="rgrid"/>`).join('')}
    ${keys.map((k, i) => { const [x, y] = pt(i, 1.18); return `<line x1="${C}" y1="${C}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" class="rgrid"/><text x="${x}" y="${y + 3}" text-anchor="middle" class="rl">${k === 'util' ? 'Помощь' : FACTORS[k].label}</text>`; }).join('')}
    <polygon points="${poly(keys.map(() => .5))}" class="rmed"/>
    <polygon points="${poly(keys.map(k => clamp(p.q[k], .03, 1)))}" class="rme"/>
  </svg>`;
}

function meTab() {
  if (S.meSlot == null) {
    const team = t => S.ps.filter(p => p.team === t);
    return `<div class="card"><div class="label">Кем ты играл в этом матче?</div><p class="hint">Выбери себя, и мы соберём личный разбор: сильные стороны, слабые места и что делать в следующей игре.</p>
    ${['radiant', 'dire'].map(t => `<div class="pickTeam"><small>${esc(teamName(S.match, t))}</small><div class="pickGrid">${team(t).map(p => `<button class="pickP" data-me="${p.i}">${img(heroImg(p), 'hport sm')}<b>${esc(pname(p))}</b><small>${esc(H(p).name)}</small></button>`).join('')}</div></div>`).join('')}</div>`;
  }
  const p = S.ps.find(x => x.i === S.meSlot), mates = S.ps.filter(x => x.team === p.team).sort((a, b) => b.blame - a.blame);
  const place = mates.indexOf(p) + 1, weak = weakOf(p).slice(0, 3), strong = strongOf(p).slice(0, 3);
  const myId = store.get('blame.me', null);
  return `<div class="grid megrid">
    <article class="card mecard">
      <div class="who">${img(heroImg(p), 'hport', H(p).name)}<div><div class="label ${p.won ? 'green' : 'red'}">${p.won ? 'Победа' : 'Поражение'}</div><h2>${esc(pname(p))}</h2><div class="sub">${esc(H(p).name)} · ${posLabel(p.pos)}</div>
      <div class="kda"><b>${p.kills}</b>/<b class="d">${p.deaths}</b>/<b>${p.assists}</b> · ${fmt(p.gold_per_min)} GPM · ${fmt(p.xp_per_min)} XPM</div></div>${ring(p.blame)}</div>
      <p class="vtext">${place === 1 && !p.won ? 'В этом матче у тебя самый высокий индекс вины в команде.' : `Ты на ${place}-м месте из ${mates.length} по индексу вины в своей команде.`} ${p.won ? 'Победа не отменяет ошибок, ниже то, что стоит подтянуть.' : ''}</p>
      ${radar(p)}
      <div class="legend center"><span><i style="background:var(--accent)"></i>Ты</span><span><i class="dash"></i>Типичная игра на герое</span></div>
      <div class="cfoot"><button class="ghost small" data-act="pickOther">Выбрать другого игрока</button>${p.account_id && p.account_id !== myId ? `<button class="ghost small" data-act="saveMe" data-acc="${p.account_id}">Запомнить, это мой аккаунт</button>` : p.account_id ? '<span class="hint">Это твой сохранённый аккаунт</span>' : ''}</div>
    </article>
    <div class="col">
      <div class="card"><div class="label red">Что подтянуть</div>${weak.map(k => `<div class="tip2"><div class="th"><i style="background:${FACTORS[k].color}"></i><b>${FACTORS[k].label}</b><em>+${p.parts[k].toFixed(0)} к индексу</em></div><span>${esc(factorInfo(p, k))}</span><p>${TIPS[k]}</p></div>`).join('') || '<div class="empty">Явных провалов нет. Хорошая игра.</div>'}</div>
      <div class="card"><div class="label green">Получилось хорошо</div>${strong.map(k => `<div class="tip2 good"><div class="th"><i style="background:${FACTORS[k].color}"></i><b>${FACTORS[k].label}</b></div><span>${esc(factorInfo(p, k))}</span></div>`).join('') || '<div class="empty">Сильных сторон по метрикам в этом матче не нашлось.</div>'}</div>
    </div>
  </div>`;
}

/* ---------- шеринг ---------- */
function shareText() {
  const m = S.match, L = losers(), top = L[0];
  return `BLAME.GG · матч ${m.match_id} · ${m.radiant_score}:${m.dire_score}\nГлавный вклад в поражение: ${pname(top)} (${H(top).name}), индекс ${top.blame}/100\n${L.map(p => `${p.blame} — ${pname(p)} (${H(p).name})`).join('\n')}\n${location.href}`;
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(() => btn.textContent = o, 1500); }
  catch { window.prompt('Скопируй', text); }
}
function exportPng() {
  const m = S.match, L = losers(), top = L[0], c = document.createElement('canvas');
  c.width = 1200; c.height = 630; const x = c.getContext('2d');
  const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
  const grd = x.createLinearGradient(0, 0, 1200, 630); grd.addColorStop(0, '#0b0d14'); grd.addColorStop(1, '#1a0f16');
  x.fillStyle = grd; x.fillRect(0, 0, 1200, 630);
  x.fillStyle = '#ff4d5e'; x.font = '800 30px Unbounded, sans-serif'; x.fillText('BLAME.GG', 60, 80);
  x.fillStyle = '#8a93a6'; x.font = '500 22px Inter, sans-serif'; x.fillText(`Матч ${m.match_id} · ${mmss(m.duration)} · ${m.radiant_score}:${m.dire_score}`, 60, 120);
  x.fillStyle = '#e8ecf3'; x.font = '700 46px Unbounded, sans-serif'; x.fillText(pname(top).slice(0, 22), 60, 205);
  x.fillStyle = '#8a93a6'; x.font = '500 26px Inter, sans-serif'; x.fillText(`${H(top).name} · ${posLabel(top.pos)} · индекс вины ${top.blame}/100`, 60, 248);
  const fc = { farm: v('--f-farm'), xp: v('--f-xp'), fight: v('--f-fight'), deaths: v('--f-deaths'), obj: v('--f-obj'), util: v('--f-util') };
  L.forEach((p, k) => {
    const y = 310 + k * 58; x.fillStyle = '#e8ecf3'; x.font = '600 24px Inter, sans-serif'; x.fillText(`${pname(p).slice(0, 16)}`, 60, y + 22);
    x.fillStyle = '#8a93a6'; x.font = '500 18px Inter, sans-serif'; x.fillText(H(p).name, 60, y + 44);
    let cx = 340; const total = 760 * clamp(p.blame / 80);
    const sum = Object.values(p.parts).reduce((a, b) => a + b, 0) || 1;
    for (const k2 in p.parts) { const w = total * p.parts[k2] / sum; x.fillStyle = fc[k2] || '#888'; x.fillRect(cx, y + 8, Math.max(0, w - 2), 26); cx += w; }
    x.fillStyle = '#e8ecf3'; x.font = '700 26px Inter, sans-serif'; x.fillText(String(p.blame), cx + 14, y + 31);
  });
  c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `blame-${m.match_id}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
}

/* ---------- разбор реплея ---------- */
async function requestParse() {
  const id = S.match.match_id, t0 = Date.now();
  const upd = t => { S.parse = t; const b = document.querySelector('[data-act="parse"]'); if (b) { b.textContent = t; b.disabled = true; } };
  upd('Отправляем…');
  try {
    await getJSON(`${API}/request/${id}`, { method: 'POST' });
    const tick = async () => {
      if (S.match?.match_id !== id) return;
      if (Date.now() - t0 > 300000) { S.parse = ''; upd('Не дождались, попробуй позже'); return; }
      const m = await getJSON(`${API}/matches/${id}`).catch(() => null);
      if (m && isParsed(m)) { S.match = m; S.parse = ''; analyze(); render(); return; }
      upd(`Разбираем… ${Math.round((Date.now() - t0) / 1000)} с`);
      setTimeout(tick, 10000);
    };
    setTimeout(tick, 8000);
  } catch (e) { S.parse = ''; upd('Ошибка: ' + e.message); }
}

/* ---------- события ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mode) return setMode(b.dataset.mode);
  if (b.dataset.tab) { S.tab = b.dataset.tab; document.querySelectorAll('.tabs [data-tab]').forEach(x => x.classList.toggle('on', x === b)); return renderTab(); }
  if (b.dataset.me != null && !b.dataset.act) { S.meSlot = +b.dataset.me; S.tab = 'me'; return render(); }
  if (b.dataset.match) return loadMatch(b.dataset.match, b.dataset.acc);
  if (b.dataset.acc && !b.dataset.act) return showPlayer(b.dataset.acc);
  const act = b.dataset.act;
  if (act === 'parse') return requestParse();
  if (act === 'copyLink') return copy(shareText(), b);
  if (act === 'png') return exportPng();
  if (act === 'pickOther') { S.meSlot = null; return renderTab(); }
  if (act === 'saveMe') { store.set('blame.me', +b.dataset.acc); b.textContent = 'Сохранено'; updateMeBtn(); return; }
});
document.addEventListener('change', e => {
  const s = e.target.closest('select[data-pos]'); if (!s) return;
  const me = S.ps.find(p => p.i === +s.dataset.pos), to = +s.value;
  const other = S.ps.find(p => p.team === me.team && p.pos === to && p !== me);
  if (other) S.override[other.i] = me.pos; // меняем позиции местами, чтобы не было двух «троек»
  S.override[me.i] = to;
  store.set('blame.ovr.' + S.match.match_id, S.override);
  analyze(); renderTab();
});
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); onSearch($('#q').value); });
$('#meBtn').addEventListener('click', () => {
  const me = store.get('blame.me', null);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setMode('player');
  if (me) showPlayer(me); else { $('#q').focus(); setStatus('Найди себя по нику или Steam ID, потом нажми «Это я»'); }
});
function updateMeBtn() { $('#meBtn').textContent = store.get('blame.me', null) ? 'Мои матчи' : 'Найти себя'; }

updateMeBtn();
renderHistory();
const qp = new URLSearchParams(location.search);
if (qp.get('match')) { $('#q').value = qp.get('match'); loadMatch(qp.get('match')); }
else if (qp.get('player')) { setMode('player'); showPlayer(qp.get('player')); }
