'use strict';
/* «Как слили»: разбор матча по моментам, линиям, дракам, драфту, сборке, Рошану и байбекам.
   Почти всё требует разобранного реплея (kills_log, gold_t, purchase_log, teamfights). */

const loseTeam = () => losers()[0].team;
const winTeam = () => loseTeam() === 'radiant' ? 'dire' : 'radiant';
const teamOf = t => S.ps.filter(p => p.team === t);
const byPos = t => Object.fromEntries(teamOf(t).map(p => [p.pos, p]));
const heroTag = (p, cls = '') => `<span class="htag ${cls}">${img(heroIcon(p), 'hicon sm', H(p).name)}<b>${esc(pname(p))}</b><small>${esc(H(p).name)}</small></span>`;
const at = (p, k, min) => { const a = p[k]; return Array.isArray(a) && a.length ? a[Math.min(min, a.length - 1)] : null; };
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + kfmt(Math.abs(n));
const npcMap = () => S._npc || (S._npc = Object.fromEntries(Object.entries(S.heroes).map(([id, h]) => [h.npc, +id])));

// Все смерти героев из kills_log убийц: {t, victim, killer}.
function deathsOf() {
  if (S._deaths?.ps === S.ps) return S._deaths.list;
  const byHero = Object.fromEntries(S.ps.map(p => [p.hero_id, p])), list = [];
  S.ps.forEach(k => (k.kills_log || []).forEach(e => { const v = byHero[npcMap()[e.key]]; if (v) list.push({ t: e.time, victim: v, killer: k }); }));
  list.sort((a, b) => a.t - b.t);
  S._deaths = { ps: S.ps, list };
  return list;
}
// Преимущество по золоту с точки зрения проигравших, по минутам.
function loseAdv() {
  const g = S.match.radiant_gold_adv; if (!g?.length) return null;
  const s = loseTeam() === 'radiant' ? 1 : -1;
  return g.map(v => v * s);
}

/* ---------- 1. Смерть, которая стоила игры ---------- */
function turningPoint() {
  if (S._turn?.ps === S.ps) return S._turn.v;
  const a = loseAdv(), L = loseTeam(); let v = null;
  if (a && a.length > 3) {
    let best = { drop: 0 };
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j <= Math.min(a.length - 1, i + 5); j++) if (a[j] - a[i] < best.drop) best = { drop: a[j] - a[i], i, j };
    if (best.i != null && best.drop <= -1500) {
      const t0 = best.i * 60, t1 = best.j * 60, all = deathsOf().filter(d => d.t >= t0 - 30 && d.t <= t1 + 30);
      const lD = all.filter(d => d.victim.team === L), wD = all.filter(d => d.victim.team !== L);
      const swing = d => { const k = Math.floor(d.t / 60); return a[Math.min(a.length - 1, k + 2)] - a[Math.min(a.length - 1, k)]; };
      let key = lD.slice().sort((x, y) => swing(x) - swing(y) || x.t - y.t)[0];
      if (key) key = lD.find(d => d.t >= key.t - 25 && d.t <= key.t) || key; // первый умерший в той же стычке
      const objs = objectivesOf(S.match).filter(o => o.t >= t0 && o.t <= t1 + 60 && o.by && o.by !== L && o.kind !== 'f');
      const bb = key ? (key.victim.buyback_log || []).some(b => b.time >= key.t && b.time <= key.t + 120) : false;
      v = { t0, t1, from: a[best.i], to: a[best.j], drop: best.drop, key, keySwing: key ? swing(key) : 0, lD, wD, objs, bb, maxLead: Math.max(...a) };
    }
  }
  S._turn = { ps: S.ps, v };
  return v;
}

function turningBanner() {
  const tp = turningPoint(); if (!tp?.key) return '';
  const k = tp.key;
  return `<button class="tbanner" data-tab="story"><span class="tbl">${T('Момент, который стоил игры', 'Вот тут игру и слили')}</span>
    <span class="tbx">${mmss(k.t)} · ${esc(pname(k.victim))} на ${esc(H(k.victim).name)} ${T('погиб', 'отлетел')}${tp.bb ? '' : T(' без байбека', ' без байбека')}. За 2 минуты после этого ${sgn(tp.keySwing)} золота.</span><span class="tbgo">Разбор →</span></button>`;
}

