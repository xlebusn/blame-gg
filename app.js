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

// Данные пользователя (история, пати, свой аккаунт, правки позиций).
// Вошёл через Telegram — хранятся на сервере (синхронизирует account.js), гость — только до закрытия вкладки.
const UD = {
  remote: null, onChange: null,
  get(k, d) { if (this.remote) return this.remote[k] ?? d; try { return JSON.parse(sessionStorage.getItem('blame.' + k)) ?? d; } catch { return d; } },
  set(k, v) { if (this.remote) { this.remote[k] = v; this.onChange?.(k); return; } try { sessionStorage.setItem('blame.' + k, JSON.stringify(v)); } catch {} }
};
// Свой аккаунт Dota: у вошедших — поле аккаунта на сервере.
const ME = {
  get() { return globalThis.Account?.me ? globalThis.Account.me.account_id || null : UD.get('me', null); },
  set(acc) { if (globalThis.Account?.me) globalThis.Account.setAccount(+acc); else UD.set('me', +acc); }
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
  const c = store.get('blame.const2', null);
  if (c && Date.now() - c.ts < 3 * 864e5) { Object.assign(S, { heroes: c.heroes, itemIds: c.itemIds, items: c.items }); return; }
  const [heroes, itemIds, items] = await Promise.all([
    getJSON(API + '/constants/heroes'), getJSON(API + '/constants/item_ids'), getJSON(API + '/constants/items')
  ]);
  const hs = {}, is = {};
  for (const [k, v] of Object.entries(heroes)) hs[k] = { name: v.localized_name, npc: v.name, img: v.img, icon: v.icon, roles: v.roles || [] };
  for (const [k, v] of Object.entries(items)) is[k] = { dname: v.dname, img: v.img };
  Object.assign(S, { heroes: hs, itemIds, items: is });
  store.set('blame.const2', { ts: Date.now(), heroes: hs, itemIds, items: is });
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

/* ---------- тон и архетипы ---------- */
let TONE = store.get('blame.tone', 'toxic');
const T = (polite, toxic) => TONE === 'toxic' ? toxic : polite;
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
const fill = (s, p) => s.replace(/\$\{(\w+)\}/g, (_, k) => ({
  deaths: p.deaths || 0, kills: p.kills || 0, assists: p.assists || 0, kp: Math.round(p.kp), gpm: fmt(p.gold_per_min),
  xpm: fmt(p.xp_per_min), lh: fmt(p.last_hits), nw: fmt(p.net_worth), td: fmt(p.tower_damage), dmg: fmt(p.hero_damage),
  heal: fmt(p.hero_healing), blame: p.blame, hero: H(p).name, name: pname(p)
})[k] ?? '');

// Первый подходящий архетип — главный ярлык игрока. Порядок важен: сначала яркие крайности, потом общие.
const ARCH = [
  { test: p => p.won && p.blame <= 18 && p.pos <= 3, tone: 'good', t: ['Тащил игру', 'ТАЩЕР'],
    polite: ['Вытащил матч: лучший по ключевым метрикам в команде.', 'Главный двигатель победы: фарм, урон и давление на карту.'],
    toxic: ['Затащил катку на спине, остальные просто рядом постояли.', 'Папа пришёл и раздал. Лоускиллы вокруг могут сказать спасибо.',
      '${kills} убийств на ${hero}. Вот так выглядит человек, который не ест клей.', 'Батя в здании. Остальные четверо — массовка с MMR.',
      'Взял игру за шкирку и унёс. Тиммейтам — по скриншоту на память.', 'Таких в пабе одна штука на десять игр. Сегодня повезло.',
      '${nw} нетворса и ни одного вопроса к игре. Смурф? Скорее всего.'] },
  { test: p => p.pos >= 4 && p.q.util >= .7 && p.blame <= 30, tone: 'good', t: ['Сильный саппорт', 'СВЯТОЙ САППОРТ'],
    polite: ['Вижен, лечение и ассисты: команда держалась на нём.', 'Образцовая игра на поддержке: ${assists} ассистов, сейвы и вижен.'],
    toxic: ['Варды, хил, сейвы. Не заслужил таких тиммейтов.', 'Единственный, кто зашёл в магазин не только за себя. Святой человек.',
      '${assists} ассистов. Мама-саппорт, кормила всю пати с ложечки.', 'Ставил варды, пока коры ставили рекорды по тупости.',
      'Такого саппорта надо беречь, а его опять оставили одного на линии.', 'Нимб над головой виден даже без обса.'] },
  { test: p => (p.deaths || 0) <= 2 && p.q.deaths >= .85 && p.q.fight >= .5, tone: 'good', t: ['Почти не умирал', 'НЕУБИВАЕМЫЙ'],
    polite: ['Всего ${deaths} смертей и при этом полезен в драках.', 'Отличная позиционка: дрался и выживал.'],
    toxic: ['${deaths} смертей за игру. Враги его вообще видели?', 'Позиционка от бога: дерётся и не дохнет. Учитесь, раки.',
      'Бессмертный. Аегис ему просто не нужен.', 'Играл так, будто у него не одна жизнь, а одна попытка. И не потратил.'] },
  { test: p => (p.deaths || 0) >= 8 && p.q.deaths < .2 && p.q.fight < .55, tone: 'bad', t: ['Слишком много смертей', 'ФИДЕР'],
    polite: ['Много смертей без отдачи: противник фармил на нём.', '${deaths} смертей и мало урона взамен. Каждая смерть — золото врагу.'],
    toxic: ['Курьер с золотом для врага. Доставка бесплатная, без выходных.', 'Умер ${deaths} раз. Враги уже думали, что это их нейтральный лагерь.',
      'Фидил так, что у врагов кончились слоты под предметы.', '${deaths} смертей. Таверна уже держит ему место у камина.',
      'Самый щедрый игрок матча: всё своё золото раздал врагам.', 'Респавн видел чаще, чем карту.',
      'Не фидер, а спонсор вражеского керри. Логотип можно на футболку.', 'Серый экран — его второй дом.'] },
  { test: p => p.pos <= 3 && p.q.farm < .3, tone: 'bad', t: ['Слабый фарм для кора', 'ЛОУ-ФАРМ КОР'],
    polite: ['Для своей позиции нафармил очень мало: ${gpm} GPM.', 'Кор без фарма: предметы пришли слишком поздно.'],
    toxic: ['Кор с фармом саппорта. ${gpm} GPM, даже пятёрка в шоке.', 'Проиграл линию, проиграл лес, проиграл игру. Руинер с самой линии.',
      '${lh} крипов за игру. Крипы его, видимо, тоже не заметили.', 'Позиция кор, фарм бомжа, амбиции керри.',
      'Слоты пустые, а мнение о тиммейтах уже есть.', 'Добивания — это не про него. Его стиль — смотреть, как крипы умирают сами.'] },
  { test: p => p.q.deaths < .3 && p.q.fight >= .65, tone: 'neutral', t: ['Брал драки на себя', 'КАМИКАДЗЕ'],
    polite: ['Часто умирал, но и урона в драках давал много.', 'Агрессивно: много урона, но и смертей многовато.'],
    toxic: ['Залетал первым и умирал первым, но урон хотя бы нёс. Мясо с пользой.', 'Берсерк без BKB: дамажил много, жил мало.',
      'Кнопку «назад» не нашёл, зато «вперёд» жал отлично.', 'Пушечное мясо, но мясо дорогое: ${dmg} урона.',
      'Шёл умирать красиво. Иногда получалось ещё и полезно.', 'Инициатор от слова «и так сойдёт».'] },
  { test: p => p.pos <= 3 && p.q.farm >= .6 && p.q.fight < .4, tone: 'bad', t: ['Фармил, но не дрался', 'AFK-ФАРМЕР'],
    polite: ['Фарм был, а в драках его не было.', '${nw} нетворса, но мало урона и участия в драках.'],
    toxic: ['Лес — его родной дом. Команда дралась 4 на 5, пока он чистил лагеря.', 'Нафармил на шесть слотов и ни разу не нажал их в драке. Крип-бот.',
      'Ждал лейта, который так и не наступил.', '${lh} крипов убил, героев — по праздникам.',
      'Фармил так, будто за крипов дают MMR.', 'Дракон в сокровищнице: золото копит, наружу не выходит.'] },
  { test: p => p.pos >= 4 && p.q.farm >= .75, tone: 'neutral', t: ['Много фарма для саппорта', 'САППОРТ-КЕРРИ'],
    polite: ['Для саппорта забрал много золота. Это может быть оправдано, если оно ушло в команду.'],
    toxic: ['Саппорт, который забыл, что он саппорт. ${gpm} GPM на четвёрке.', 'Отжал фарм у керри и даже не извинился.',
      'Пятёрка с мечтой стать керри. Мечта сбылась, игра — нет.', 'Варды не купил, зато купил себе Daedalus. Наверное.'] },
  { test: p => p.kp < 40, tone: 'bad', t: ['Мало участвовал в драках', 'НЕВИДИМКА'],
    polite: ['Участие в убийствах ${kp}%: часто был не там, где команда.', 'Слабо связан с командой: мало участия в убийствах.'],
    toxic: ['Участие в убийствах ${kp}%. Это был вообще ты или бот за тебя играл?', 'Пока команда дралась, он где-то гулял. Найден только в таблице после игры.',
      'Играл в свою отдельную Доту. Судя по KP — однопользовательскую.', 'Тиммейты думали, что у них 4 игрока и бот.',
      'Его не нашли даже с гемом.', 'Пинги на миникарте он воспринимал как фоновую музыку.'] },
  { test: p => p.pos >= 4 && p.q.util < .35, tone: 'bad', t: ['Мало помогал команде', 'ПАССАЖИР'],
    polite: ['Слабо на позиции саппорта: мало лечения, ассистов и вижена.'],
    toxic: ['Саппорт, который не саппортил. Варды так и остались в магазине.', 'Пятёрка-пассажир: прокатился всю игру и вышел.',
      'Купил ботинки, телепорт и чувство собственной важности.', 'Помог команде примерно как мебель.',
      'Вижн на карте был только тот, что у вышек.'] },
  { test: p => p.q.obj >= .8, tone: 'good', t: ['Давил строения', 'ПУШЕР'],
    polite: ['Сильно давил на вышки: ${td} урона по строениям.', 'Понимал, что игра про строения: много урона по вышкам.'],
    toxic: ['Единственный, кто помнил, что игра про трон, а не про KDA.', 'Ломал вышки, пока остальные выясняли, кто кого.',
      '${td} урона по строениям. Вышки ненавидят этого человека.', 'Пока все фармили KDA, он фармил вражескую базу.'] },
  { test: p => p.q.fight >= .8, tone: 'good', t: ['Ключевой урон', 'ДАМАГЕР'],
    polite: ['Один из главных источников урона: ${dmg} по героям.'],
    toxic: ['Нёс урон как не в себя: ${dmg} по героям. Батя в здании.', 'Дамаг на месте, к нему вопросов нет.',
      'Нажимал кнопки в правильном порядке. В этом пабе это редкость.', '${dmg} урона. Враги до сих пор прикладывают лёд.'] }
];

// Запасные ярлыки по индексу вины. У победителей и проигравших разные: «лоускилл» в выигранной игре звучит странно.
const FALLBACK_LOSE = [
  { max: 26, tone: 'good', t: ['Хорошая игра', 'НЕ ВИНОВАТ'], polite: ['Стабильно отыграл, поражение не на нём.', 'Сделал свою часть работы.'],
    toxic: ['Не тащил, но и не руинил. Для этой катки уже подвиг.', 'Его единственная ошибка — нажать «Найти игру» с этими людьми.',
      'Сделал всё, что мог. Остальные сделали всё, чтобы проиграть.', 'Не виноват. Просто стоял рядом с руинером.'] },
  { max: 47, tone: 'neutral', t: ['Средняя игра', 'СЕРЕДНЯК'], polite: ['Есть и плюсы, и минусы, ничего решающего.', 'Обычная игра без явных провалов и подвигов.'],
    toxic: ['Ни рыба ни мясо.', 'Был в игре. Больше сказать нечего.', 'Не затащил и не зарунил. Человек-ничья.',
      'Типичный паб-игрок: всё понемногу, ничего толком.', 'Спокойно проиграл и пошёл дальше. Дзен.', 'Ни одного яркого момента. Даже руинить лень.'] },
  { max: 999, tone: 'bad', t: ['Слабая игра', 'ЛОУСКИЛЛ'], polite: ['Индекс вины ${blame}: много метрик заметно ниже нормы.', 'Слабая игра сразу по нескольким направлениям.'],
    toxic: ['Индекс вины ${blame}. Тут даже комментировать больно.', 'Такая игра — это не ошибка, это стиль жизни.',
      'Лоускилл с подтверждённой квалификацией.', 'Играл на ${hero} так, будто впервые его видит.',
      'MMR явно куплен, причём со скидкой.', 'После такой игры ${hero} подаёт заявление о смене игрока.',
      'Посмотри реплей. Только не с тиммейтами, они тебя не простят.'] }
];
const FALLBACK_WIN = [
  { max: 22, tone: 'good', t: ['Хорошая игра', 'КРАСАВЧИК'], polite: ['Уверенная игра, вклад в победу.', 'Ровно и полезно, без провалов.'],
    toxic: ['Чётко отыграл. Без лишнего пафоса, просто красавчик.', 'Сделал работу и пошёл пить чай.', 'Надёжный как швейцарские часы.'] },
  { max: 40, tone: 'neutral', t: ['Средняя игра', 'СЕРЕДНЯК'], polite: ['Обычная игра. Победа общая, звёзд не хватал.'],
    toxic: ['Ни рыба ни мясо, но победа есть победа.', 'Плыл по течению, течение принесло к трону.', 'Был рядом, когда тащили. Тоже считается.'] },
  { max: 999, tone: 'bad', t: ['Слабая игра, но победа', 'НА БУКСИРЕ'], polite: ['Победили вопреки: индекс вины ${blame}.', 'Слабая игра, победу вытащили тиммейты.'],
    toxic: ['Затащили на буксире. Пусть скажет спасибо тиммейтам.', 'Индекс вины ${blame}, но победа. Удача — тоже скилл. Наверное.',
      'Пассажир бизнес-класса: ничего не сделал, но долетел.', 'Выиграл вопреки себе. Лучше не смотреть реплей.',
      'Повезло с тиммейтами. Им с ним — не очень.'] }
];
const CULPRIT_ROAST = [
  'Главный руинер катки. Вытащить было можно, но не с этим хуесосом в пати.',
  'Руинер сертифицированный. Можно смело кидать репорт.',
  'Лоускилл года. Команда играла 4 на 6.',
  'Этот парень купил аккаунт или ему его забустили? Вопрос открытый.',
  'Игру слил не рандом, игру слил конкретный человек. Вот он.',
  'Если бы руининг был киберспортом, это был бы TI.',
  'Пятеро вышли играть, четверо — за свою команду.',
  'Скриншот этой статистики можно сразу в мемы.',
  'Тот самый тиммейт, из-за которого ставят мьют всем.',
  'Ему бы в бот-матчи, там хотя бы обидеть некого.',
  'Low priority плачет по этому аккаунту.',
  'Руинил с душой, с огоньком. Профессионал своего дела.'
];
const fallbackOf = p => (p.won ? FALLBACK_WIN : FALLBACK_LOSE).find(x => p.blame <= x.max);
// Фраза без повторов внутри одного матча: перебираем пул начиная с seed.
function sayOnce(arr, seed, p) {
  for (let k = 0; k < arr.length; k++) { const s = fill(pick(arr, seed + k), p); if (!S.usedSays.has(s)) { S.usedSays.add(s); return s; } }
  return fill(pick(arr, seed), p);
}
function archetype(p) {
  const key = TONE + p.i; if (S.arch[key]) return S.arch[key];
  return (S.arch[key] = archetypeRaw(p));
}
function archetypeRaw(p) {
  const seed = (S.match?.match_id || 0) % 997 + p.i;
  const a = ARCH.find(x => x.test(p)) || fallbackOf(p);
  if (!p.won && p === losers()[0]) {
    // Руинер: общая прожарка + конкретика из его архетипа, если она негативная.
    const extra = a.tone === 'bad' ? ' ' + fill(pick(a.toxic, seed + 3), p) : '';
    return { tone: 'bad', title: T('Главный вклад в поражение', 'РУИНЕР'), sub: a.t[1],
      say: T(sayOnce(a.polite, seed, p), pick(CULPRIT_ROAST, seed) + extra) };
  }
  return { tone: a.tone, title: T(a.t[0], a.t[1]), say: sayOnce(TONE === 'toxic' ? a.toxic : a.polite, seed, p) };
}

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
  S.ps = ps; S.arch = {}; S.usedSays = new Set(); S.lines = {}; S.usedTpl = {};
  ps.forEach(p => { p.sections = []; p.final = p.blame; });
  if (typeof applyStory === 'function') applyStory();
  ps.forEach(p => { p.score = Math.min(99, Math.round(p.final)); });
}

