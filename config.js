// Настройки, которые владелец меняет без правки логики.
const CONFIG = {
  // Сервер BLAME+ (Cloudflare Worker из blame-gg-bot): вход, аккаунт, подписка. Локально — wrangler dev.
  apiUrl: location.hostname === 'localhost' ? 'http://127.0.0.1:8787' : 'https://blame-gg-bot.blame-gg-bot.workers.dev',
  // Бот: вход на сайт, покупка подписки, авто-разбор.
  botUsername: 'blamedota_bot',
  botUrl: 'https://t.me/blamedota_bot',
  // Страница подписки BLAME+ на Boosty.
  boostyUrl: 'https://boosty.to/xlebus_pm',
  // Кнопка «Поддержать проект»: перевод через Альфа-Банк.
  donateUrl: 'https://www.alfabank.by/share?transferLinkId=6ad0eaba9c5463219c63c802&version=INSNC3',
  price: '100 ⭐/мес',
  priceBoosty: '149 ₽/мес',
  // ID счётчика Яндекс Метрики. null — аналитика выключена.
  metrikaId: null,
  // Лимиты пати.
  partyFree: 5,
  partyPlus: 10
};