function turnCard() {
  const tp = turningPoint(), L = loseTeam(), a = loseAdv();
  if (!a) return '';
  if (!tp) {
    const lead = Math.max(...a);
    return `<section class="card"><div class="label">${T('Перелом', 'Момент слива')}</div><p class="vtext">${lead < 1500
      ? T('Резкого перелома не было: проигравшие отставали почти всю игру.', 'Слива не было, потому что выигрывать никто и не собирался. Отставали всю игру.')
      : T('Преимущество уходило постепенно, без одного решающего момента.', 'Сливали медленно и со вкусом, без одного яркого момента.')}</p></section>`;
  }
  const k = tp.key, dead = {};
  tp.lD.forEach(d => { dead[d.victim.i] = (dead[d.victim.i] || 0) + 1; });
  const deadList = Object.entries(dead).sort((x, y) => y[1] - x[1]).map(([i, c]) => { const p = S.ps.find(x => x.i === +i); return `${heroTag(p, p === k?.victim ? 'bad' : '')}<em class="cnt">×${c}</em>`; }).join('');
  const lostObj = tp.objs.map(o => `<li>${mmss(o.t)} · ${esc(o.text)}</li>`).join('');
  return `<section class="card turn">
    <div class="label red">${T('Смерть, которая стоила игры', 'Смерть, которая стоила игры')}</div>
    <div class="turnHead"><div class="big">${mmss(tp.t0)}–${mmss(tp.t1)}</div><div><b>${sgn(tp.drop)}</b> ${T('золота за', 'золота слили за')} ${Math.round((tp.t1 - tp.t0) / 60)} мин<small>было ${sgn(tp.from)} → стало ${sgn(tp.to)}${tp.maxLead >= 2000 ? ` · максимум за игру ${sgn(tp.maxLead)}` : ''}</small></div></div>
    ${k ? `<div class="keyDeath">${img(heroImg(k.victim), 'hport sm', H(k.victim).name)}<div><b>${mmss(k.t)} — ${esc(pname(k.victim))} (${esc(H(k.victim).name)})</b>
      <span>${T('Погиб первым', 'Отлетел первым')}, убил ${esc(H(k.killer).name)}. ${tp.bb ? T('Выкупился.', 'Выкупился, но не помогло.') : k.t >= 1500 ? T('Без байбека.', 'Байбека не было.') : ''} За 2 минуты после этого ${sgn(tp.keySwing)} золота.</span></div></div>` : ''}
    <div class="turnGrid">
      <div><small>${T('Умерли в этот отрезок', 'Кто отлетал')}</small><div class="tags">${deadList || '—'}</div></div>
      <div><small>${T('Что потеряли', 'Что отдали')}</small>${lostObj ? `<ul class="olist">${lostObj}</ul>` : '<div class="empty">Строения не потеряли</div>'}</div>
    </div>
    <p class="note">${T(`У врага за это же время ${tp.wD.length} смертей против ${tp.lD.length} у ${esc(teamName(S.match, L))}.`, `Враги за это время отлетели ${tp.wD.length} раз, наши — ${tp.lD.length}. Комментарии излишни.`)}</p>
  </section>`;
}

