'use strict';
/* Видео-хайлайт матча: вертикальный ролик 9:16 ~20 с, рисуется на canvas и пишется MediaRecorder прямо в браузере.
   Победа — «тащер» с салютом, поражение — «руинер» с прожаркой. Если игрок отметил себя («Мой разбор») — ролик про него. */

const REEL = { W: 720, H: 1280, FPS: 30 };
const ease = t => 1 - Math.pow(1 - clamp(t), 3);
const easeBack = t => { t = clamp(t); const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const seg = (t, a, b) => clamp((t - a) / (b - a));

function reelData() {
  const m = S.match, winT = m.radiant_win ? 'radiant' : 'dire', L = losers(), ruiner = L[0];
  const winners = S.ps.filter(p => p.team === winT).sort((a, b) => a.score - b.score || (b.kills + b.assists) - (a.kills + a.assists));
  const tash = winners[0];
  const me = S.meSlot != null ? S.ps.find(p => p.i === S.meSlot) : null;
  const mode = me ? (me.team === winT ? 'win' : 'loss') : 'neutral';
  const hero = me || tash;
  const side = hero.team;
  const tp = isParsed(m) ? turningPoint() : null;
  const objs = objectivesOf(m);

  const moments = [];
  const fb = objs.find(o => o.kind === 'f');
  if (fb) moments.push({ t: fb.t, text: fb.text, pr: 2 });
  const mk = Object.keys(hero.multi_kills || {}).map(Number).sort((a, b) => b - a)[0];
  const MK = { 2: 'Дабл-килл', 3: 'Трипл-килл', 4: 'Ультра-килл', 5: 'РАМПАГА' };
  if (mk >= 3) moments.push({ t: null, text: `${MK[Math.min(mk, 5)]} от ${H(hero).name}`, hot: true, pr: 4 });
  const ks = Object.keys(hero.kill_streaks || {}).map(Number).sort((a, b) => b - a)[0];
  if (ks >= 5) moments.push({ t: null, text: `Серия из ${ks} убийств без смерти`, hot: true, pr: 3 });
  const rosh = objs.filter(o => o.kind === 'r' && o.by === side).length;
  if (rosh) moments.push({ t: null, text: `Рошан${rosh > 1 ? ` ×${rosh}` : ''} · ${teamName(m, side)}`, pr: 1 });
  if (tp?.key) moments.push({ t: tp.key.t, text: side === winT ? `${H(tp.key.victim).name} отлетел — и игра сломалась` : `Вот тут и слили: отлетел ${H(tp.key.victim).name}`, hot: true, pr: 5 });
  moments.push({ t: m.duration, text: `${teamName(m, winT)} сносят трон`, pr: 0 });

  const adv = m.radiant_gold_adv?.length > 3 ? m.radiant_gold_adv.map(v => side === 'radiant' ? v : -v) : null;
  return { m, winT, ruiner, tash, me, mode, hero, side, tp, adv, moments: moments.sort((a, b) => b.pr - a.pr).slice(0, 4).sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9)) };
}

// Портреты Steam отдают CORS только своему домену, поэтому идут через воркер — иначе холст «заражён» и не пишется.
function reelImg(p) {
  return new Promise(res => {
    const path = (H(p).img || '').split('?')[0];
    if (!path || !CONFIG.apiUrl) return res(null);
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => res(im); im.onerror = () => res(null);
    im.src = `${CONFIG.apiUrl}/img${path}`;
    setTimeout(() => res(null), 6000);
  });
}

function reelPlan(d) {
  // [начало, конец] сцен в секундах; без графика золота сцена выпадает.
  const s = [['intro', 2.4], ['hero', 4.2]];
  if (d.adv) s.push(['gold', 4.2]);
  s.push(['moments', 4.2], ['verdict', 4.4], ['outro', 2.6]);
  let t = 0; return s.map(([k, len]) => { const r = { k, a: t, b: t + len }; t += len; return r; });
}

