const { fetchTgjuPrices } = require('./tgju');
const { fetchExternalSources } = require('./external-sources');
const { fetchBaleMarketSources, fetchTelegramMarketSources } = require('./channel-sources');
const { fetchTelegramDealDollarSources, fetchTelegramDollarSources } = require('./telegram-dollar');
const { fetchTradingViewData } = require('./tradingview');
const { parseLocalizedNumber } = require('./numbers');

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
    config.tgjuBaharCoinSymbol,
    config.tgjuHalfCoinSymbol,
    config.tgjuQuarterCoinSymbol,
    config.tgjuGramCoinSymbol,
    config.tgjuUsdSymbol,
    config.tgjuOunceSymbol,
    config.tgjuSilverSymbol,
    config.tgjuSilverOunceSymbol
  ]);
  const gold = prices.get(config.tgjuGoldSymbol);
  const coin = prices.get(config.tgjuCoinSymbol);
  const baharCoin = prices.get(config.tgjuBaharCoinSymbol);
  const halfCoin = prices.get(config.tgjuHalfCoinSymbol);
  const quarterCoin = prices.get(config.tgjuQuarterCoinSymbol);
  const gramCoin = prices.get(config.tgjuGramCoinSymbol);
  const dollar = prices.get(config.tgjuUsdSymbol);
  const ounce = prices.get(config.tgjuOunceSymbol);
  const silver = prices.get(config.tgjuSilverSymbol);
  const silverOunce = prices.get(config.tgjuSilverOunceSymbol);
  return {
    name: 'tgju',
    gold18Price: gold.price,
    coinPrice: coin.price,
    baharCoinPrice: baharCoin.price,
    halfCoinPrice: halfCoin.price,
    quarterCoinPrice: quarterCoin.price,
    gramCoinPrice: gramCoin.price,
    dollarToman: dollar.price / 10,
    ounceUsd: ounce.price,
    silverPrice: silver.price,
    silverOunceUsd: silverOunce.price,
    updatedAt: coin.updatedAt || gold.updatedAt
  };
}

async function fetchTalaGoldSource(referenceGoldPrice) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
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
  const timeout = setTimeout(() => controller.abort(), 8000);
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

function parseEstjtNumber(raw, options = {}) {
  let normalized = String(raw || '')
    .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
    .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
    .replace(/[٬,\s]/g, '');
  if (options.decimal) {
    normalized = normalized.replace(/٫/g, '.');
    return Number(normalized);
  }
  return parseLocalizedNumber(normalized.replace(/[.٫]/g, ''));
}

function pickEstjtPrice(text, label, options = {}) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text || '').match(new RegExp(escaped + '\\s+([$\\s]*)([0-9۰-۹٠-٩.,٫]+)'));
  const parsed = match ? parseEstjtNumber(match[2], options) : null;
  const value = Number.isFinite(options.divisor) && options.divisor > 0 ? parsed / options.divisor : parsed;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + jd;
  days += jm < 7 ? (jm - 1) * 31 : ((jm - 7) * 30) + 186;
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const gd = days + 1;
  const salA = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  let day = gd;
  for (gm = 1; gm <= 12 && day > salA[gm]; gm += 1) day -= salA[gm];
  return { gy, gm, gd: day };
}