/* ---------- 2. Дуэли по позициям ---------- */
function duels() {
  const L = loseTeam(), A = byPos(L), B = byPos(winTeam()), npc = npcMap();
  return [1, 2, 3, 4, 5].map(pos => {
    const x = A[pos], y = B[pos]; if (!x || !y) return null;
    const g10 = x.gold_t ? at(x, 'gold_t', 10) - at(y, 'gold_t', 10) : null;
    const nw = (x.net_worth || 0) - (y.net_worth || 0), dmg = (x.hero_damage || 0) - (y.hero_damage || 0);
    const kx = (x.kills_log || []).filter(e => npc[e.key] === y.hero_id).length, ky = (y.kills_log || []).filter(e => npc[e.key] === x.hero_id).length;
    const scale = pos >= 4 ? .5 : 1; // саппорты фармят мало, разница в золоте у них весит меньше
    let sc = (g10 != null ? clamp(g10 / 1500 * scale, -1, 1) : 0) + clamp(nw / 6000 * scale, -1.5, 1.5) + clamp((kx - ky) / 3, -1, 1) + clamp(dmg / 15000, -.5, .5) + clamp((y.deaths - x.deaths) / 6, -.7, .7);
    const v = sc <= -2 ? 'crushed' : sc <= -.6 ? 'lost' : sc < .6 ? 'even' : sc < 2 ? 'won' : 'crushedThem';
    return { pos, x, y, g10, nw, kx, ky, dmg, sc, v };
  }).filter(Boolean);
}
const DUEL_LABEL = {
  crushed: ['Разгромно проиграл', 'УНИЧТОЖЕН'], lost: ['Проиграл', 'ПРОИГРАЛ'], even: ['Ровно', 'РОВНО'],
  won: ['Выиграл', 'ВЫИГРАЛ'], crushedThem: ['Разгромно выиграл', 'РАЗНЁС']
};
function duelCard() {
  const ds = duels(), lostN = ds.filter(d => d.sc <= -.6).length, worst = ds.slice().sort((a, b) => a.sc - b.sc)[0];
  const row = d => {
    const tone = d.sc <= -.6 ? 'bad' : d.sc >= .6 ? 'good' : 'neutral';
    const share = clamp(.5 + d.sc / 6, .05, .95) * 100;
    return `<div class="duel ${tone}"><div class="dpos">${posLabel(d.pos)}</div>
      <div class="dside">${heroTag(d.x)}</div><div class="dbar"><i style="width:${share}%"></i></div><div class="dside r">${heroTag(d.y)}</div>
      <div class="dfacts">${d.g10 != null ? `<span>10 мин: <b class="${d.g10 < 0 ? 'r' : 'g'}">${sgn(d.g10)}</b></span>` : ''}<span>Нетворс: <b class="${d.nw < 0 ? 'r' : 'g'}">${sgn(d.nw)}</b></span>${d.x.kills_log ? `<span>Убийства друг на друге: <b>${d.kx}:${d.ky}</b></span>` : ''}<span>Урон: <b class="${d.dmg < 0 ? 'r' : 'g'}">${sgn(d.dmg)}</b></span></div>
      <span class="tag ${tone}">${T(...DUEL_LABEL[d.v])}</span></div>`;
  };
  const head = lostN >= 4 ? T(`Проиграли ${lostN} из 5 дуэлей: соперник был сильнее почти на каждой позиции.`, `Проиграли ${lostN} из 5 дуэлей. Это не невезение, это разница в классе.`)
    : lostN >= 2 ? T(`Проиграли ${lostN} из 5 дуэлей.`, `${lostN} из 5 дуэлей слиты. Хватило, чтобы проиграть игру.`)
      : T('Дуэли в целом ровные: игру проиграли не на позициях, а командно.', 'По дуэлям почти ровно. Значит, сливали всей командой, а не по одному.');
  return `<section class="card"><div class="label">${T('Дуэли по позициям', 'Кто кого переиграл')}</div><p class="vtext">${head}${worst && worst.sc <= -.6 ? ` ${T('Хуже всего', 'Самая позорная дуэль')}: ${esc(POS[worst.pos].toLowerCase())}, ${esc(H(worst.x).name)} против ${esc(H(worst.y).name)}.` : ''}</p>
    <div class="duels">${ds.map(row).join('')}</div>
    <p class="hint">Слева — проигравшие, справа — их визави. Полоса показывает, кто взял дуэль: золото на 10-й минуте, итоговый нетворс, убийства друг на друге, урон и смерти.</p></section>`;
}