/* ---------- рисование ---------- */
function reelDraw(x, t, d, im, plan, conf) {
  const { W, H: HH } = REEL;
  const win = d.mode !== 'loss';
  const acc = win && d.mode === 'win' ? '#3ddc97' : '#ff4d5e';
  // фон с медленным дрейфом
  const g = x.createLinearGradient(0, 0, W * .3, HH);
  g.addColorStop(0, d.mode === 'win' ? '#062018' : '#1d0710'); g.addColorStop(1, '#07080c');
  x.fillStyle = g; x.fillRect(0, 0, W, HH);
  x.save(); x.globalAlpha = .08; x.fillStyle = acc;
  for (let i = 0; i < 6; i++) { const r = 180 + i * 60; x.beginPath(); x.arc(W / 2 + Math.sin(t * .6 + i) * 140, 420 + Math.cos(t * .4 + i * 2) * 260, r, 0, 7); x.fill(); }
  x.restore();

  const sc = plan.find(p => t >= p.a && t < p.b) || plan[plan.length - 1], lt = t - sc.a, len = sc.b - sc.a;
  const fadeOut = sc === plan[plan.length - 1] ? 1 : 1 - seg(lt, len - .25, len);
  x.save(); x.globalAlpha = fadeOut;
  ({ intro: sIntro, hero: sHero, gold: sGold, moments: sMoments, verdict: sVerdict, outro: sOutro })[sc.k](x, lt, d, im, acc, conf);
  x.restore();

  // постоянная плашка бренда
  x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '800 26px Unbounded, sans-serif'; x.textAlign = 'left';
  x.fillText('BLAME', 44, 74); const bw = x.measureText('BLAME').width; x.fillStyle = '#ff4d5e'; x.fillText('.GG', 44 + bw, 74);
  x.fillStyle = 'rgba(255,255,255,.35)'; x.font = '500 20px Inter, sans-serif'; x.textAlign = 'right'; x.fillText(`#${d.m.match_id}`, W - 44, 72);
  // полоска прогресса
  const total = plan[plan.length - 1].b;
  x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(44, HH - 40, W - 88, 4);
  x.fillStyle = acc; x.fillRect(44, HH - 40, (W - 88) * clamp(t / total), 4);
  x.textAlign = 'left';
}

function center(x, text, y, font, color, alpha = 1, maxW = REEL.W - 80) {
  // Не влезает — ужимаем по ширине (до 55%), и только потом режем многоточием.
  x.save(); x.globalAlpha *= alpha; x.font = font; x.fillStyle = color; x.textAlign = 'center';
  let s = String(text), w = x.measureText(s).width;
  const k = w > maxW ? Math.max(.55, maxW / w) : 1;
  while (w * k > maxW && s.length > 3) { s = s.slice(0, -2) + '…'; w = x.measureText(s).width; }
  x.translate(REEL.W / 2, y); x.scale(k, k); x.fillText(s, 0, 0); x.restore();
}

function sIntro(x, t, d) {
  const { m, mode, side, winT } = d;
  const label = mode === 'neutral' ? 'РАЗБОР МАТЧА' : mode === 'win' ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
  const col = mode === 'win' ? '#3ddc97' : mode === 'loss' ? '#ff4d5e' : '#f5b942';
  const k = easeBack(seg(t, 0, .6));
  x.save(); x.translate(REEL.W / 2, 560); x.scale(k, k);
  x.shadowColor = col; x.shadowBlur = 40;
  x.font = '800 104px Unbounded, sans-serif'; const fit = Math.min(1, (REEL.W - 80) / x.measureText(label).width); x.scale(fit, fit);
  x.fillStyle = col; x.textAlign = 'center'; x.fillText(label, 0, 0);
  x.restore();
  const a = ease(seg(t, .5, 1.1));
  const my = mode === 'neutral' ? winT : side, opp = my === 'radiant' ? 'dire' : 'radiant';
  const sMy = my === 'radiant' ? m.radiant_score : m.dire_score, sOp = opp === 'radiant' ? m.radiant_score : m.dire_score;
  center(x, `${sMy} : ${sOp}`, 720 + (1 - a) * 40, '800 120px Unbounded, sans-serif', '#e8ecf3', a);
  center(x, `${teamName(m, my)}  vs  ${teamName(m, opp)}`, 800, '600 30px Inter, sans-serif', '#8a93a6', ease(seg(t, .8, 1.4)));
  center(x, `${mmss(m.duration)} · Dota 2`, 850, '500 26px Inter, sans-serif', '#5d6679', ease(seg(t, 1, 1.6)));
}

