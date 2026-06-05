const { fetchTgjuPrices } = require('./tgju');
const { fetchExternalSources } = require('./external-sources');
const { fetchTelegramDollarSources } = require('./telegram-dollar');
const { fetchTradingViewData } = require('./tradingview');

function parseLocalizedNumber(raw) {
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const normalized = String(raw || '')
    .replace(/[۰-۹]/g, (char) => String(persianDigits.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String(arabicDigits.indexOf(char)))
    .replace(/[,\s٬]/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeNearReference(value, reference) {
  if (!reference || !value) return value;
  let normalized = value;
  while (normalized < reference / 3) normalized *= 10;
  while (normalized > reference * 3) normalized /= 10;
  return normalized;
}

async function fetchTgjuSource(config) {
  const prices = await fetchTgjuPrices([
    config.tgjuGoldSymbol,
    config.tgjuCoinSymbol,
    config.tgjuUsdSymbol,
    config.tgjuOunceSymbol,
    config.tgjuSilverSymbol,
    config.tgjuSilverOunceSymbol
  ]);
  const gold = prices.get(config.tgjuGoldSymbol);
  const coin = prices.get(config.tgjuCoinSymbol);
  const dollar = prices.get(config.tgjuUsdSymbol);
  const ounce = prices.get(config.tgjuOunceSymbol);
  const silver = prices.get(config.tgjuSilverSymbol);
  const silverOunce = prices.get(config.tgjuSilverOunceSymbol);
  return {
    name: 'tgju',
    gold18Price: gold.price,
    coinPrice: coin.price,
    dollarToman: dollar.price / 10,
    ounceUsd: ounce.price,
    silverPrice: silver.price,
    silverOunceUsd: silverOunce.price,
    updatedAt: coin.updatedAt || gold.updatedAt
  };
}

async function fetchTalaGoldSource(referenceGoldPrice) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch('https://www.tala.ir/price/18k/13', {
      headers: { 'user-agent': 'gold-alert-bot/1.0 Mozilla/5.0' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error('tala.ir request failed: ' + response.status);
  const html = await response.text();
  const match = html.match(/آخرین قیمت[\s\S]{0,300}?<h3[^>]*>([^<]+)<\/h3>/);
  if (!match) throw new Error('tala.ir price not found');
  return {
    name: 'tala',
    gold18Price: normalizeNearReference(parseLocalizedNumber(match[1]), referenceGoldPrice),
    coinPrice: null,
    updatedAt: null
  };
}

async function fetchTajnoghrehSilverSource() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch('https://tajnoghreh.com/silver-price/', {
      headers: { 'user-agent': 'gold-alert-bot/1.0 Mozilla/5.0' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error('tajnoghreh request failed: ' + response.status);
  const html = await response.text();
  const match = html.match(/قیمت نقره 999[\s\S]{0,250}?sheyda_hamarz_currency_value_value">([^<]+)<\/span>/)
    || html.match(/نقره 999[\s\S]{0,250}?sheyda_hamarz_table_content-price"[^>]*>([0-9۰-۹٠-٩,٬]+)/);
  if (!match) throw new Error('tajnoghreh silver price not found');
  const silverToman = parseLocalizedNumber(match[1]);
  if (!silverToman) throw new Error('tajnoghreh silver price was invalid');
  return {
    name: 'tajnoghreh',
    gold18Price: null,
    coinPrice: null,
    silverPrice: silverToman * 10,
    updatedAt: new Date().toISOString()
  };
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

async function fetchMarketSources(config) {
  const sourceNames = new Set(config.enabledSources);
  const samples = [];
  const errors = [];
  let tgju = null;
  let technical = null;

  if (sourceNames.has('tgju')) {
    try {
      tgju = await fetchTgjuSource(config);
      samples.push(tgju);
    } catch (error) {
      errors.push({ source: 'tgju', error: error.message });
    }
  }

  if (sourceNames.has('tala')) {
    try {
      samples.push(await fetchTalaGoldSource(tgju && tgju.gold18Price));
    } catch (error) {
      errors.push({ source: 'tala', error: error.message });
    }
  }

  if (sourceNames.has('tajnoghreh')) {
    try {
      samples.push(await fetchTajnoghrehSilverSource());
    } catch (error) {
      errors.push({ source: 'tajnoghreh', error: error.message });
    }
  }

  if (sourceNames.has('external')) {
    try {
      samples.push(...await fetchExternalSources());
    } catch (error) {
      errors.push({ source: 'external', error: error.message });
    }
  }

  if (sourceNames.has('tradingview')) {
    try {
      const tradingView = await fetchTradingViewData(config);
      samples.push(...tradingView.samples);
      technical = tradingView.technical;
    } catch (error) {
      errors.push({ source: 'tradingview', error: error.message });
    }
  }

  if (config.telegramDollarChannels.length) {
    try {
      samples.push(...await fetchTelegramDollarSources(config.telegramDollarChannels, {
        maxAgeHours: config.telegramDollarMaxAgeHours
      }));
    } catch (error) {
      errors.push({ source: 'telegram-dollar', error: error.message });
    }
  }

  const gold18Price = average(samples.map((sample) => sample.gold18Price));
  const coinPrice = average(samples.map((sample) => sample.coinPrice));
  const dollarToman = average(samples.map((sample) => sample.dollarToman));
  const ounceUsd = average(samples.map((sample) => sample.ounceUsd));
  const silverPrice = average(samples.map((sample) => sample.silverPrice));
  const silverOunceUsd = average(samples.map((sample) => sample.silverOunceUsd));
  if (!gold18Price) throw new Error('No usable gold price sources. Errors: ' + JSON.stringify(errors));
  if (!coinPrice) throw new Error('No usable coin price sources. Errors: ' + JSON.stringify(errors));
  if (!dollarToman) throw new Error('No usable dollar price sources. Errors: ' + JSON.stringify(errors));
  if (!ounceUsd) throw new Error('No usable ounce price sources. Errors: ' + JSON.stringify(errors));
  return { gold18Price, coinPrice, dollarToman, ounceUsd, silverPrice, silverOunceUsd, samples, errors, technical };
}

module.exports = { fetchMarketSources, parseLocalizedNumber, normalizeNearReference };