function parseEstjtUpdatedAt(text) {
  const monthMap = {
    فروردین: 1,
    اردیبهشت: 2,
    خرداد: 3,
    تیر: 4,
    مرداد: 5,
    شهریور: 6,
    مهر: 7,
    آبان: 8,
    آذر: 9,
    دی: 10,
    بهمن: 11,
    اسفند: 12
  };
  const match = String(text || '').match(/آخرین بروزرسانی:\s*([0-9۰-۹٠-٩]+)\s+(\S+)\s+([0-9۰-۹٠-٩]+)\s*-\s*([0-9۰-۹٠-٩]{1,2}):([0-9۰-۹٠-٩]{1,2}):([0-9۰-۹٠-٩]{1,2})/);
  if (!match) return null;
  const day = parseLocalizedNumber(match[1]);
  const month = monthMap[match[2]];
  const year = parseLocalizedNumber(match[3]);
  const hour = parseLocalizedNumber(match[4]);
  const minute = parseLocalizedNumber(match[5]);
  const second = parseLocalizedNumber(match[6]);
  if (!day || !month || !year || hour === null || minute === null || second === null) return null;
  const gregorian = jalaliToGregorian(year, month, day);
  const date = new Date(Date.UTC(gregorian.gy, gregorian.gm - 1, gregorian.gd, hour - 3, minute - 30, second));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function fetchEstjtSource() {
  let response = null;
  let lastError = null;
  for (const url of ['https://www.estjt.ir/', 'https://estjt.ir/']) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      response = await fetch(url, {
        headers: { 'user-agent': 'gold-alert-bot/1.0 Mozilla/5.0' },
        signal: controller.signal
      });
      if (response.ok) break;
      lastError = new Error('estjt.ir request failed: ' + response.status);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!response || !response.ok) throw lastError || new Error('estjt.ir request failed');
  const html = await response.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const gold18Price = pickEstjtPrice(text, 'طلا ۱۸ عیار', { divisor: 10 });
  const coinPrice = pickEstjtPrice(text, 'سکه طرح جدید', { divisor: 10 });
  const ounceUsd = pickEstjtPrice(text, 'انس طلا', { decimal: true });
  if (!gold18Price && !coinPrice && !ounceUsd) {
    throw new Error('estjt.ir prices not found');
  }
  return {
    name: 'estjt',
    gold18Price,
    coinPrice,
    dollarToman: null,
    ounceUsd,
    updatedAt: parseEstjtUpdatedAt(text) || new Date().toISOString()
  };
}

async function fetchHtmlSource(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'gold-alert-bot/1.0 Mozilla/5.0' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error('request failed: ' + response.status);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function stripPageText(html) {
  return String(html || '')
    .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
    .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTetherTomanFromText(text) {
  const candidates = [];
  const normalized = stripPageText(text);
  const matches = [...normalized.matchAll(/(?:^|[^0-9])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,6})\s*(تومان)?/g)];
  for (const match of matches) {
    const value = Number(String(match[1]).replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 100000 || value > 300000) continue;
    const start = Math.max(0, match.index - 120);
    const end = Math.min(normalized.length, match.index + match[0].length + 120);
    const context = normalized.slice(start, end);
    const hasTetherContext = /تتر|USDT|Tether/i.test(context);
    const hasPriceContext = /قیمت|لحظه‌ای|تومان|IRT/i.test(context);
    const historicalContext = /تاریخچه|بیشترین|کمترین|رکورد|نظر|دیدگاه|پاسخ|روز گذشته|ماه گذشته/.test(context);
    if (hasTetherContext && hasPriceContext && !historicalContext) {
      candidates.push({ value, context });
    }
  }
  return candidates.length ? candidates[0].value : null;
}

function parseFirstNumber(pattern, text) {
  const normalized = stripPageText(text);
  const match = normalized.match(pattern);
  if (!match) return null;
  const value = Number(String(match[1]).replace(/,/g, ''));
  return Number.isFinite(value) && value >= 100000 && value <= 300000 ? value : null;
}

async function fetchTetherWebSource(name, url) {
  const html = await fetchHtmlSource(url);
  let value = null;
  if (name === 'nobitex-tether') {
    value = parseFirstNumber(/قیمت تتر\s+[+\-−]?\s*[0-9.]+\s*٪?\s+([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,6})\s*تومان/, html);
  } else if (name === 'bitpin-tether') {
    value = parseFirstNumber(/قیمت تتر[^0-9]{0,80}([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,6})\s*تومان/, html);
  } else if (name === 'okex-tether') {
    value = parseFirstNumber(/قیمت لحظه‌ای تتر\s+تومان\s+([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,6})/, html)
      || parseFirstNumber(/قیمت تتر به تومان\s+([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,6})/, html);
  }
  if (!value) value = parseTetherTomanFromText(html);
  if (!value && name === 'tabdeal') {
    const payloadMatch = html.match(/href="([^"]+_payload\.json[^"]*)"/);
    if (payloadMatch) {
      const payloadUrl = new URL(payloadMatch[1], url).href;
      value = parseTetherTomanFromText(await fetchHtmlSource(payloadUrl));
    }
  }
  if (!value) throw new Error('tether price not found');
  return {
    name,
    tetherToman: value,
    updatedAt: new Date().toISOString()
  };
}

