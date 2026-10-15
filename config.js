// Настройки, которые владелец меняет без правки логики.
const CONFIG = {
  // Сервер BLAME+ (Cloudflare Worker из blame-gg-bot): проверка личных кодов. Локально — wrangler dev.
  apiUrl: location.hostname === 'localhost' ? 'http://127.0.0.1:8787' : 'https://blame-gg-bot.blame-gg-bot.workers.dev',
  // Бот, где покупают подписку и получают код.
  botUrl: 'https://t.me/blamedota_bot',
  // Страница подписки BLAME+ на Boosty (уровень за 149 ₽/мес).
  boostyUrl: 'https://boosty.to/xlebus_pm',
  // Куда ведёт кнопка «Поддержать проект» (разовый донат).
  donateUrl: 'https://boosty.to/xlebus_pm',
  price: '100 ⭐/мес',
  priceYear: '1290 ₽/год',
  // ID счётчика Яндекс Метрики. null — аналитика выключена.
  metrikaId: null,
  // Лимиты пати.
  partyFree: 5,
  partyPlus: 10
};