function portrait(x, im, p, cx, cy, w, hgt, glow, k = 1) {
  k = Math.max(.01, k); // easeBack на старте даёт -0.0000…, а roundRect с отрицательным радиусом падает
  x.save(); x.translate(cx, cy); x.scale(k, k);
  x.shadowColor = glow; x.shadowBlur = 50;
  const r = 28; x.beginPath(); x.roundRect(-w / 2, -hgt / 2, w, hgt, r); x.fillStyle = '#151a25'; x.fill();
  x.shadowBlur = 0; x.clip();
  if (im) x.drawImage(im, -w / 2, -hgt / 2, w, hgt);
  else { x.fillStyle = glow; x.globalAlpha = .25; x.fillRect(-w / 2, -hgt / 2, w, hgt); x.globalAlpha = 1; x.font = '800 120px Unbounded, sans-serif'; x.fillStyle = '#e8ecf3'; x.textAlign = 'center'; x.fillText(H(p).name[0], 0, 42); }
  x.restore();
  x.save(); x.strokeStyle = glow; x.lineWidth = 4; x.beginPath(); x.roundRect(cx - w / 2 * k, cy - hgt / 2 * k, w * k, hgt * k, 28 * k); x.stroke(); x.restore();
}

function sHero(x, t, d, im, acc) {
  const p = d.hero, who = d.me ? 'ТВОЯ ИГРА' : 'ТАЩЕР КАТКИ';
  center(x, who, 200, '800 34px Unbounded, sans-serif', d.me ? acc : '#3ddc97', ease(seg(t, 0, .4)));
  const k = easeBack(seg(t, .1, .8));
  portrait(x, im.hero, p, REEL.W / 2, 440, 512, 288, d.me ? acc : '#3ddc97', k);
  center(x, pname(p), 680, '800 54px Unbounded, sans-serif', '#e8ecf3', ease(seg(t, .5, 1)));
  center(x, `${H(p).name} · ${POS[p.pos] || ''}`, 728, '500 30px Inter, sans-serif', '#8a93a6', ease(seg(t, .6, 1.1)));
  const c = ease(seg(t, .9, 2.4));
  const kda = `${Math.round(p.kills * c)} / ${Math.round(p.deaths * c)} / ${Math.round(p.assists * c)}`;
  center(x, kda, 860, '800 96px Unbounded, sans-serif', '#e8ecf3', ease(seg(t, .8, 1.2)));
  center(x, 'убийства / смерти / помощь', 906, '500 24px Inter, sans-serif', '#5d6679', ease(seg(t, .9, 1.3)));
  const stats = [[fmt(p.gold_per_min * c), 'GPM'], [kfmt((p.hero_damage || 0) * c), 'урона'], [fmt((p.last_hits || 0) * c), 'крипов']];
  stats.forEach(([v, l], i) => {
    const a = ease(seg(t, 1.4 + i * .2, 1.9 + i * .2)), cx = 140 + i * 220;
    x.save(); x.globalAlpha *= a; x.textAlign = 'center';
    x.font = '800 48px Unbounded, sans-serif'; x.fillStyle = i === 0 ? '#f5b942' : i === 1 ? '#ff4d5e' : '#4cc9f0'; x.fillText(v, cx, 1030 + (1 - a) * 30);
    x.font = '500 24px Inter, sans-serif'; x.fillStyle = '#8a93a6'; x.fillText(l, cx, 1070);
    x.restore();
  });
}

