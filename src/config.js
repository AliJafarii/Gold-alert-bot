const fs = require('fs');
const path = require('path');
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

function mapEnv(name, fallback = '') {
  const entries = {};
  for (const item of listEnv(name, fallback)) {
    const [key, value] = item.split(':').map((part) => part && part.trim());
    const number = Number(value);
    if (key && Number.isFinite(number) && number > 0) entries[key.toLowerCase()] = number;
  }
  return entries;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readEnvValue(file, key) {
  try {
    if (!file || !fs.existsSync(file)) return '';
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=(.*)$', 'm'));
    if (!match) return '';
    return match[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

function envOrFile(name, file) {
  return process.env[name] || readEnvValue(file, name);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function numberSetting(settings, key, fallback) {
  const value = Number(settings[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const runtimeSettingsFile = process.env.RUNTIME_SETTINGS_FILE || '/root/gold-alert-bot/data/runtime-settings.json';
const runtimeSettings = readJson(runtimeSettingsFile, {});
const telegramUserEnvFile = process.env.TELEGRAM_USER_ENV_FILE || '/root/telegram-keyword-bot/.env.production';

const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  adminChatIds: listEnv('ADMIN_CHAT_IDS', process.env.TELEGRAM_CHAT_ID || ''),
  baleBotToken: process.env.BALE_BOT_TOKEN || '',
  baleChatId: process.env.BALE_CHAT_ID || '',
  baleAdminChatIds: listEnv('BALE_ADMIN_CHAT_IDS', process.env.BALE_CHAT_ID || ''),
  baleApiBaseUrl: process.env.BALE_API_BASE_URL || 'https://tapi.bale.ai/bot',
  telegramBotUrl: process.env.TELEGRAM_BOT_URL || 'https://t.me/goldpricealertingbot',
  baleBotUrl: process.env.BALE_BOT_URL || 'https://ble.ir/nbzbazarbot',
  tgjuGoldSymbol: process.env.TGJU_GOLD_SYMBOL || 'geram18',
  tgjuCoinSymbol: process.env.TGJU_COIN_SYMBOL || 'sekee',
  tgjuBaharCoinSymbol: process.env.TGJU_BAHAR_COIN_SYMBOL || 'sekeb',
  tgjuHalfCoinSymbol: process.env.TGJU_HALF_COIN_SYMBOL || 'nim',
  tgjuQuarterCoinSymbol: process.env.TGJU_QUARTER_COIN_SYMBOL || 'rob',
  tgjuGramCoinSymbol: process.env.TGJU_GRAM_COIN_SYMBOL || 'gerami',
  tgjuUsdSymbol: process.env.TGJU_USD_SYMBOL || 'price_dollar_rl',
  tgjuOunceSymbol: process.env.TGJU_OUNCE_SYMBOL || 'ons',
  tgjuSilverSymbol: process.env.TGJU_SILVER_SYMBOL || 'silver_999',
  tgjuSilverOunceSymbol: process.env.TGJU_SILVER_OUNCE_SYMBOL || 'silver',
  enabledSources: (process.env.ENABLED_SOURCES || 'tgju,tala')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  coinWeightGrams: numberEnv('COIN_WEIGHT_GRAMS', 8.133),
  baharCoinWeightGrams: numberEnv('BAHAR_COIN_WEIGHT_GRAMS', 8.133),
  halfCoinWeightGrams: numberEnv('HALF_COIN_WEIGHT_GRAMS', 4.066),
  quarterCoinWeightGrams: numberEnv('QUARTER_COIN_WEIGHT_GRAMS', 2.033),
  gramCoinWeightGrams: numberEnv('GRAM_COIN_WEIGHT_GRAMS', 1.01),
  coinPurity: numberEnv('COIN_PURITY', 0.9),
  goldPricePurity: numberEnv('GOLD_PRICE_PURITY', 0.75),
  buyBubblePercent: numberEnv('BUY_BUBBLE_PERCENT', -5),
  sellBubblePercent: numberEnv('SELL_BUBBLE_PERCENT', 5),
  checkIntervalMinutes: numberEnv('CHECK_INTERVAL_MINUTES', 5),
  sendStartupMessage: boolEnv('SEND_STARTUP_MESSAGE', true),
  alwaysSendReport: boolEnv('ALWAYS_SEND_REPORT', false),
  historyFile: process.env.HISTORY_FILE || '/root/gold-alert-bot/data/history.jsonl',
  databaseFile: process.env.DATABASE_FILE || '/root/gold-alert-bot/data/gold-alert-bot.sqlite',
  defaultNotificationIntervalMinutes: numberEnv('DEFAULT_NOTIFICATION_INTERVAL_MINUTES', 60),
  adminAlertStateFile: process.env.ADMIN_ALERT_STATE_FILE || '/root/gold-alert-bot/data/admin-alert-state.json',
  sourceMaxAgeHours: numberEnv('SOURCE_MAX_AGE_HOURS', 12),
  sourceDropMaxAgeDays: numberEnv('SOURCE_DROP_MAX_AGE_DAYS', 30),
  snapshotCacheTtlSeconds: numberEnv('SNAPSHOT_CACHE_TTL_SECONDS', 90),
  snapshotRefreshIntervalSeconds: numberEnv('SNAPSHOT_REFRESH_INTERVAL_SECONDS', 60),
  channelSourceMaxAgeHours: numberSetting(
    runtimeSettings,
    'channelSourceMaxAgeHours',
    numberEnv('CHANNEL_SOURCE_MAX_AGE_HOURS', 2)
  ),
  sourceOutlierPercent: numberEnv('SOURCE_OUTLIER_PERCENT', 6),
  externalSourcesFile: process.env.EXTERNAL_SOURCES_FILE || '/root/gold-alert-bot/data/external-sources.json',
  runtimeSettingsFile,
  tradingViewTickers: process.env.TRADINGVIEW_TICKERS || 'TVC:GOLD,TVC:SILVER,OANDA:XAUUSD',
  tradingViewGoldTicker: process.env.TRADINGVIEW_GOLD_TICKER || 'TVC:GOLD',
  tradingViewSilverTicker: process.env.TRADINGVIEW_SILVER_TICKER || 'TVC:SILVER',
  baleMarketChannels: listEnv('BALE_MARKET_CHANNELS', 'akhbardollar'),
  telegramMarketChannels: listEnv('TELEGRAM_MARKET_CHANNELS', process.env.TELEGRAM_DOLLAR_CHANNELS || ''),
  telegramDollarChannels: (process.env.TELEGRAM_DOLLAR_CHANNELS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  telegramDealChannels: listEnv('TELEGRAM_DEAL_CHANNELS', ''),
  telegramDealInviteUrl: process.env.TELEGRAM_DEAL_INVITE_URL || '',
  tetherWebSourceNames: listEnv('TETHER_WEB_SOURCE_NAMES', ''),
  telegramDollarMaxAgeHours: numberEnv('TELEGRAM_DOLLAR_MAX_AGE_HOURS', 8),
  telegramDollarSampleSize: numberEnv('TELEGRAM_DOLLAR_SAMPLE_SIZE', 10),
  telegramDollarSampleSizeOverrides: mapEnv('TELEGRAM_DOLLAR_SAMPLE_SIZE_OVERRIDES', 'ParsianSarafi:30'),
  analysisOnlySourceNames: listEnv('ANALYSIS_ONLY_SOURCE_NAMES', 'telegram-dollar-ParsianSarafi'),
  telegramUserEnvFile,
  telegramApiId: Number(envOrFile('API_ID', telegramUserEnvFile) || 0),
  telegramApiHash: envOrFile('API_HASH', telegramUserEnvFile),
  telegramSessionString: envOrFile('SESSION_STRING', telegramUserEnvFile),
  telegramUserSourceLimit: numberEnv('TELEGRAM_USER_SOURCE_LIMIT', 80),
  telegramUserSourceLimitOverrides: mapEnv('TELEGRAM_USER_SOURCE_LIMIT_OVERRIDES', 'ParsianSarafi:200'),
  telegramMtprotoInitTimeoutMs: numberEnv('TELEGRAM_MTPROTO_INIT_TIMEOUT_MS', 30000)
};

function setRuntimeConfig(key, value) {
  config[key] = value;
  const current = readJson(config.runtimeSettingsFile, {});
  const runtimeKey = key === 'channelSourceMaxAgeHours' ? 'channelSourceMaxAgeHours' : key;
  writeJson(config.runtimeSettingsFile, { ...current, [runtimeKey]: value });
  return config;
}

module.exports = { config, setRuntimeConfig };