const losers = () => S.ps.filter(p => !p.won).sort((a, b) => b.final - a.final || b.blame - a.blame);
const winners = () => S.ps.filter(p => p.won).sort((a, b) => a.blame - b.blame);
const isParsed = m => !!(m.od_data?.has_parsed || m.radiant_gold_adv?.length);

function confidence(top, second) {
  const gap = second ? top.final - second.final : 20;
  return Math.round(clamp(40 + Math.min(25, gap * 1.6) + (top.benchSrc === 'hero' ? 12 : 0) + (isParsed(S.match) ? 10 : 0) + (top.posSrc === 'линия' || S.override[top.i] ? 6 : 0), 30, 95));
}

// Формулировки плюсов и минусов: [фактор][bad|good][polite|toxic] → варианты.
// Переменные: low — в нижних N% игр, top — в топ-N%, worse — хуже, чем в N% игр, every — смерть раз в N минут.
const LINES = {
  farm: {
    bad: {
      polite: ['${gpm} GPM и ${lh} добиваний: это нижние ${low}% ${src}.', 'Фарм отстал: в ${worse}% ${src} золота больше, чем ${gpm} GPM.', '${lhpm} добивания в минуту, мало для ${posGen}. Предметы пришли поздно.'],
      toxic: ['${gpm} GPM. Крипы спокойно доживали до старости.', '${lh} добиваний за ${min} минут. Крипы в безопасности, пока он на линии.', 'Фарм уровня нижних ${low}% ${src}. Лес даже не знает его в лицо.']
    },
    good: {
      polite: ['${gpm} GPM: топ ${top}% ${src}.', 'Отличный фарм: ${lh} добиваний, ${nw} нетворса.', 'Быстро набрал золото: ${lhpm} добивания в минуту.',
        'Экономика в порядке: ${nw} нетворса к концу игры.', 'Фарм выше нормы: лучше, чем в ${better}% ${src}.'],
      toxic: ['${gpm} GPM, топ ${top}% ${src}. Крипы его боятся.', '${lh} крипов. Фарм-машина, без выходных.', '${nw} нетворса. Карманы трещат.',
        'Фармил так, что лес приходилось респавнить вне очереди.', '${lhpm} крипа в минуту. Руки помнят ласт-хит.', '${gpm} GPM. Золото к нему липло само.']
    }
  },
  xp: {
    bad: {
      polite: ['${xpm} XPM, к концу ${level} уровень: отставал по уровням.', 'Мало опыта: в ${worse}% ${src} качаются быстрее.', '${level} уровень за ${min} минут. Скиллы и таланты пришли с опозданием.'],
      toxic: ['${level} уровень к концу игры. Скиллы прокачаны наполовину, как и игра.', '${xpm} XPM. Опыт обходил его стороной.', 'Качался медленнее, чем в ${worse}% ${src}. Таверна — плохой тренер.']
    },
    good: {
      polite: ['${xpm} XPM: опережал соперников по уровням.', '${level} уровень, топ ${top}% по опыту среди ${src}.', 'Быстро качался: ключевые уровни раньше врагов.'],
      toxic: ['${level} уровень. Качался как на сервере с x2.', '${xpm} XPM. Опыт прилипал сам.', 'Топ ${top}% по опыту. Рано апнул всё, что можно.']
    }
  },
  fight: {
    bad: {
      polite: ['${dmg} урона (${share}% команды) и участие в ${kp}% убийств: мало для ${posGen}.', 'В драках был слабо заметен: всего ${share}% урона команды.', 'Участвовал только в ${kp}% убийств команды.'],
      toxic: ['${share}% урона команды. Тыкал врагов, как будто боялся сделать больно.', 'Участвовал в ${kp}% убийств. Остальные ${kpRest}% смотрел со стороны.', '${dmg} урона за ${min} минут. Крипы на линии наносят больше.',
        'В драках был как декорация: красиво стоял, ничего не делал.', '${share}% урона. Бил врагов перьями.', 'Прожимал кнопки куда угодно, только не во врагов.']
    },
    good: {
      polite: ['${dmg} урона (${share}% команды), участие в ${kp}% убийств.', 'Главный источник урона: ${share}% от всей команды.', 'Был почти в каждой драке: ${kp}% участия в убийствах.'],
      toxic: ['${share}% урона команды. Кнопки жал по делу.', '${dmg} урона. Враги до сих пор прикладывают лёд.', '${kp}% участия в убийствах. Без него не начиналась ни одна драка.']
    }
  },
  deaths: {
    bad: {
      polite: ['${deaths} смертей: чаще, чем в ${worse}% ${src}.', 'Умирал примерно раз в ${every} минуты, это дорого для ${posGen}.', '${deaths} смертей: каждая отдавала врагу золото и время.'],
      toxic: ['${deaths} смертей, раз в ${every} мин. Таймер респавна знает его лучше мамы.', 'Умирал чаще, чем в ${worse}% ${src}. Талант.', '${deaths} раз отлетел. Серый экран видел чаще, чем карту.',
        '${deaths} смертей. Байбек — для слабаков, у него таверна по подписке.', 'Ходил в лес без варда и с верой в лучшее. ${deaths} раз не повезло.', 'Умирал раз в ${every} минуты. Стабильность — признак мастерства.']
    },
    good: {
      polite: ['Всего ${deaths} смертей: топ ${top}% по выживаемости среди ${src}.', 'Аккуратная позиционка: ${deaths} смертей за ${min} минут.', 'Почти не давал врагу золота за себя: ${deaths} смертей.'],
      toxic: ['${deaths} смертей. Скользкий, как угорь.', 'Умер всего ${deaths} раз. Враги его ловили и не поймали.', 'Топ ${top}% по выживаемости. Знает, где кнопка «назад».']
    }
  },
  obj: {
    bad: {
      polite: ['${td} урона по строениям: давления на карту почти не было.', 'Мало урона по вышкам: в ${worse}% ${src} больше.', 'Строения почти не трогал, а игра заканчивается на троне.'],
      toxic: ['${td} урона по вышкам. Вышки о нём даже не слышали.', 'Вышки обходил стороной. Видимо, уважал архитектуру.', 'Строения? Не, не слышал. ${td} урона за игру.']
    },
    good: {
      polite: ['${td} урона по строениям: топ ${top}% ${src}.', 'Сильное давление на карту: ${td} по вышкам.', 'Превращал выигранные драки в снесённые строения.'],
      toxic: ['${td} по вышкам. Строитель наоборот.', 'Вышки ненавидят этого человека: ${td} урона.', 'Пока все гонялись за KDA, он сносил базу.']
    }
  },
  util: {
    bad: {
      polite: ['Мало помощи команде: ${assists} ассистов, ${heal} лечения${obsPart}.', 'Для ${posGen} слабо: мало ассистов, лечения и вижена.', 'Команда почти не чувствовала поддержки: ${assists} ассистов за игру.'],
      toxic: ['${assists} ассистов${obsPart}. Карта тёмная, как его будущее в этой игре.', 'Поддержка уровня «держитесь там».', 'Помогал команде примерно как мебель: ${assists} ассистов.']
    },
    good: {
      polite: ['${assists} ассистов, ${heal} лечения${obsPart}.', 'Сильная помощь команде: в ${kp}% убийств есть его вклад.', 'Держал команду живой и с виженом.',
        'Много ассистов (${assists}): был рядом почти в каждой драке.', 'Хорошая командная игра: участие в ${kp}% убийств.'],
      toxic: ['${assists} ассистов. Мама команды.', 'Сейвил, хилил, светил карту. Святой человек.', 'Без него команда бы ходила в темноте и без хп.',
        'В ${kp}% убийств засветился. Везде успел, всем помог.', '${assists} ассистов. Раздавал килы, как конфеты на Новый год.', 'Командный игрок, редкий вид в пабе.']
    }
  }
};
const POS_GEN = { 1: 'керри', 2: 'мида', 3: 'оффлейнера', 4: 'четвёрки', 5: 'пятёрки' };
const KEYS = Object.keys(FACTORS);