function sGold(x, t, d, im, acc) {
  const a = d.adv, n = a.length, max = Math.max(1000, ...a.map(Math.abs));
  center(x, 'ЗОЛОТО ПО ХОДУ МАТЧА', 200, '800 34px Unbounded, sans-serif', '#f5b942', ease(seg(t, 0, .4)));
  center(x, `${teamName(d.m, d.side)} ${d.me ? '(твоя команда)' : ''}`.trim(), 248, '500 26px Inter, sans-serif', '#8a93a6', ease(seg(t, .1, .5)));
  const X0 = 60, X1 = REEL.W - 60, Y0 = 420, Y1 = 920, mid = (Y0 + Y1) / 2;
  const px = i => X0 + (X1 - X0) * i / (n - 1), py = v => mid - (v / max) * (Y1 - Y0) / 2 * .9;
  x.strokeStyle = 'rgba(255,255,255,.15)'; x.lineWidth = 2; x.beginPath(); x.moveTo(X0, mid); x.lineTo(X1, mid); x.stroke();
  const prog = ease(seg(t, .3, 3.2)) * (n - 1);
  const last = Math.floor(prog);
  // заливка выше / ниже нуля
  for (const [sign, col] of [[1, 'rgba(61,220,151,.28)'], [-1, 'rgba(255,77,94,.28)']]) {
    x.beginPath(); x.moveTo(px(0), mid);
    for (let i = 0; i <= last; i++) x.lineTo(px(i), sign > 0 ? Math.min(mid, py(a[i])) : Math.max(mid, py(a[i])));
    x.lineTo(px(last), mid); x.closePath(); x.fillStyle = col; x.fill();
  }
  x.beginPath(); for (let i = 0; i <= last; i++) i ? x.lineTo(px(i), py(a[i])) : x.moveTo(px(i), py(a[i]));
  x.strokeStyle = '#e8ecf3'; x.lineWidth = 5; x.lineJoin = 'round'; x.stroke();
  const cur = a[Math.min(n - 1, last)];
  x.fillStyle = cur >= 0 ? '#3ddc97' : '#ff4d5e'; x.beginPath(); x.arc(px(last), py(cur), 11, 0, 7); x.fill();
  center(x, `${cur >= 0 ? '+' : '−'}${kfmt(Math.abs(cur))}`, 1010, '800 84px Unbounded, sans-serif', cur >= 0 ? '#3ddc97' : '#ff4d5e');
  center(x, `${last}-я минута`, 1060, '500 26px Inter, sans-serif', '#8a93a6');
  // отметка момента слива
  const k = d.tp?.key ? Math.round(d.tp.key.t / 60) : null;
  if (k != null && last >= k) {
    const fl = seg(prog, k, k + 3), xx = px(Math.min(k, n - 1));
    x.save(); x.globalAlpha *= ease(fl); x.strokeStyle = '#ff4d5e'; x.setLineDash([10, 10]); x.lineWidth = 3;
    x.beginPath(); x.moveTo(xx, Y0 - 20); x.lineTo(xx, Y1 + 20); x.stroke(); x.setLineDash([]);
    x.font = '800 30px Unbounded, sans-serif'; x.fillStyle = '#ff4d5e'; x.textAlign = xx > REEL.W / 2 ? 'right' : 'left';
    x.fillText('ВОТ ТУТ', xx + (xx > REEL.W / 2 ? -14 : 14), Y0 - 30); x.restore();
  }
}

function sMoments(x, t, d) {
  center(x, 'КЛЮЧЕВЫЕ МОМЕНТЫ', 200, '800 34px Unbounded, sans-serif', '#4cc9f0', ease(seg(t, 0, .4)));
  d.moments.forEach((mo, i) => {
    const a = easeBack(seg(t, .4 + i * .6, 1 + i * .6)), y = 360 + i * 200;
    x.save(); x.globalAlpha *= clamp(a); x.translate((1 - clamp(a)) * -200, 0);
    x.fillStyle = mo.hot ? 'rgba(255,77,94,.16)' : 'rgba(255,255,255,.06)';
    x.beginPath(); x.roundRect(50, y, REEL.W - 100, 160, 24); x.fill();
    x.strokeStyle = mo.hot ? '#ff4d5e' : 'rgba(255,255,255,.12)'; x.lineWidth = 3; x.stroke();
    x.font = '800 40px Unbounded, sans-serif'; x.fillStyle = mo.hot ? '#ff4d5e' : '#f5b942'; x.textAlign = 'left';
    x.fillText(mo.t != null ? mmss(mo.t) : '🔥', 84, y + 66);
    x.font = '600 32px Inter, sans-serif'; x.fillStyle = '#e8ecf3';
    wrap(x, mo.text, 84, y + 116, REEL.W - 170, 38, 1);
    x.restore();
  });
}

