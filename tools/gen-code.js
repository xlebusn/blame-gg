#!/usr/bin/env node
// Генерирует код BLAME+ на месяц и дописывает его хэш в premium.js.
// Использование: node tools/gen-code.js 2026-11
// Сам код выводится в консоль: его нужно опубликовать в закрытом посте на Boosty. В репозиторий попадает только хэш.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const month = process.argv[2];
if (!/^\d{4}-\d{2}$/.test(month || '')) { console.error('Укажи месяц: node tools/gen-code.js 2026-11'); process.exit(1); }
const [y, m] = month.split('-').map(Number);
const until = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих 0/O и 1/I
const part = () => Array.from(crypto.randomBytes(4), b => ALPHA[b % ALPHA.length]).join('');
const code = `RUIN-${part()}-${part()}`;
const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = crypto.createHash('sha256').update('blame.gg:' + norm).digest('hex');

const file = path.join(__dirname, '..', 'premium.js');
const src = fs.readFileSync(file, 'utf8');
const line = `  { hash: '${hash}', until: '${until}' },\n  // codes:end`;
if (!src.includes('// codes:end')) { console.error('В premium.js нет метки // codes:end'); process.exit(1); }
fs.writeFileSync(file, src.replace('  // codes:end', line));

console.log(`Код на ${month} (действует до ${until} + 3 дня):\n\n    ${code}\n`);
console.log('Хэш добавлен в premium.js. Дальше: закоммить, запушить и опубликовать код в закрытом посте на Boosty.');