function factorInfo(p, k) {
  const d = Math.max(1, (S.match.duration || 60) / 60), q = p.q[k], dir = q < .5 ? 'bad' : 'good';
  const vars = {
    gpm: fmt(p.gold_per_min), xpm: fmt(p.xp_per_min), lh: fmt(p.last_hits), nw: fmt(p.net_worth), level: p.level || '?',
    dmg: fmt(p.hero_damage), share: Math.round(p.dmgShare), kp: Math.round(p.kp), kpRest: 100 - Math.round(p.kp),
    deaths: p.deaths || 0, assists: p.assists || 0, heal: fmt(p.hero_healing), td: fmt(p.tower_damage),
    obsPart: p.obs_placed != null ? `, ${p.obs_placed} обсов` : '',
    lhpm: ((p.last_hits || 0) / d).toFixed(1).replace('.', ','), min: Math.round(d), every: ((d / Math.max(1, p.deaths || 0))).toFixed(1).replace('.', ','),
    better: Math.round(q * 100), low: Math.max(1, Math.round(q * 100)), top: Math.max(1, Math.round((1 - q) * 100)), worse: Math.round((1 - q) * 100),
    src: p.benchSrc === 'hero' ? `игр на ${H(p).name}` : 'игроков матча', posGen: POS_GEN[p.pos]
  };
  // Кэш, чтобы на разных вкладках у игрока был один и тот же текст; внутри матча шаблон не повторяется, пока пул не кончится.
  const key = TONE + p.i + k; if (S.lines?.[key]) return S.lines[key];
  const pool = LINES[k][dir][TONE === 'toxic' ? 'toxic' : 'polite'];
  const seed = (S.match?.match_id || 0) % 991 + p.i;
  S.lines ||= {}; S.usedTpl ||= {};
  const used = S.usedTpl[TONE + k + dir] ||= new Set();
  let tpl = null;
  for (let j = 0; j < pool.length && !tpl; j++) if (!used.has(pick(pool, seed + j))) tpl = pick(pool, seed + j);
  if (!tpl) { used.clear(); tpl = pick(pool, seed); }
  used.add(tpl);
  return (S.lines[key] = tpl.replace(/\$\{(\w+)\}/g, (_, v) => vars[v] ?? ''));
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
      <button class="ghost small" data-act="saveMe" data-acc="${acc}">Это я</button><button class="ghost small" data-dossier="${acc}">Досье</button><button class="ghost small" data-party-add="${acc}" data-name="${esc(prof.personaname || acc)}">В пати</button></div>
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
    if (me && !ME.get()) ME.set(me);
    S.match = m; S.override = (UD.get('ovr', {}))[id] || {}; S.tab = 'verdict'; S.parse = ''; S.view = 'match';
    track('analyze_match', { parsed: isParsed(m) ? 1 : 0 });
    analyze();
    const myId = ME.get();
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
  const h = UD.get('history', []).filter(x => x.id !== m.match_id);
  h.unshift({ id: m.match_id, ts: Date.now(), hero: top?.hero_id, name: top ? pname(top) : '', score: `${m.radiant_score}:${m.dire_score}` });
  UD.set('history', h.slice(0, 30));
  renderHistory();
}
function renderHistory() {
  const h = UD.get('history', []).slice(0, 12);
  $('#history').innerHTML = h.length ? `<div class="histLabel">${globalThis.Account?.me ? 'Твои разборы' : 'Разборы в этой вкладке'}</div><div class="hist">${h.map(x => `<button class="chip" data-match="${x.id}">${img(heroIcon({ hero_id: x.hero }), 'hicon sm')}<span>${x.id}</span><small>${esc(x.score)}</small></button>`).join('')}</div>` : '';
}