function wrap(x, text, X, Y, maxW, lh, lines = 2) {
  const words = String(text).split(' '); let line = '', n = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (x.measureText(test).width > maxW && line) { x.fillText(line, X, Y + n * lh); line = w; if (++n >= lines) { return; } }
    else line = test;
  }
  if (line) x.fillText(line, X, Y + n * lh);
}

function sVerdict(x, t, d, im, acc, conf) {
  const { mode, me, tash, ruiner } = d;
  let top, p, col, quote, sub;
  if (mode === 'win') {
    p = me; col = '#3ddc97';
    top = me === tash ? 'ТАЩЕР КАТКИ — ЭТО ТЫ' : 'ВЫВЕЗЛИ!';
    sub = me === tash ? `${pname(me)}|чище всех в команде` : `${pname(me)}|тащил ${pname(tash)} на ${H(tash).name}`;
    quote = me === tash ? 'Команда может сказать спасибо.' : 'Победа есть победа. В следующий раз тащишь ты.';
  } else if (mode === 'loss') {
    p = ruiner; col = '#ff4d5e';
    top = me === ruiner ? 'РУИНЕР — ЭТО ТЫ' : 'РУИНЕР КАТКИ';
    sub = `${pname(ruiner)}|${H(ruiner).name} · ${POS[ruiner.pos] || ''}`;
    quote = me === ruiner ? archetype(ruiner).say : `Не ты слил. ${archetype(ruiner).say}`;
  } else {
    p = ruiner; col = '#ff4d5e'; top = 'РУИНЕР КАТКИ';
    sub = `${pname(ruiner)}|${H(ruiner).name} · ${POS[ruiner.pos] || ''}`;
    quote = archetype(ruiner).say;
  }
  const shake = col === '#ff4d5e' && t > .5 && t < .9 ? Math.sin(t * 90) * 10 : 0;
  center(x, top, 210, '800 46px Unbounded, sans-serif', col, ease(seg(t, 0, .4)));
  const k = easeBack(seg(t, .2, .9));
  x.save(); x.translate(shake, 0); portrait(x, p === d.hero ? im.hero : im.verdict, p, REEL.W / 2, 450, 512, 288, col, k); x.restore();
  const [s1, s2] = sub.split('|');
  center(x, s1, 676, '800 44px Unbounded, sans-serif', '#e8ecf3', ease(seg(t, .7, 1.2)));
  if (s2) center(x, s2, 722, '500 28px Inter, sans-serif', '#8a93a6', ease(seg(t, .8, 1.3)));
  // кольцо индекса
  const ring = ease(seg(t, .9, 2.2)), cy = 850, R = 96, sc = mode === 'win' ? p.score : p.score;
  x.save(); x.globalAlpha *= ease(seg(t, .8, 1.1));
  x.lineWidth = 18; x.strokeStyle = 'rgba(255,255,255,.1)'; x.beginPath(); x.arc(REEL.W / 2, cy, R, 0, 7); x.stroke();
  x.strokeStyle = col; x.lineCap = 'round'; x.beginPath(); x.arc(REEL.W / 2, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(sc / 100) * ring); x.stroke();
  x.restore();
  center(x, String(Math.round(sc * ring)), cy + 26, '800 72px Unbounded, sans-serif', '#e8ecf3', ease(seg(t, .8, 1.1)));
  center(x, 'индекс вины', cy + 140, '500 24px Inter, sans-serif', '#8a93a6', ease(seg(t, .9, 1.2)));
  x.save(); x.globalAlpha *= ease(seg(t, 1.6, 2.2)); x.font = 'italic 600 34px Inter, sans-serif'; x.fillStyle = col; x.textAlign = 'center';
  const lines = []; let line = '';
  for (const w of `«${quote}»`.split(' ')) { const tt = line ? line + ' ' + w : w; if (x.measureText(tt).width > REEL.W - 120 && line) { lines.push(line); line = w; } else line = tt; }
  lines.push(line); lines.slice(0, 3).forEach((l, i) => x.fillText(l, REEL.W / 2, 1080 + i * 44));
  x.restore();
  if (col !== '#ff4d5e') confetti(x, t, conf);
}