/* ---------- 3. Хроника слива по фазам ---------- */
function phases() {
  const m = S.match, d = m.duration || 0, L = loseTeam(), a = loseAdv(), deaths = deathsOf(), objs = objectivesOf(m), fights = fightDetails();
  const A = byPos(L), B = byPos(winTeam());
  return [['Линии', 0, 600], ['Мидгейм', 600, 1500], ['Лейт', 1500, d]].filter(([, s, e]) => e > s + 60).map(([name, s, e]) => {
    const adv = t => a ? a[Math.min(a.length - 1, Math.floor(t / 60))] : null;
    const delta = a ? adv(Math.min(e, d)) - adv(s) : null;
    const ld = deaths.filter(x => x.t >= s && x.t < e && x.victim.team === L), wd = deaths.filter(x => x.t >= s && x.t < e && x.victim.team !== L);
    const lostB = objs.filter(o => o.kind === 'b' && o.t >= s && o.t < e && o.by !== L).length, tookB = objs.filter(o => o.kind === 'b' && o.t >= s && o.t < e && o.by === L).length;
    const rosh = objs.filter(o => o.kind === 'r' && o.t >= s && o.t < e), roshL = rosh.filter(o => o.by === L).length;
    const fl = fights.filter(f => f.t >= s && f.t < e), fLost = fl.filter(f => f.lost).length;
    // Руинер фазы: смерти, проигранные «первые смерти» в драках, а на линиях — отставание от визави.
    const sc = {}, why = {};
    teamOf(L).forEach(p => { sc[p.i] = 0; why[p.i] = []; });
    ld.forEach(x => { sc[x.victim.i] += 2; });
    wd.forEach(x => { if (x.killer.team === L) sc[x.killer.i] -= 1; });
    fl.filter(f => f.lost && f.firstL).forEach(f => { sc[f.firstL.victim.i] += 1.5; });
    teamOf(L).forEach(p => { const c = ld.filter(x => x.victim === p).length; if (c) why[p.i].push(`${c} ${c === 1 ? 'смерть' : c < 5 ? 'смерти' : 'смертей'}`); });
    if (name === 'Линии') teamOf(L).forEach(p => {
      const o = B[p.pos]; if (!o || !p.gold_t) return;
      const diff = at(p, 'gold_t', 10) - at(o, 'gold_t', 10), w = p.pos >= 4 ? 1200 : 700;
      sc[p.i] += clamp(-diff / w, -2, 2);
      if (diff <= -800) why[p.i].push(`${sgn(diff)} золота к 10-й против ${H(o).name}`);
    });
    const top = teamOf(L).sort((x, y) => sc[y.i] - sc[x.i])[0];
    const ruiner = top && sc[top.i] >= 2 ? { p: top, why: why[top.i] } : null;
    const res = delta != null ? (delta <= -2500 ? 'lost' : delta >= 2500 ? 'won' : 'even') : (ld.length - wd.length >= 4 ? 'lost' : wd.length - ld.length >= 4 ? 'won' : 'even');
    return { name, s, e, delta, ld, wd, lostB, tookB, roshL, roshW: rosh.length - roshL, fl: fl.length, fLost, ruiner, res };
  });
}
const PHASE_TEXT = {
  lost: [['Фазу проиграли.', 'Слили фазу подчистую.'], ['Соперник забрал этот отрезок.', 'Тут всё и поехало вниз.'], ['Отставание выросло.', 'Отдали фазу без боя.']],
  even: [['Фаза прошла примерно ровно.', 'Ни туда ни сюда.'], ['Без явного перевеса.', 'Потоптались на месте.']],
  won: [['Фазу выиграли.', 'Тут даже что-то получалось.'], ['Здесь были впереди.', 'Был шанс. Был.']]
};
function phaseCard() {
  const ps = phases();
  const card = (ph, k) => {
    const txt = pick(PHASE_TEXT[ph.res], (S.match.match_id % 7) + k);
    const facts = [ph.delta != null ? `золото ${sgn(ph.delta)}` : null, `смерти ${ph.ld.length}:${ph.wd.length}`,
      ph.fl ? `драки: проиграли ${ph.fLost} из ${ph.fl}` : null, ph.lostB || ph.tookB ? `строения −${ph.lostB} / +${ph.tookB}` : null,
      ph.roshL || ph.roshW ? `Рошан ${ph.roshL}:${ph.roshW}` : null].filter(Boolean);
    return `<div class="phase ${ph.res}"><div class="phHead"><b>${ph.name}</b><span>${mmss(ph.s)}–${mmss(ph.e)}</span></div>
      <p>${T(...txt)}</p><div class="phFacts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>
      ${ph.ruiner ? `<div class="phR"><small>${T('Больше всех виноват', 'Руинер фазы')}</small>${heroTag(ph.ruiner.p, 'bad')}<span>${esc(ph.ruiner.why.join(', ') || 'проигранные драки')}</span></div>` : `<div class="phR none"><small>${T('Явного виновника нет', 'Руинера нет')}</small></div>`}</div>`;
  };
  return `<section class="card"><div class="label">${T('Хроника по фазам', 'Хроника слива')}</div><div class="phases">${ps.map(card).join('')}</div></section>`;
}