/* ---------- рендер ---------- */
const RUIN = { label: 'Антирекорды матча', color: 'var(--f-ruin)' };
function stack(p, max = 80) {
  const ruin = (p.final || p.blame) - p.blame;
  return `<div class="stack" style="--w:${clamp((p.score ?? p.blame) / max) * 100}%">${Object.keys(p.parts).filter(k => p.parts[k] > .3).map(k => `<i style="flex:${p.parts[k]};background:${FACTORS[k].color}" title="${FACTORS[k].label}: +${p.parts[k].toFixed(0)}"></i>`).join('')}${ruin > 0 ? `<i style="flex:${ruin};background:${RUIN.color}" title="${RUIN.label}: +${ruin}"></i>` : ''}</div>`;
}
function ring(v, cls = '') {
  const r = 46, c = 2 * Math.PI * r, f = clamp(v / 80);
  return `<svg class="ring ${cls}" viewBox="0 0 110 110" aria-label="Индекс вины ${v}"><circle cx="55" cy="55" r="${r}" class="track"/><circle cx="55" cy="55" r="${r}" class="val" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 55 55)"/><text x="55" y="56">${v}</text><text x="55" y="76" class="sub">из 100</text></svg>`;
}
const legend = () => `<div class="legend">${[...Object.values(FACTORS), RUIN].map(f => `<span><i style="background:${f.color}"></i>${f.label}</span>`).join('')}</div>`;
const INDEX_HELP = 'Индекс вины 0–99: насколько игрок сыграл хуже типичной игры на своём герое и позиции (данные OpenDota), плюс по 6 очков за каждый антирекорд матча из «Как слили».';
const longName = n => n.length > 16 ? ' long' : n.length > 11 ? ' mid' : '';