function confetti(x, t, conf) {
  for (const c of conf) {
    const tt = t - c.d; if (tt < 0) continue;
    const y = c.y + tt * c.vy + tt * tt * 260, xx = c.x + Math.sin(tt * c.w) * 40 + tt * c.vx;
    if (y > REEL.H) continue;
    x.save(); x.translate(xx, y); x.rotate(tt * c.w); x.fillStyle = c.c; x.fillRect(-7, -4, 14, 8); x.restore();
  }
}

function sOutro(x, t, d) {
  const k = easeBack(seg(t, 0, .5));
  x.save(); x.translate(REEL.W / 2, 560); x.scale(k, k);
  x.font = '800 64px Unbounded, sans-serif'; x.textAlign = 'center'; x.fillStyle = '#e8ecf3';
  x.fillText('КТО СЛИЛ', 0, -40); x.fillStyle = '#ff4d5e'; x.fillText('ТВОЮ КАТКУ?', 0, 40);
  x.restore();
  center(x, 'Кинь Match ID — узнай за пару секунд', 720, '600 32px Inter, sans-serif', '#8a93a6', ease(seg(t, .4, .9)));
  const a = ease(seg(t, .7, 1.2));
  x.save(); x.globalAlpha *= a; x.fillStyle = '#ff4d5e'; x.beginPath(); x.roundRect(110, 800, REEL.W - 220, 100, 50); x.fill();
  x.font = '800 34px Unbounded, sans-serif'; x.fillStyle = '#fff'; x.textAlign = 'center';
  x.fillText((location.host + location.pathname).replace(/\/$/, '').replace(/^www\./, ''), REEL.W / 2, 863); x.restore();
  center(x, `или бот @${CONFIG.botUsername || 'blamedota_bot'} в Telegram`, 960, '500 28px Inter, sans-serif', '#8a93a6', ease(seg(t, 1, 1.5)));
}

/* ---------- звук: простой бит и удары на сменах сцен ---------- */
function reelAudio(plan, win, ac) {
  try {
    if (!ac) return null;
    ac.resume?.();
    const dest = ac.createMediaStreamDestination();
    const master = ac.createGain(); master.gain.value = .5; master.connect(dest);
    const t0 = ac.currentTime + .05, total = plan[plan.length - 1].b, beat = .48;
    const kick = at => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(140, at); o.frequency.exponentialRampToValueAtTime(40, at + .18); g.gain.setValueAtTime(.9, at); g.gain.exponentialRampToValueAtTime(.001, at + .25); o.connect(g).connect(master); o.start(at); o.stop(at + .3); };
    const noise = ac.createBuffer(1, ac.sampleRate * .1, ac.sampleRate); const ch = noise.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const hat = at => { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noise; f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(.25, at); g.gain.exponentialRampToValueAtTime(.001, at + .06); s.connect(f).connect(g).connect(master); s.start(at); };
    const boom = (at, f0) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f0 / 3, at + .6); g.gain.setValueAtTime(.35, at); g.gain.exponentialRampToValueAtTime(.001, at + .7); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; o.connect(lp).connect(g).connect(master); o.start(at); o.stop(at + .8); };
    const chord = (at, notes) => notes.forEach(f => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(.12, at + .05); g.gain.exponentialRampToValueAtTime(.001, at + 2.2); o.connect(g).connect(master); o.start(at); o.stop(at + 2.3); });
    for (let b = 0; b * beat < total - 2.4; b++) { kick(t0 + b * beat); hat(t0 + b * beat + beat / 2); }
    plan.forEach(p => boom(t0 + p.a, 220));
    const v = plan.find(p => p.k === 'verdict');
    if (v) chord(t0 + v.a + .3, win ? [523, 659, 784, 1046] : [220, 261, 311]);
    return { ac, track: dest.stream.getAudioTracks()[0] };
  } catch { return null; }
}

