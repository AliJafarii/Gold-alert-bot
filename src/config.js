require('dotenv').config();

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error('Invalid numeric env ' + name + ': ' + raw);
  }
  return value;
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function listEnv(name, fallback = '') {
  return (process.env[name] || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  adminChatIds: listEnv('ADMIN_CHAT_IDS', process.env.TELEGRAM_CHAT_ID || ''),
  tgjuGoldSymbol: process.env.TGJU_GOLD_SYMBOL || 'geram18',
  tgjuCoinSymbol: process.env.TGJU_COIN_SYMBOL || 'sekee',
  tgjuUsdSymbol: process.env.TGJU_USD_SYMBOL || 'price_dollar_rl',
  tgjuOunceSymbol: process.env.TGJU_OUNCE_SYMBOL || 'ons',
  tgjuSilverSymbol: process.env.TGJU_SILVER_SYMBOL || 'silver_999',
  tgjuSilverOunceSymbol: process.env.TGJU_SILVER_OUNCE_SYMBOL || 'silver',
  enabledSources: (process.env.ENABLED_SOURCES || 'tgju,tala')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  coinWeightGrams: numberEnv('COIN_WEIGHT_GRAMS', 8.133),
  coinPurity: numberEnv('COIN_PURITY', 0.9),
  goldPricePurity: numberEnv('GOLD_PRICE_PURITY', 0.75),
  buyBubblePercent: numberEnv('BUY_BUBBLE_PERCENT', -5),
  sellBubblePercent: numberEnv('SELL_BUBBLE_PERCENT', 5),
  checkIntervalMinutes: numberEnv('CHECK_INTERVAL_MINUTES', 5),
  sendStartupMessage: boolEnv('SEND_STARTUP_MESSAGE', true),
  alwaysSendReport: boolEnv('ALWAYS_SEND_REPORT', false),
  historyFile: process.env.HISTORY_FILE || '/root/gold-alert-bot/data/history.jsonl',
  adminAlertStateFile: process.env.ADMIN_ALERT_STATE_FILE || '/root/gold-alert-bot/data/admin-alert-state.json',
  sourceMaxAgeHours: numberEnv('SOURCE_MAX_AGE_HOURS', 12),
  sourceOutlierPercent: numberEnv('SOURCE_OUTLIER_PERCENT', 6),
  externalSourcesFile: process.env.EXTERNAL_SOURCES_FILE || '/root/gold-alert-bot/data/external-sources.json',
  tradingViewTickers: process.env.TRADINGVIEW_TICKERS || 'TVC:GOLD,TVC:SILVER,OANDA:XAUUSD',
  tradingViewGoldTicker: process.env.TRADINGVIEW_GOLD_TICKER || 'TVC:GOLD',
  tradingViewSilverTicker: process.env.TRADINGVIEW_SILVER_TICKER || 'TVC:SILVER',
  baleMarketChannels: listEnv('BALE_MARKET_CHANNELS', 'akhbardollar'),
  telegramMarketChannels: listEnv('TELEGRAM_MARKET_CHANNELS', process.env.TELEGRAM_DOLLAR_CHANNELS || ''),
  telegramDollarChannels: (process.env.TELEGRAM_DOLLAR_CHANNELS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  telegramDollarMaxAgeHours: numberEnv('TELEGRAM_DOLLAR_MAX_AGE_HOURS', 8)
};

module.exports = { config };