function render() {
  $('#hero').classList.add('compact');
  const app = $('#app'), m = S.match;
  app.classList.remove('hidden');
  const parsed = isParsed(m);
  const team = t => S.ps.filter(p => p.team === t);
  const tabs = [['verdict', 'Вердикт'], ['story', 'Как слили'], ['all', T('Все игроки', 'Рак или тащер')], ['timeline', 'Ход игры'], ['players', 'Таблица'], ['me', 'Мой разбор']];
  app.innerHTML = `
  <div class="matchHead card">
    <div class="side rad ${m.radiant_win ? 'win' : ''}"><span class="tname">${esc(teamName(m, 'radiant'))}</span>${m.radiant_win ? '<span class="badge">Победа</span>' : ''}<div class="mini">${team('radiant').map(p => img(heroIcon(p), 'hicon', H(p).name)).join('')}</div></div>
    <div class="mid"><div class="score"><b class="rad">${m.radiant_score}</b><span>:</span><b class="dire">${m.dire_score}</b></div>
      <div class="meta">${mmss(m.duration)} · ${new Date(m.start_time * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} · #${m.match_id}</div>
      <div class="meta"><span class="pill ${parsed ? 'ok' : 'warn'}">${parsed ? 'Реплей разобран' : 'Только базовая статистика'}</span></div></div>
    <div class="side dire ${!m.radiant_win ? 'win' : ''}"><span class="tname">${esc(teamName(m, 'dire'))}</span>${!m.radiant_win ? '<span class="badge">Победа</span>' : ''}<div class="mini">${team('dire').map(p => img(heroIcon(p), 'hicon', H(p).name)).join('')}</div></div>
  </div>
  ${parsed ? '' : `<div class="banner"><div><b>Реплей не разобран.</b> Нет графика золота, драк и вардов, поэтому оценка менее точная. Разбор обычно занимает 1–5 минут.</div><button class="primary small" data-act="parse" ${S.parse ? 'disabled' : ''}>${S.parse ? esc(S.parse) : 'Разобрать реплей'}</button></div>`}
  <div class="tabbar"><nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}
</nav>
  <div class="tabtools"><button class="ghost small tone ${TONE}" data-act="tone" title="Тон текстов: культурно или с жаргоном">${T('🙂', '🤬')}<span class="lbl">${T('Культурно', 'Токсик')}</span></button><button class="primary small" data-act="share">Поделиться</button></div></div>
  <div id="tabBody"></div>`;
  renderTab();
}

function renderTab() {
  const body = $('#tabBody');
  body.innerHTML = ({ verdict: verdictTab, story: storyTab, all: allTab, players: playersTab, timeline: timelineTab, me: meTab })[S.tab]();
  if (S.tab === 'timeline') bindChart();
  if (S.tab === 'story') afterStory();
}