function reelMime() {
  const opts = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return opts.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

async function openReel() {
  if (!S.match) return;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return toast('Этот браузер не умеет записывать видео. Открой в Chrome или Safari.');
  track('reel_open');
  // Звук создаём сразу в обработчике клика: после await браузер его уже не разрешит.
  let ac = null; try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  const d = reelData(), plan = reelPlan(d), total = plan[plan.length - 1].b;
  modal(`<div class="pwHead"><h2>🎬 Видео-хайлайт</h2><p id="reelSt">Собираем ролик… это займёт ~${Math.round(total)} с</p><p class="hint">Не сворачивай вкладку, пока идёт запись.</p></div>
    <div class="reelWrap"><canvas id="reelCv" width="${REEL.W}" height="${REEL.H}"></canvas></div>
    <div class="reelBtns" id="reelBtns"></div>
    ${d.me ? '' : '<p class="hint center">Отметь себя во вкладке «Мой разбор» — ролик будет про твою игру.</p>'}`, 'reel');
  const cv = document.getElementById('reelCv'), x = cv.getContext('2d');
  await document.fonts?.ready;
  const im = { hero: await reelImg(d.hero), verdict: d.mode === 'win' ? null : await reelImg(d.ruiner) };
  const conf = Array.from({ length: 120 }, () => ({ x: Math.random() * REEL.W, y: -40 - Math.random() * 300, vx: (Math.random() - .5) * 120, vy: 80 + Math.random() * 220, w: 2 + Math.random() * 6, d: .9 + Math.random() * 1.2, c: ['#3ddc97', '#f5b942', '#ff4d5e', '#4cc9f0', '#a78bfa'][Math.floor(Math.random() * 5)] }));

  const stream = cv.captureStream(REEL.FPS), audio = reelAudio(plan, d.mode !== 'loss', ac);
  if (audio?.track) stream.addTrack(audio.track);
  const mime = reelMime(), rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5e6 } : { videoBitsPerSecond: 5e6 });
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => { rec.onstop = r; });
  rec.start(500);
  const start = performance.now();
  await new Promise(res => {
    const tick = () => {
      if (!document.getElementById('reelCv')) { rec.state !== 'inactive' && rec.stop(); return res(); }
      const t = (performance.now() - start) / 1000;
      try { reelDraw(x, Math.min(t, total), d, im, plan, conf); } catch (e) { console.warn('reel frame', e); }
      const st = document.getElementById('reelSt'); if (st) st.textContent = `Собираем ролик… ${Math.max(0, Math.ceil(total - t))} с`;
      if (t >= total + .2) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (rec.state !== 'inactive') rec.stop();
  await done; audio?.ac.close?.();
  if (!document.getElementById('reelCv')) return;
  const type = (mime || 'video/webm').split(';')[0], ext = type.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type }), url = URL.createObjectURL(blob);
  const file = new File([blob], `blame-${d.m.match_id}.${ext}`, { type });
  track('reel_ready');
  document.querySelector('.reelWrap').innerHTML = `<video src="${url}" controls autoplay playsinline loop></video>`;
  document.getElementById('reelSt').textContent = 'Готово! Закинь в Stories или в чат пати.';
  const canShare = navigator.canShare?.({ files: [file] }) && !TMA;
  const canTg = TMA || globalThis.Account?.logged;
  document.getElementById('reelBtns').innerHTML = `${canTg ? '<button class="primary" id="reelTg">📲 Прислать в Telegram</button>' : ''}
    ${canShare ? `<button class="${canTg ? 'ghost' : 'primary'}" id="reelShare">📤 Поделиться</button>` : ''}
    ${TMA ? '' : `<a class="${canTg || canShare ? 'ghost' : 'primary'} btnlike" href="${url}" download="${file.name}" id="reelDl">⬇️ Скачать ${ext.toUpperCase()}</a>`}
    <button class="ghost" id="reelAgain">↻ Ещё раз</button>`;
  document.getElementById('reelDl')?.addEventListener('click', () => track('reel_download'));
  document.getElementById('reelAgain').addEventListener('click', () => openReel());
  document.getElementById('reelShare')?.addEventListener('click', async () => {
    track('reel_share');
    try { await navigator.share({ files: [file], title: 'BLAME.GG', text: `Кто слил катку? ${shareUrl()}` }); } catch {}
  });
  const tgBtn = document.getElementById('reelTg');
  tgBtn?.addEventListener('click', () => sendReelToTg(blob, type, d.m.match_id, tgBtn));
  if (TMA && tgBtn) sendReelToTg(blob, type, d.m.match_id, tgBtn); // в мини-приложении шлём сразу — ради этого его и открыли
}