function tetherWebSourceDefinitions(config) {
  return [
    ['tabdeal-tether', 'https://tabdeal.org/usdt-price'],
    ['nobitex-tether', 'https://nobitex.ir/price/usdt/'],
    ['isignal-tether', 'https://isignal.ir/cryptocurrency/tether/'],
    ['arzdigital-tether', 'https://arzdigital.com/coins/tether/'],
    ['tgju-tether', 'https://www.tgju.org/profile/crypto-tether'],
    ['bitpin-tether', 'https://bitpin.ir/coin/USDT/'],
    ['okex-tether', 'https://ok-ex.io/buy-and-sell/USDT/']
  ].filter(([name]) => !config.tetherWebSourceNames.length || config.tetherWebSourceNames.includes(name));
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function parseUpdatedAt(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const normalized = String(value).trim().replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function metricLabel(metric) {
  return {
    gold18Price: 'طلای ۱۸ عیار',
    coinPrice: 'سکه',
    baharCoinPrice: 'سکه بهار آزادی',
    halfCoinPrice: 'نیم سکه',
    quarterCoinPrice: 'ربع سکه',
    gramCoinPrice: 'سکه گرمی',
    dollarToman: 'دلار',
    tetherToman: 'تتر',
    ounceUsd: 'اونس جهانی طلا',
    silverPrice: 'نقره ۹۹۹',
    silverOunceUsd: 'اونس جهانی نقره'
  }[metric] || metric;
}

function sourceValueKey(source, metric) {
  return [source.name, metric, source[metric]].join(':');
}

function normalizeMetricScale(items, metric) {
  if (metric !== 'gold18Price' || items.length < 2) return [];

  const values = items.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ratio = max / min;
  if (ratio < 7 || ratio > 13) return [];

  const alerts = [];
  for (const item of items) {
    if (item.value >= max / 3) continue;
    const originalValue = item.value;
    const normalizedValue = originalValue * 10;
    item.value = normalizedValue;
    item.source[metric] = normalizedValue;
    alerts.push({
      key: 'scale:' + sourceValueKey(item.source, metric) + ':' + originalValue,
      source: item.source.name,
      metric,
      metricLabel: metricLabel(metric),
      value: normalizedValue,
      originalValue,
      reason: 'scale',
      message: 'منبع ' + item.source.name + ' برای ' + metricLabel(metric)
        + ' احتمالاً عدد را با مقیاس اشتباه داده بود؛ مقدار '
        + Math.round(originalValue).toLocaleString('fa-IR')
        + ' قبل از میانگین‌گیری به '
        + Math.round(normalizedValue).toLocaleString('fa-IR')
        + ' تبدیل شد.'
    });
  }
  return alerts;
}

function isSourceStale(source, maxAgeHours, now = Date.now()) {
  const updatedAt = parseUpdatedAt(source.updatedAt);
  if (!updatedAt || !maxAgeHours) return false;
  const ageHours = (now - updatedAt.getTime()) / 36e5;
  return ageHours > maxAgeHours ? ageHours : false;
}

function isChannelSource(source) {
  return /^telegram-|^bale-/.test(String(source && source.name || ''));
}

function sourceMaxAgeHours(source, config) {
  if (isChannelSource(source)) return config.channelSourceMaxAgeHours;
  return config.sourceMaxAgeHours;
}

function shouldDropSource(source, config) {
  const maxDays = Number(config.sourceDropMaxAgeDays || 0);
  if (!maxDays) return false;
  const updatedAt = parseUpdatedAt(source && source.updatedAt);
  if (!updatedAt) return false;
  return (Date.now() - updatedAt.getTime()) / 864e5 > maxDays;
}

function buildMetricAverage(samples, metric, config) {
  const values = samples
    .map((source) => ({ source, value: source[metric] }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0);

  const alerts = [];
  const accepted = [];
  const staleFiltered = [];
  const now = Date.now();

  alerts.push(...normalizeMetricScale(values, metric));

  for (const item of values) {
    const maxAgeHours = sourceMaxAgeHours(item.source, config);
    const ageHours = isSourceStale(item.source, maxAgeHours, now);
    if (ageHours) {
      staleFiltered.push(item);
      alerts.push({
        key: 'stale:' + sourceValueKey(item.source, metric),
        source: item.source.name,
        metric,
        metricLabel: metricLabel(metric),
        value: item.value,
        reason: 'stale',
        message: 'منبع ' + item.source.name + ' برای ' + metricLabel(metric)
          + ' قدیمی است و از میانگین حذف شد؛ سن داده حدود '
          + Math.round(ageHours).toLocaleString('fa-IR') + ' ساعت است. سقف مجاز این منبع '
          + Number(maxAgeHours).toLocaleString('fa-IR') + ' ساعت است.'
      });
      continue;
    }
    accepted.push(item);
  }

  if (accepted.length >= 3) {
    const center = median(accepted.map((item) => item.value));
    const threshold = config.sourceOutlierPercent / 100;
    const filtered = [];
    for (const item of accepted) {
      const deviation = Math.abs(item.value - center) / center;
      if (deviation > threshold) {
        alerts.push({
          key: 'outlier:' + sourceValueKey(item.source, metric),
          source: item.source.name,
          metric,
          metricLabel: metricLabel(metric),
          value: item.value,
          reason: 'outlier',
          deviationPercent: deviation * 100,
          message: 'منبع ' + item.source.name + ' برای ' + metricLabel(metric)
            + ' عدد پرت داده و از میانگین حذف شد؛ اختلاف با median حدود '
            + (deviation * 100).toFixed(2) + '٪ است.'
        });
      } else {
        filtered.push(item);
      }
    }
    return {
      value: average(filtered.map((item) => item.value)),
      used: filtered,
      excluded: alerts,
      staleFiltered
    };
  }

  return {
    value: average(accepted.map((item) => item.value)),
    used: accepted,
    excluded: alerts,
    staleFiltered
  };
}

function buildAverages(samples, config) {
  const metrics = [
    'gold18Price',
    'coinPrice',
    'baharCoinPrice',
    'halfCoinPrice',
    'quarterCoinPrice',
    'gramCoinPrice',
    'dollarToman',
    'tetherToman',
    'ounceUsd',
    'silverPrice',
    'silverOunceUsd'
  ];
  const diagnostics = {};
  const alerts = [];
  const result = {};

  for (const metric of metrics) {
    const metricResult = buildMetricAverage(samples, metric, config);
    result[metric] = metricResult.value;
    diagnostics[metric] = metricResult;
    alerts.push(...metricResult.excluded);
  }

  return { ...result, diagnostics, alerts };
}

function sourceNameSet(names = []) {
  return new Set(names.map((name) => String(name).trim().toLowerCase()).filter(Boolean));
}

function isAnalysisOnlySource(source, analysisOnlyNames) {
  return analysisOnlyNames.has(String(source && source.name || '').toLowerCase());
}

function addFetchedSources(samples, errors, fetched, analysisSamples = [], analysisOnlyNames = new Set()) {
  for (const source of fetched) {
    if (source && source.error) {
      errors.push({ source: source.name, error: source.error });
    } else if (isAnalysisOnlySource(source, analysisOnlyNames)) {
      analysisSamples.push(source);
    } else if (source) {
      samples.push(source);
    }
  }
}

async function fetchMarketSources(config) {
  const sourceNames = new Set(config.enabledSources);
  const analysisOnlyNames = sourceNameSet(config.analysisOnlySourceNames);
  const samples = [];
  const analysisSamples = [];
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

  const tasks = [];

  if (sourceNames.has('tala')) {
    tasks.push(
      fetchTalaGoldSource(tgju && tgju.gold18Price)
        .then((source) => ({ type: 'sample', source }))
        .catch((error) => ({ type: 'error', source: 'tala', error }))
    );
  }

  if (sourceNames.has('tajnoghreh')) {
    tasks.push(
      fetchTajnoghrehSilverSource()
        .then((source) => ({ type: 'sample', source }))
        .catch((error) => ({ type: 'error', source: 'tajnoghreh', error }))
    );
  }

  if (sourceNames.has('estjt')) {
    tasks.push(
      fetchEstjtSource()
        .then((source) => ({ type: 'sample', source }))
        .catch((error) => ({ type: 'error', source: 'estjt', error }))
    );
  }

  if (sourceNames.has('external')) {
    tasks.push(
      fetchExternalSources()
        .then((sources) => ({ type: 'samples', sources }))
        .catch((error) => ({ type: 'error', source: 'external', error }))
    );
  }

  if (sourceNames.has('tradingview')) {
    tasks.push(
      fetchTradingViewData(config)
        .then((tradingView) => ({ type: 'tradingview', tradingView }))
        .catch((error) => ({ type: 'error', source: 'tradingview', error }))
    );
  }

  if (sourceNames.has('bale') && config.baleMarketChannels.length) {
    tasks.push(
      fetchBaleMarketSources(config.baleMarketChannels)
        .then((sources) => ({ type: 'fetchedSources', sources }))
        .catch((error) => ({ type: 'error', source: 'bale', error }))
    );
  }

  if (sourceNames.has('telegram') && config.telegramMarketChannels.length) {
    tasks.push(
      fetchTelegramMarketSources(config.telegramMarketChannels)
        .then((sources) => ({ type: 'fetchedSources', sources }))
        .catch((error) => ({ type: 'error', source: 'telegram', error }))
    );
  }

  if (sourceNames.has('telegram') && config.telegramDollarChannels.length) {
    tasks.push(
      fetchTelegramDollarSources(config.telegramDollarChannels, {
        maxAgeHours: config.telegramDollarMaxAgeHours,
        sampleSize: config.telegramDollarSampleSize,
        sampleSizeOverrides: config.telegramDollarSampleSizeOverrides,
        limit: config.telegramUserSourceLimit,
        limitOverrides: config.telegramUserSourceLimitOverrides,
        userClient: {
          apiId: config.telegramApiId,
          apiHash: config.telegramApiHash,
          sessionString: config.telegramSessionString,
          timeoutMs: config.telegramMtprotoInitTimeoutMs
        }
      })
        .then((sources) => ({ type: 'fetchedSources', sources }))
        .catch((error) => ({ type: 'error', source: 'telegram-dollar', error }))
    );
  }

  if (sourceNames.has('telegram') && config.telegramDealChannels.length) {
    tasks.push(
      fetchTelegramDealDollarSources(config.telegramDealChannels, {
        maxAgeHours: config.telegramDollarMaxAgeHours,
        sampleSize: config.telegramDollarSampleSize,
        sampleSizeOverrides: config.telegramDollarSampleSizeOverrides,
        limit: config.telegramUserSourceLimit,
        limitOverrides: config.telegramUserSourceLimitOverrides,
        userClient: {
          apiId: config.telegramApiId,
          apiHash: config.telegramApiHash,
          sessionString: config.telegramSessionString,
          timeoutMs: config.telegramMtprotoInitTimeoutMs
        }
      })
        .then((sources) => ({ type: 'fetchedSources', sources }))
        .catch((error) => ({ type: 'error', source: 'telegram-deal', error }))
    );
  }

  if (sourceNames.has('tetherweb')) {
    for (const [name, url] of tetherWebSourceDefinitions(config)) {
      tasks.push(
        fetchTetherWebSource(name, url)
          .then((source) => ({ type: 'sample', source }))
          .catch((error) => ({ type: 'error', source: name, error }))
      );
    }
  }

  const results = await Promise.all(tasks);
  for (const result of results) {
    if (result.type === 'sample') samples.push(result.source);
    if (result.type === 'samples') samples.push(...result.sources);
    if (result.type === 'fetchedSources') addFetchedSources(samples, errors, result.sources, analysisSamples, analysisOnlyNames);
    if (result.type === 'tradingview') {
      samples.push(...result.tradingView.samples);
      technical = result.tradingView.technical;
    }
    if (result.type === 'error') {
      errors.push({ source: result.source, error: result.error.message });
    }
  }

  const freshSamples = samples.filter((source) => !shouldDropSource(source, config));
  const averages = buildAverages(freshSamples, config);
  const {
    gold18Price,
    coinPrice,
    baharCoinPrice,
    halfCoinPrice,
    quarterCoinPrice,
    gramCoinPrice,
    dollarToman,
    tetherToman,
    ounceUsd,
    silverPrice,
    silverOunceUsd
  } = averages;
  if (!gold18Price) throw new Error('No usable gold price sources. Errors: ' + JSON.stringify(errors));
  if (!coinPrice) throw new Error('No usable coin price sources. Errors: ' + JSON.stringify(errors));
  if (!dollarToman) throw new Error('No usable dollar price sources. Errors: ' + JSON.stringify(errors));
  if (!ounceUsd) throw new Error('No usable ounce price sources. Errors: ' + JSON.stringify(errors));
  return {
    gold18Price,
    coinPrice,
    baharCoinPrice,
    halfCoinPrice,
    quarterCoinPrice,
    gramCoinPrice,
    dollarToman,
    tetherToman,
    ounceUsd,
    silverPrice,
    silverOunceUsd,
    samples: freshSamples,
    analysisSamples,
    errors,
    sourceDiagnostics: averages.diagnostics,
    sourceAlerts: averages.alerts,
    technical
  };
}

module.exports = { fetchMarketSources, parseLocalizedNumber, normalizeNearReference };