function verdictTab() {
  const m = S.match, L = losers(), W = winners(), top = L[0], second = L[1];
  const conf = confidence(top, second), gap = second ? top.final - second.final : 0;
  const weak = weakOf(top).slice(0, 3);
  const loseT = top.team, winT = loseT === 'radiant' ? 'dire' : 'radiant';
  const gapText = !second ? '' : gap >= 12 ? T(`Отрыв от следующего игрока ${gap} очков, так что вердикт уверенный.`, `Отрыв от следующего ${gap} очков. Руинер без конкурентов, можно репортить.`)
    : gap >= 5 ? T(`Следом идёт ${esc(pname(second))} (${esc(H(second).name)}), разница ${gap} очков. Проиграли скорее вдвоём.`, `Но и ${esc(pname(second))} на ${esc(H(second).name)} рядом, всего ${gap} очков. Сливали дуэтом.`)
      : T(`Разница со следующим всего ${gap} очков: вина распределена по команде, не вешай всё на одного.`, `Разница всего ${gap} очков. Тут не один руинер, тут вся пати лоускиллы.`);
  const mvp = W[0];
  const strongEnemy = mvp && avg(Object.values(mvp.q)) > .78 ? `Учти и соперника: ${esc(pname(mvp))} на ${esc(H(mvp).name)} сыграл лучше, чем в ${Math.round(avg(Object.values(mvp.q)) * 100)}% игр. Часть поражения — просто сильный противник.` : '';
  const lead = leadInfo(loseT);
  return `${turningBanner()}
  <div class="grid vgrid">
    <article class="card culprit">
      <div class="cbg" style="background-image:url('${esc(heroImg(top))}')"></div>
      <div class="ctop">
        <div class="label red">${T('Главный вклад в поражение', 'Руинер катки')}</div>
        <div class="who">${img(heroImg(top), 'hport', H(top).name)}<div><h2 class="nm${longName(pname(top))}" title="${esc(pname(top))}">${esc(pname(top))}</h2><div class="sub">${esc(H(top).name)} · ${posLabel(top.pos)} ${rankName(top.rank_tier) ? '· ' + rankName(top.rank_tier) : ''}</div>
          <div class="kda"><b>${top.kills}</b>/<b class="d">${top.deaths}</b>/<b>${top.assists}</b> · ${fmt(top.gold_per_min)} GPM · ${fmt(top.net_worth)} NW</div></div>
          ${ring(top.score)}</div>
      </div>
      ${TONE === 'toxic' ? `<p class="roast">«${esc(archetype(top).say)}»</p>` : ''}
      <p class="vtext">${verdictLead(top, weak)} ${gapText}</p>
      ${contextList([
        top.sections.length ? `${T('Подтверждается разбором матча', 'И это не только цифры')}: ${top.sections.map(x => `<b>${esc(x.toLowerCase())}</b>`).join(', ')}. <button class="linkbtn" data-tab="story">Как слили →</button>` : '',
        lead, strongEnemy])}
      <div class="reasons">${weak.map(k => `<div class="reason"><i style="background:${FACTORS[k].color}"></i><div><b>${FACTORS[k].label}</b><span>${esc(factorInfo(top, k))}</span></div><em>+${top.parts[k].toFixed(0)}</em></div>`).join('') || '<div class="empty">Явных провалов нет: индекс собран из мелких сигналов.</div>'}</div>
      <div class="cfoot"><span class="conf"><span class="bar"><i style="width:${conf}%"></i></span>Уверенность ${conf}%</span><button class="ghost small" data-me="${top.i}">Подробный разбор →</button></div>
    </article>

    <aside class="card ranking">
      <div class="label lrow">Индекс вины · ${esc(teamName(m, loseT))}<span class="info" title="${INDEX_HELP}" aria-label="${INDEX_HELP}">?</span></div>
      ${L.map((p, k) => `<button class="rrow ${k === 0 ? 'top' : ''}" data-me="${p.i}"><span class="rpos">${k + 1}</span>${img(heroIcon(p), 'hicon')}<span class="rname"><b>${esc(pname(p))}</b><small>${esc(H(p).name)} · Pos ${p.pos}${p.sections.length ? ` · <span class="secs" title="Антирекорды матча: ${esc(p.sections.join(', '))}">⚑${p.sections.length}</span>` : ''}</small></span>${stack(p)}<span class="rnum">${p.score}</span></button>`).join('')}
      ${legend()}
    </aside>
  </div>

  <div class="grid awards">
    ${(L[L.length - 1].score < 40 ? award('good', T('Не вини его', 'Единственный не рак'), L[L.length - 1], T('Лучший в проигравшей команде', 'Тащил как мог, но с такими тиммейтами без шансов')) : award('warn', T('Меньше всех виноват', 'Наименьшее зло'), L[L.length - 1], T('Лучший в проигравшей команде, но и у него хватает ошибок', 'Лучший из худших. Тоже не подарок, но остальные ещё хуже')))}
    ${second ? award('warn', T('Тоже постарался', 'Соруинер'), second, T('Второй по индексу вины', 'Помогал руинеру сливать')) : ''}
    ${award('mvp', T('MVP соперника', 'Батя соперников'), mvp, T(`${esc(teamName(m, winT))}: самая сильная игра`, 'Раздал всем и ушёл в закат'))}
  </div>`;
}

function allTab() {
  const m = S.match, lt = losers()[0].team;
  const short = (p, k) => factorInfo(p, k);
  const card = p => {
    const a = archetype(p), good = strongOf(p).slice(0, 3), bad = weakOf(p).slice(0, 3);
    return `<article class="card pcard2 ${a.tone}">
      <div class="aw">${img(heroImg(p), 'hport sm', H(p).name)}<div><b>${esc(pname(p))}</b><small>${esc(H(p).name)} · ${posLabel(p.pos)}</small></div><span class="bnum ${bcls(p)}">${p.score}</span></div>
      <div class="tags"><span class="tag ${a.tone}">${esc(a.title)}</span>${a.sub && TONE === 'toxic' && a.sub !== a.title ? `<span class="tag bad sub">${esc(a.sub)}</span>` : ''}</div>
      <p class="say">${esc(a.say)}</p>
      <div class="kd">${p.kills}/${p.deaths}/${p.assists} · ${fmt(p.gold_per_min)} GPM · ${kfmt(p.hero_damage || 0)} урона · KP ${Math.round(p.kp)}%</div>
      <div class="pm">
        ${good.map(k => `<div class="plus"><b>+ ${FACTORS[k].label}</b><span>${esc(short(p, k))}</span></div>`).join('')}
        ${bad.map(k => `<div class="minus"><b>− ${FACTORS[k].label}</b><span>${esc(short(p, k))}</span></div>`).join('')}
        ${!good.length && !bad.length ? '<div class="empty">Ровно по всем метрикам</div>' : ''}
      </div>
      <button class="ghost small" data-me="${p.i}">Подробнее →</button>
    </article>`;
  };
  const team = t => { const ps = S.ps.filter(p => p.team === t).sort((a, b) => t === lt ? b.score - a.score : a.score - b.score); const won = ps[0].won;
    return `<div class="thead2 ${t}"><b>${esc(teamName(m, t))}</b><span class="pill ${won ? 'ok' : 'bad'}">${won ? T('Победа', 'Затащили') : T('Поражение', 'Слили')}</span></div><div class="grid allgrid">${ps.map(card).join('')}</div>`; };
  return team(lt) + team(lt === 'radiant' ? 'dire' : 'radiant');
}

function contextList(items) {
  items = items.filter(Boolean);
  return items.length ? `<ul class="ctx">${items.map(x => `<li>${x}</li>`).join('')}</ul>` : '';
}

function verdictLead(p, weak) {
  const list = weak.length ? weak.map(k => `<b>${FACTORS[k].label.toLowerCase()}</b>`).join(', ') : '';
  const seed = (S.match?.match_id || 0) % 991;
  if (!list) return T('Явного провала нет: индекс собран из мелких недочётов по всем фронтам.', 'Провалился понемногу во всём сразу. Универсальный солдат руина.');
  return pick(TONE === 'toxic' ? [
    `Слил на ровном месте: ${list}.`, `Где всё пошло не так: ${list}.`, `Список претензий открывают ${list}.`, `Тиммейты будут вспоминать: ${list}.`
  ] : [
    `Сильнее всего индекс вины подняли: ${list}.`, `Основные проблемы игры: ${list}.`, `Больше всего очков вины набежало за ${list}.`, `Ключевые провалы: ${list}.`
  ], seed);
}