/* ---------- отправка ролика в Telegram через бота ---------- */
const TMA = new URLSearchParams(location.search).has('tma');
// Подпись Telegram приходит в #hash; сайт потом переписывает адрес, поэтому забираем её сразу.
const TMA_INIT = TMA ? new URLSearchParams(location.hash.slice(1)).get('tgWebAppData') : null;
let tmaReady = null;
function loadTma() {
  if (!TMA) return Promise.resolve(null);
  return tmaReady ||= new Promise(res => {
    const sc = document.createElement('script'); sc.src = 'https://telegram.org/js/telegram-web-app.js';
    sc.onload = () => { const w = window.Telegram?.WebApp; try { w?.ready(); w?.expand(); w?.setHeaderColor?.('#07080c'); w?.setBackgroundColor?.('#07080c'); } catch {} res(w || null); };
    sc.onerror = () => res(null);
    document.head.appendChild(sc);
  });
}
loadTma();
// Окно мини-приложения открываем сами, когда матч загрузится: не зависим от того, какой app.js отдал кэш.
if (TMA) {
  const t0 = Date.now(), iv = setInterval(() => {
    if (S.match && !document.querySelector('.modal.reel')) { clearInterval(iv); offerReel(); }
    else if (Date.now() - t0 > 30000) clearInterval(iv);
  }, 300);
}

async function sendReelToTg(blob, type, id, btn) {
  const st = document.getElementById('reelSt');
  btn.disabled = true; btn.textContent = 'Отправляем…'; if (st) st.textContent = 'Отправляем видео в Telegram…';
  track('reel_tg');
  try {
    const w = await loadTma();
    const headers = { 'content-type': type };
    if (w?.initData || TMA_INIT) headers['x-tg-init'] = w?.initData || TMA_INIT;
    else if (globalThis.Account?.sid) headers.authorization = 'Bearer ' + Account.sid;
    const r = await fetch(`${CONFIG.apiUrl}/api/reel?match=${id}`, { method: 'POST', headers, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'Не получилось отправить');
    track('reel_tg_ok');
    btn.textContent = '✅ Видео в чате с ботом';
    if (st) st.textContent = 'Готово! Видео уже в Telegram — перешли его в чат пати.';
    if (w) { try { w.HapticFeedback?.notificationOccurred('success'); } catch {} setTimeout(() => w.close(), 1800); }
  } catch (e) {
    btn.disabled = false; btn.textContent = '📲 Прислать ещё раз';
    if (st) st.textContent = e.message;
  }
}

// Из ссылки бота (?reel=1): запись стартует только по нажатию — иначе браузер не даст звук.
function offerReel() {
  modal(`<div class="pwHead"><h2>🎬 Видео-хайлайт матча</h2><p>Вертикальный ролик на 20 секунд: счёт, герой, золото, ключевые моменты и вердикт. ${TMA ? 'Соберу и пришлю его в чат с ботом.' : 'Для Stories и чата пати.'}</p></div>
    <div class="reelBtns"><button class="primary" id="reelGo">${TMA ? '▶ Собрать и прислать в чат' : '▶ Собрать видео'}</button></div>`, 'reel');
  document.getElementById('reelGo').addEventListener('click', () => openReel());
}
globalThis.openReel = openReel;
globalThis.offerReel = offerReel;