/* ---------- 4. Драки поимённо ---------- */
function fightDetails() {
  if (S._fights?.ps === S.ps) return S._fights.v;
  const m = S.match, L = loseTeam(), deaths = deathsOf(), lp = teamOf(L);
  const v = fightsOf(m).map((f, fi) => {
    const raw = m.teamfights[fi], inF = deaths.filter(d => d.t >= f.t - 3 && d.t <= (f.end || f.t) + 3);
    const part = p => { const x = raw.players?.[p.i]; return x && ((x.damage || 0) > 0 || (x.deaths || 0) > 0 || (x.healing || 0) > 0); };
    const absent = lp.filter(p => !part(p));
    return { ...f, firstL: inF.find(d => d.victim.team === L), absent, lost: f.winner !== L, part: lp.length - absent.length };
  });
  S._fights = { ps: S.ps, v };
  return v;
}
function fightCard() {
  const fs = fightDetails(), lost = fs.filter(f => f.lost), L = loseTeam();
  if (!fs.length) return '';
  const st = Object.fromEntries(teamOf(L).map(p => [p.i, { p, first: 0, absent: 0, died: 0, in: 0 }]));
  lost.forEach(f => {
    if (f.firstL) st[f.firstL.victim.i].first++;
    if (f.part >= 2) f.absent.forEach(p => st[p.i].absent++);
    f.died.filter(p => p.team === L).forEach(p => st[p.i].died++);
    teamOf(L).filter(p => !f.absent.includes(p)).forEach(p => st[p.i].in++);
  });
  const rows = Object.values(st).sort((a, b) => b.first - a.first || b.died - a.died);
  const firstKing = rows[0], ghost = Object.values(st).sort((a, b) => b.absent - a.absent)[0];
  const head = [
    firstKing.first >= 2 ? T(`В ${firstKing.first} из ${lost.length} проигранных драк первым погибал ${esc(pname(firstKing.p))} (${esc(H(firstKing.p).name)}).`, `В ${firstKing.first} из ${lost.length} проигранных драк первым отлетал ${esc(pname(firstKing.p))}. Открывал драку своей смертью.`) : '',
    ghost.absent >= 2 ? T(`${esc(pname(ghost.p))} не участвовал в ${ghost.absent} проигранных драках.`, `${esc(pname(ghost.p))} пропустил ${ghost.absent} проигранных драк. Видимо, был занят чем-то важным. Лесом, например.`) : ''
  ].filter(Boolean).join(' ') || T('Проигранные драки без явного виновника.', 'В драках сливали дружно, без лидера.');
  return `<section class="card"><div class="label">${T('Драки поимённо', 'Кто сливал драки')}</div>
    <p class="vtext">${T(`Проиграли ${lost.length} из ${fs.length} драк.`, `Слили ${lost.length} драк из ${fs.length}.`)} ${head}</p>
    <div class="tscroll"><table class="ftable"><thead><tr><th>Игрок</th><th>Погиб первым</th><th>Не пришёл</th><th>Умер в драках</th><th>Был в драках</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${heroTag(r.p)}</td><td class="num ${r.first >= 2 ? 'hiR' : ''}">${r.first}</td><td class="num ${r.absent >= 2 ? 'hiR' : ''}">${r.absent}</td><td class="num">${r.died}</td><td class="num">${r.in} из ${lost.length}</td></tr>`).join('')}
    </tbody></table></div><p class="hint">Считаются только проигранные драки. «Не пришёл» — ни урона, ни лечения, ни смерти в драке, где участвовали хотя бы двое из команды.</p></section>`;
}

/* ---------- 5. Драфт и сборка ---------- */
async function matchupsFor(hid) {
  const key = 'blame.mu.' + hid, c = store.get(key, null);
  if (c && Date.now() - c.ts < 5 * 864e5) return c.d;
  const d = await getJSON(`${API}/heroes/${hid}/matchups`);
  const slim = Object.fromEntries(d.map(x => [x.hero_id, [x.games_played, x.wins]]));
  store.set(key, { ts: Date.now(), d: slim });
  return slim;
}
async function draftInfo() {
  const id = S.match.match_id;
  if (S._draft?.id === id) return S._draft.v;
  const Lp = teamOf(loseTeam()), Wp = teamOf(winTeam());
  const mus = await Promise.all(Lp.map(p => matchupsFor(p.hero_id).catch(() => null)));
  const rows = Lp.map((p, k) => {
    const mu = mus[k] || {}, vs = Wp.map(e => { const r = mu[e.hero_id]; return r && r[0] >= 10 ? { e, wr: r[1] / r[0], n: r[0] } : null; }).filter(Boolean);
    return { p, vs, avg: vs.length ? avg(vs.map(x => x.wr)) : null, worst: vs.slice().sort((a, b) => a.wr - b.wr)[0] };
  });
  const counter = Wp.map(e => { const ws = rows.map(r => r.vs.find(x => x.e === e)).filter(Boolean); return { e, wr: ws.length ? 1 - avg(ws.map(x => x.wr)) : null }; }).filter(x => x.wr != null).sort((a, b) => b.wr - a.wr)[0];
  const v = { rows, counter };
  S._draft = { id, v };
  return v;
}
async function fillDraft() {
  const box = document.getElementById('draftBox'); if (!box) return;
  try {
    const { rows, counter } = await draftInfo();
    const known = rows.filter(r => r.avg != null).sort((a, b) => a.avg - b.avg);
    if (!known.length) { box.innerHTML = '<div class="empty">Недостаточно статистики по матчапам.</div>'; return; }
    const w = known[0], teamWr = avg(known.map(r => r.avg));
    box.innerHTML = `<p class="vtext">${teamWr < .48 ? T(`Драф был против нас: средний винрейт пиков против этих врагов ${Math.round(teamWr * 100)}%.`, `Проиграли ещё на драфте: ${Math.round(teamWr * 100)}% винрейта против этого пика.`) : teamWr > .52 ? T(`По драфту были в плюсе (${Math.round(teamWr * 100)}%), так что проиграли не на пиках.`, `Драфт был за нас (${Math.round(teamWr * 100)}%). Пикнули нормально, сыграли — как сыграли.`) : T('Драфт примерно равный.', 'Драфт ровный, на пики не свалишь.')}
      ${w.avg < .48 ? ` ${T('Хуже всего заходил', 'Руинер драфта')}: <b>${esc(H(w.p).name)}</b> (${esc(pname(w.p))}) — ${Math.round(w.avg * 100)}% против этого пика${w.worst ? `, особенно против ${esc(H(w.worst.e).name)} (${Math.round(w.worst.wr * 100)}%)` : ''}.` : ''}
      ${counter && counter.wr > .53 ? ` ${T('Главный контрпик соперника', 'Главная проблема в пике врага')}: <b>${esc(H(counter.e).name)}</b>, ${Math.round(counter.wr * 100)}% против наших героев.` : ''}</p>
      <div class="draft">${known.map(r => `<div class="drow">${heroTag(r.p)}<div class="dwr"><i style="width:${r.avg * 100}%" class="${r.avg < .48 ? 'r' : r.avg > .52 ? 'g' : ''}"></i></div><b>${Math.round(r.avg * 100)}%</b></div>`).join('')}</div>
      <p class="hint">Винрейт героя против каждого из пяти врагов по статистике OpenDota (учитываются пары от 10 игр).</p>`;
  } catch (e) { box.innerHTML = `<div class="empty">Не удалось загрузить матчапы: ${esc(e.message)}</div>`; }
}

const ITEM_NORM = {
  black_king_bar: 24, blink: 16, manta: 22, bfury: 17, radiance: 20, desolator: 18, maelstrom: 14, mjollnir: 25, butterfly: 32, skadi: 30,
  satanic: 34, assault: 30, heart: 32, ultimate_scepter: 26, force_staff: 18, glimmer_cape: 17, ghost: 16, lotus_orb: 26, pipe: 22,
  crimson_guard: 20, shivas_guard: 28, sphere: 26, aeon_disk: 28, silver_edge: 27, nullifier: 32, bloodthorn: 32, orchid: 18, harpoon: 22,
  echo_sabre: 13, armlet: 12, hand_of_midas: 11, travel_boots: 30, sange_and_yasha: 20, kaya_and_sange: 22, yasha_and_kaya: 22,
  octarine_core: 30, refresher: 36, guardian_greaves: 24, vladmir: 16, solar_crest: 20, spirit_vessel: 16, pavise: 15, aether_lens: 14,
  rod_of_atos: 16, eternal_shroud: 28, disperser: 28, gungir: 28, abyssal_blade: 34, monkey_king_bar: 30, greater_crit: 30
};
const SAVE_ITEMS = ['glimmer_cape', 'force_staff', 'ghost', 'lotus_orb', 'solar_crest', 'pavise', 'guardian_greaves', 'aeon_disk', 'eul', 'cyclone', 'wind_waker', 'holy_locket', 'boots_of_bearing'];
const iname = k => S.items[k]?.dname || k;
function itemIssues() {
  const L = loseTeam(), dmin = (S.match.duration || 0) / 60;
  return teamOf(L).map(p => {
    const iss = [], first = {};
    (p.purchase_log || []).forEach(e => { if (first[e.key] == null) first[e.key] = e.time; });
    const has = k => first[k] != null || (p.purchase && p.purchase[k]);
    for (const [k, norm] of Object.entries(ITEM_NORM)) {
      if (first[k] == null) continue;
      const min = first[k] / 60, late = min - norm;
      if (late >= 6) iss.push({ sev: late / 6, text: T(`${iname(k)} на ${Math.round(min)}-й минуте, обычно около ${norm}-й.`, `${iname(k)} на ${Math.round(min)}-й. Норма — ${norm}-я. Опоздал на ${Math.round(late)} минут, как на пары.`) });
    }
    if (p.pos <= 2 && !has('black_king_bar') && dmin >= 32 && (p.deaths || 0) >= 7) iss.push({ sev: 2, text: T(`Нет BKB за ${Math.round(dmin)} минут при ${p.deaths} смертях.`, `${Math.round(dmin)} минут без BKB и ${p.deaths} смертей. Контроль врага сказал спасибо.`) });
    if (p.pos >= 4 && p.purchase) {
      if (!p.purchase.ward_observer) iss.push({ sev: 2.5, text: T('Не купил ни одного обса.', 'Саппорт без единого обса. Карту светила, видимо, интуиция.') });
      if (!p.purchase.ward_sentry && dmin > 25) iss.push({ sev: 1, text: T('Ни одного сентри за игру.', 'Ни одного сентри. Вражеские варды живут долго и счастливо.') });
      if (dmin >= 35 && !SAVE_ITEMS.some(has)) iss.push({ sev: 1.5, text: T('Ни одного сейв-предмета за длинную игру.', `${Math.round(dmin)} минут и ни одного сейв-предмета. Спасал команду только морально.`) });
    }
    if (first.hand_of_midas != null && first.hand_of_midas / 60 > 15) iss.push({ sev: 1, text: T(`Мидас на ${Math.round(first.hand_of_midas / 60)}-й минуте: поздно, он уже не окупится.`, `Мидас на ${Math.round(first.hand_of_midas / 60)}-й. Инвестиция в будущее, которого не было.`) });
    return { p, iss: iss.sort((a, b) => b.sev - a.sev).slice(0, 3), sev: iss.reduce((s, x) => s + x.sev, 0) };
  }).sort((a, b) => b.sev - a.sev);
}
function draftItemsCard() {
  const items = isParsed(S.match) ? itemIssues() : null, worst = items?.[0];
  return `<section class="card"><div class="label">${T('Драфт и сборка', 'Руинер драфта и сборки')}</div>
    <div class="twoCol"><div><h3 class="sub3">Драфт</h3><div id="draftBox"><div class="empty"><span class="spin"></span> Считаем матчапы…</div></div></div>
    <div><h3 class="sub3">Сборка</h3>${!items ? '<div class="empty">Нужен разобранный реплей: без него нет лога покупок.</div>'
      : worst.sev < 1 ? `<p class="vtext">${T('Явных проблем со сборкой нет.', 'По предметам придраться не к чему. Даже обидно.')}</p>`
        : `<p class="vtext">${T('Больше всего вопросов к сборке', 'Руинер сборки')}: <b>${esc(pname(worst.p))}</b> (${esc(H(worst.p).name)}).</p>
        <div class="ilist">${items.filter(x => x.iss.length).map(x => `<div class="irow">${heroTag(x.p)}<ul>${x.iss.map(i => `<li>${esc(i.text)}</li>`).join('')}</ul></div>`).join('')}</div>`}
    </div></div></section>`;
}

/* ---------- 6. Рошан и байбеки ---------- */
function roshBuyback() {
  const m = S.match, L = loseTeam(), deaths = deathsOf(), objs = objectivesOf(m), ev = [], blame = {};
  const add = (p, w) => { blame[p.i] = (blame[p.i] || 0) + w; };
  (m.objectives || []).filter(o => o.type === 'CHAT_MESSAGE_ROSHAN_KILL').forEach(o => {
    const by = o.team === 2 ? 'radiant' : 'dire', aeg = (m.objectives || []).find(x => x.type === 'CHAT_MESSAGE_AEGIS' && x.time >= o.time && x.time <= o.time + 30);
    const holder = aeg ? S.ps.find(p => p.player_slot === aeg.player_slot) : null;
    const near = deaths.filter(d => d.victim.team === L && d.t >= o.time - 75 && d.t <= o.time + 15).map(d => d.victim);
    near.forEach(p => add(p, by === L ? .5 : 1));
    ev.push({ t: o.time, bad: by !== L, html: by === L
      ? T(`Взяли Рошана${holder ? `, аегис у ${esc(H(holder).name)}` : ''}.`, `Забрали Рошана${holder ? `, аегис у ${esc(H(holder).name)}` : ''}. Хоть что-то.`)
      : `${T('Рошан у соперника', 'Отдали Рошана')}${holder ? `, аегис у ${esc(H(holder).name)}` : ''}.${near.length ? ` ${T('Рядом погибли', 'У ямы отлетели')}: ${near.map(p => esc(H(p).name)).join(', ')}.` : ''}` });
  });
  teamOf(L).forEach(p => {
    const bbs = (p.buyback_log || []).map(b => b.time);
    deaths.filter(d => d.victim === p).forEach(d => {
      const bought = bbs.find(t => t >= d.t && t <= d.t + 120);
      if (bought != null) {
        const again = deaths.find(x => x.victim === p && x.t > bought && x.t <= bought + 60);
        if (again) { add(p, 1.5); ev.push({ t: bought, bad: true, html: `${esc(H(p).name)}: ${T('выкупился и погиб снова через', 'байбек в пустоту, снова отлетел через')} ${Math.round(again.t - bought)} с.` }); }
        return;
      }
      if (d.t < 1800) return;
      const lostB = objs.find(o => o.kind === 'b' && o.by !== L && o.t >= d.t && o.t <= d.t + 100);
      if (lostB) { add(p, 2); ev.push({ t: d.t, bad: true, html: `${esc(H(p).name)} ${T('погиб без байбека', 'отлетел без байбека')}, через ${Math.round(lostB.t - d.t)} с: ${esc(lostB.text.toLowerCase())}.` }); }
    });
  });
  const top = Object.entries(blame).sort((a, b) => b[1] - a[1])[0];
  return { ev: ev.sort((a, b) => a.t - b.t), ruiner: top && top[1] >= 2 ? S.ps.find(p => p.i === +top[0]) : null };
}
function roshCard() {
  const { ev, ruiner } = roshBuyback();
  if (!ev.length) return `<section class="card"><div class="label">${T('Рошан и байбеки', 'Рошан и байбеки')}</div><div class="empty">Ни Рошана, ни спорных байбеков.</div></section>`;
  return `<section class="card"><div class="label">${T('Рошан и байбеки', 'Рошан и байбеки')}</div>
    ${ruiner ? `<p class="vtext">${T('Больше всех ошибок здесь', 'Руинер Рошана и байбеков')}: <b>${esc(pname(ruiner))}</b> (${esc(H(ruiner).name)}).</p>` : ''}
    <div class="evlist">${ev.map(e => `<div class="ev ${e.bad ? 'dire' : 'radiant'}"><span class="et">${mmss(e.t)}</span><span class="etx">${e.html}</span></div>`).join('')}</div></section>`;
}

/* ---------- итог и вкладка ---------- */
function ruinerSummary() {
  const rows = [], tp = turningPoint(), ds = duels(), worst = ds.slice().sort((a, b) => a.sc - b.sc)[0];
  if (tp?.key) rows.push(['Момент слива', tp.key.victim]);
  if (isParsed(S.match)) {
    const lane = phases()[0]; if (lane?.ruiner) rows.push(['Линии', lane.ruiner.p]);
    const fs = fightDetails().filter(f => f.lost && f.firstL), cnt = {};
    fs.forEach(f => { cnt[f.firstL.victim.i] = (cnt[f.firstL.victim.i] || 0) + 1; });
    const f = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; if (f && f[1] >= 2) rows.push(['Драки', S.ps.find(p => p.i === +f[0])]);
    const it = itemIssues()[0]; if (it?.sev >= 2) rows.push(['Сборка', it.p]);
    const rb = roshBuyback().ruiner; if (rb) rows.push(['Рошан и байбеки', rb]);
  }
  if (worst && worst.sc <= -.6) rows.push(['Дуэль', worst.x]);
  const tally = {}; rows.forEach(([, p]) => { tally[p.i] = (tally[p.i] || 0) + 1; });
  const king = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return { rows, king: king && king[1] >= 2 ? { p: S.ps.find(p => p.i === +king[0]), n: king[1] } : null };
}

function storyTab() {
  const parsed = isParsed(S.match), { rows, king } = ruinerSummary();
  const summary = `<section class="card summary"><div class="label red">${T('Кто руинил по разделам', 'Кто руинил по разделам')}</div>
    ${king ? `<p class="vtext">${T(`Чаще всех в списке — <b>${esc(pname(king.p))}</b> (${esc(H(king.p).name)}): ${king.n} из ${rows.length} разделов.`, `<b>${esc(pname(king.p))}</b> на ${esc(H(king.p).name)} отметился в ${king.n} разделах из ${rows.length}. Руинер-многостаночник.`)}</p>` : rows.length ? `<p class="vtext">${T('Виновники разные: проиграли командой.', 'Руинили по очереди, никто не хотел быть единственным.')}</p>` : ''}
    <div class="srows">${rows.map(([what, p]) => `<div class="srow ${king && p === king.p ? 'king' : ''}"><small>${what}</small>${heroTag(p)}</div>`).join('') || '<div class="empty">Мало данных для разбора по разделам.</div>'}</div></section>`;
  const needParse = parsed ? '' : `<section class="card"><div class="label">Нужен разбор реплея</div><p class="vtext">Момент слива, хроника, драки, сборка, Рошан и байбеки считаются по реплею. Нажми «Разобрать реплей» выше — обычно это 1–5 минут.</p></section>`;
  return summary + needParse + (parsed ? turnCard() + phaseCard() : '') + duelCard() + (parsed ? fightCard() : '') + draftItemsCard() + (parsed ? roshCard() : '');
}
function afterStory() { fillDraft(); }