function award(tone, title, p, desc) {
  if (!p) return '';
  const st = strongOf(p)[0];
  return `<button class="card award ${tone}" data-me="${p.i}"><div class="label">${title}</div><div class="aw">${img(heroImg(p), 'hport sm')}<div><b>${esc(pname(p))}</b><small>${esc(H(p).name)} · ${posLabel(p.pos)}</small></div><span class="anum">${p.score}</span></div>
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
      <td><div class="plc"><button class="pl" data-me="${p.i}">${img(heroIcon(p), 'hicon')}<span><b>${esc(pname(p))}</b><small>${esc(H(p).name)}${rankName(p.rank_tier) ? ' · ' + rankName(p.rank_tier) : ''}</small></span></button>${p.account_id ? `<span class="ia"><button class="ib" data-dossier="${p.account_id}" title="Досье игрока" aria-label="Досье игрока">📁</button><button class="ib" data-party-add="${p.account_id}" data-name="${esc(pname(p))}" title="Добавить в пати" aria-label="Добавить в пати">＋</button></span>` : ''}</div></td>
      <td><select data-pos="${p.i}" aria-label="Позиция">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${p.pos === n ? 'selected' : ''}>${n} · ${POS[n]}</option>`).join('')}</select>${S.override[p.i] ? '<small class="src">вручную</small>' : `<small class="src">${p.posSrc}</small>`}</td>
      <td class="num">${p.kills}/<span class="d">${p.deaths}</span>/${p.assists}</td>
      <td class="num">${fmt(p.gold_per_min)}${chip(p.P.gpm.v)}</td>
      <td class="num">${fmt(p.xp_per_min)}${chip(p.P.xpm.v)}</td>
      <td class="num">${kfmt(p.hero_damage || 0)}${chip(p.P.hd.v)}</td>
      <td class="num">${kfmt(p.tower_damage || 0)}</td>
      <td><div class="items">${[0, 1, 2, 3, 4, 5].map(k => { const it = itemOf(p['item_' + k]); return it ? img(CDN + it.img, 'item', it.dname) : '<span class="item empty"></span>'; }).join('')}${(() => { const it = itemOf(p.item_neutral); return it ? img(CDN + it.img, 'item neutral', it.dname) : ''; })()}</div></td>
      <td><span class="bnum ${bcls(p)}">${p.score}</span></td></tr>`).join('')}
    </tbody></table></div></div>`;
  };
  const lt = losers()[0].team;
  return `<p class="hint top">Серые числа — перцентиль: лучше скольких процентов игр на этом герое. Позицию можно поменять — индекс пересчитается. 📁 — досье игрока, ＋ — добавить в пати.</p>
  ${table(lt)}${table(lt === 'radiant' ? 'dire' : 'radiant')}`;
}
const bcls = p => p.score >= 50 ? 'hi' : p.score >= 32 ? 'mid' : 'lo';
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
      return { t: o.time, kind: 'b', by: rad ? 'dire' : 'radiant', text: `${rad ? 'Тьма снесла' : 'Свет снёс'} ${what}` };
    }
    if (o.type === 'CHAT_MESSAGE_ROSHAN_KILL') return { t: o.time, kind: 'r', by: o.team === 2 ? 'radiant' : 'dire', text: `${o.team === 2 ? 'Свет убил' : 'Тьма убила'} Рошана` };
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
      <p class="hint">Поминутный график, драки, Рошан и снос строений появятся после разбора реплея — нажми «Разобрать реплей» над вкладками.</p></div>`;
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

function myPlace(p, place, n) {
  const seed = (S.match?.match_id || 0) % 991 + p.i;
  if (place === 1 && !p.won) return pick(T(['В этом матче у тебя самый высокий индекс вины в команде.', 'По модели ты главный в списке виноватых. Ниже разбор, что пошло не так.'],
    ['Ну что, руинер, давай разбираться.', 'Поздравляем, ты руинер этой катки. Ниже — за что.', 'Главный виновник найден, и это ты. Не плачь, читай ниже.']), seed);
  if (place === n) return pick(T(['У тебя самый низкий индекс вины в команде.', 'Ты сыграл лучше всех в своей команде.'],
    ['Ты лучший в своей пати. Планка, правда, низкая.', 'Самый невиноватый. Можно смело флеймить в чате.']), seed);
  const base = T(`Ты на ${place}-м месте из ${n} по индексу вины в команде.`, `${place}-й из ${n} по вине. Не руинер, но и не герой.`);
  return base + (p.won ? T(' Победа не отменяет ошибок, ниже то, что стоит подтянуть.', ' Выиграли, но есть над чем поработать.') : '');
}

function meTab() {
  if (S.meSlot == null) {
    const team = t => S.ps.filter(p => p.team === t);
    return `<div class="card"><div class="label">Кем ты играл в этом матче?</div><p class="hint">Выбери себя, и мы соберём личный разбор: сильные стороны, слабые места и что делать в следующей игре.</p>
    ${['radiant', 'dire'].map(t => `<div class="pickTeam"><small>${esc(teamName(S.match, t))}</small><div class="pickGrid">${team(t).map(p => `<button class="pickP" data-me="${p.i}">${img(heroImg(p), 'hport sm')}<b>${esc(pname(p))}</b><small>${esc(H(p).name)}</small></button>`).join('')}</div></div>`).join('')}</div>`;
  }
  const p = S.ps.find(x => x.i === S.meSlot), mates = S.ps.filter(x => x.team === p.team).sort((a, b) => b.score - a.score);
  const place = mates.indexOf(p) + 1, weak = weakOf(p).slice(0, 3), strong = strongOf(p).slice(0, 3);
  const myId = ME.get();
  return `<div class="grid megrid">
    <article class="card mecard">
      <div class="who">${img(heroImg(p), 'hport', H(p).name)}<div><div class="label ${p.won ? 'green' : 'red'}">${p.won ? 'Победа' : 'Поражение'}</div><h2 class="nm${longName(pname(p))}" title="${esc(pname(p))}">${esc(pname(p))}</h2><div class="sub">${esc(H(p).name)} · ${posLabel(p.pos)}</div>
      <div class="kda"><b>${p.kills}</b>/<b class="d">${p.deaths}</b>/<b>${p.assists}</b> · ${fmt(p.gold_per_min)} GPM · ${fmt(p.xp_per_min)} XPM</div></div>${ring(p.score)}</div>
      <p class="vtext">${myPlace(p, place, mates.length)}</p>
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
  return `BLAME.GG · матч ${m.match_id} · ${m.radiant_score}:${m.dire_score}\n${T('Главный вклад в поражение', 'Руинер катки')}: ${pname(top)} (${H(top).name}), индекс вины ${top.score}\n${L.map((p, k) => `${k + 1}. ${pname(p)} (${H(p).name}) — ${p.score}`).join('\n')}\n${shareUrl()}`;
}
function shareUrl() { return `${location.origin}${location.pathname}?match=${S.match.match_id}`; }
function tgShareLink() {
  const top = losers()[0];
  const text = T(`Кто слил катку? ${pname(top)} на ${H(top).name} — индекс вины ${top.score}`, `Руинер найден: ${pname(top)} на ${H(top).name}, индекс вины ${top.score} 💀`);
  return `https://t.me/share/url?url=${encodeURIComponent(shareUrl())}&text=${encodeURIComponent(text)}`;
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(() => btn.textContent = o, 1500); }
  catch { window.prompt('Скопируй', text); }
}
// opts: watermark — плашка бесплатной версии; caption — свой текст (BLAME+); style — 'dark' | 'poster'.
function exportPng(opts = {}) {
  const { watermark = false, caption = '', style = 'dark' } = opts;
  const m = S.match, L = losers(), top = L[0], c = document.createElement('canvas');
  c.width = 1200; c.height = 630; const x = c.getContext('2d');
  const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
  const grd = x.createLinearGradient(0, 0, 1200, 630);
  if (style === 'poster') { grd.addColorStop(0, '#3a0812'); grd.addColorStop(1, '#0b0d14'); } else { grd.addColorStop(0, '#0b0d14'); grd.addColorStop(1, '#1a0f16'); }
  x.fillStyle = grd; x.fillRect(0, 0, 1200, 630);
  x.fillStyle = '#ff4d5e'; x.font = '800 30px Unbounded, sans-serif'; x.fillText('BLAME.GG', 60, 80);
  if (style === 'poster') { x.fillStyle = '#ff4d5e'; x.font = '800 22px Unbounded, sans-serif'; x.textAlign = 'right'; x.fillText(T('ГЛАВНЫЙ ВИНОВНИК', 'РУИНЕР КАТКИ'), 1140, 80); x.textAlign = 'left'; }
  x.fillStyle = '#8a93a6'; x.font = '500 22px Inter, sans-serif'; x.fillText(`Матч ${m.match_id} · ${mmss(m.duration)} · ${m.radiant_score}:${m.dire_score}`, 60, 120);
  x.fillStyle = '#e8ecf3'; x.font = '700 46px Unbounded, sans-serif'; x.fillText(pname(top).slice(0, 22), 60, 205);
  x.fillStyle = '#8a93a6'; x.font = '500 26px Inter, sans-serif'; x.fillText(`${H(top).name} · ${posLabel(top.pos)} · индекс вины ${top.score}${top.sections?.length ? ` · антирекордов: ${top.sections.length}` : ''}`, 60, 248);
  let y0 = 310, step = 58;
  if (caption) {
    x.fillStyle = '#ff4d5e'; x.font = 'italic 600 26px Inter, sans-serif';
    let cap = '«' + caption.trim() + '»'; while (x.measureText(cap).width > 1080 && cap.length > 4) cap = cap.slice(0, -2) + '»';
    x.fillText(cap, 60, 292); y0 = 326; step = 52;
  }
  const fc = { farm: v('--f-farm'), xp: v('--f-xp'), fight: v('--f-fight'), deaths: v('--f-deaths'), obj: v('--f-obj'), util: v('--f-util'), ruin: v('--f-ruin') };
  L.forEach((p, k) => {
    const y = y0 + k * step; x.fillStyle = '#e8ecf3'; x.font = '600 24px Inter, sans-serif'; x.fillText(`${pname(p).slice(0, 16)}`, 60, y + 22);
    x.fillStyle = '#8a93a6'; x.font = '500 18px Inter, sans-serif'; x.fillText(H(p).name, 60, y + 44);
    let cx = 340; const total = 760 * clamp(p.score / 80);
    const parts = { ...p.parts, ruin: (p.final || p.blame) - p.blame };
    const sum = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
    for (const k2 in parts) { const w = total * parts[k2] / sum; x.fillStyle = fc[k2] || '#888'; x.fillRect(cx, y + 8, Math.max(0, w - 2), 26); cx += w; }
    x.fillStyle = '#e8ecf3'; x.font = '700 26px Inter, sans-serif'; x.fillText(String(p.score), cx + 14, y + 31);
  });
  const site = (location.host + location.pathname).replace(/\/$/, '');
  if (watermark) {
    x.fillStyle = 'rgba(255, 77, 94, .92)'; x.fillRect(0, 594, 1200, 36);
    x.fillStyle = '#fff'; x.font = '700 18px Inter, sans-serif'; x.fillText(`BLAME.GG FREE · ${site} · без этой плашки — в BLAME+`, 60, 618);
  } else { x.fillStyle = '#5d6679'; x.font = '500 16px Inter, sans-serif'; x.textAlign = 'right'; x.fillText(site, 1140, 612); x.textAlign = 'left'; }
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
  if (b.dataset.tab) { S.tab = b.dataset.tab; track('open_' + S.tab); document.querySelectorAll('.tabs [data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === S.tab)); if (!b.closest('.tabs')) document.querySelector('.tabs').scrollIntoView({ behavior: 'smooth' }); return renderTab(); }
  if (b.dataset.me != null && !b.dataset.act) { S.meSlot = +b.dataset.me; S.tab = 'me'; return render(); }
  if (b.dataset.match) return loadMatch(b.dataset.match, b.dataset.acc);
  if (b.dataset.acc && !b.dataset.act) return showPlayer(b.dataset.acc);
  const act = b.dataset.act;
  if (act === 'parse') return requestParse();
  if (act === 'tone') { TONE = TONE === 'toxic' ? 'polite' : 'toxic'; store.set('blame.tone', TONE); S.arch = {}; S.lines = {}; S.usedSays = new Set(); S.usedTpl = {}; return S.view === 'match' && S.match ? render() : globalThis.rerenderView?.(); }
  if (act === 'pickOther') { S.meSlot = null; return renderTab(); }
  if (act === 'demo') { track('demo'); $('#q').value = DEMO_MATCH; setMode('match'); return loadMatch(DEMO_MATCH); }
  if (act === 'modePlayer') { setMode('player'); $('#q').focus(); return; }
  if (act === 'saveMe') { ME.set(+b.dataset.acc); b.textContent = 'Сохранено'; updateMeBtn(); return; }
});
document.addEventListener('change', e => {
  const s = e.target.closest('select[data-pos]'); if (!s) return;
  const me = S.ps.find(p => p.i === +s.dataset.pos), to = +s.value;
  const other = S.ps.find(p => p.team === me.team && p.pos === to && p !== me);
  if (other) S.override[other.i] = me.pos; // меняем позиции местами, чтобы не было двух «троек»
  S.override[me.i] = to;
  UD.set('ovr', { ...UD.get('ovr', {}), [S.match.match_id]: S.override });
  analyze(); renderTab();
});
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); onSearch($('#q').value); });
$('#meBtn').addEventListener('click', () => {
  const me = ME.get();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setMode('player');
  if (me) showPlayer(me); else { $('#q').focus(); setStatus('Найди себя по нику или Steam ID, потом нажми «Это я»'); }
});
function updateMeBtn() { const b = $('#meBtn'); if (b) b.innerHTML = `<span class="ico">🎮</span><span class="lbl">${ME.get() ? 'Мои матчи' : 'Найти себя'}</span>`; }

const DEMO_MATCH = '9044969969';
updateMeBtn();
renderHistory();
const qp = new URLSearchParams(location.search);
if (qp.get('match')) { $('#q').value = qp.get('match'); loadMatch(qp.get('match')); }
else if (qp.get('player')) { setMode('player'); showPlayer(qp.get('player')); }
