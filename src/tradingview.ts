// @ts-nocheck
const TRADINGVIEW_SCAN_URL = 'https://scanner.tradingview.com/cfd/scan';
const REQUEST_TIMEOUT_MS = 15000;

const COLUMNS = [
  'name',
  'close',
  'change',
  'Recommend.All',
  'Recommend.All|60',
  'Recommend.All|240',
  'RSI',
  'RSI|60',
  'RSI|240',
  'EMA20',
  'EMA20|60',
  'EMA20|240',
  'SMA50',
  'SMA50|60',
  'SMA50|240'
];

function parseTickers(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function scoreLabel(score) {
  if (!Number.isFinite(score)) return 'نامشخص';
  if (score >= 0.5) return 'خرید قوی';
  if (score >= 0.1) return 'خرید';
  if (score <= -0.5) return 'فروش قوی';
  if (score <= -0.1) return 'فروش';
  return 'خنثی';
}

function rsiLabel(rsi) {
  if (!Number.isFinite(rsi)) return 'RSI نامشخص';
  if (rsi <= 30) return 'اشباع فروش';
  if (rsi >= 70) return 'اشباع خرید';
  return 'RSI متعادل';
}

function parseRow(row) {
  const [
    name,
    close,
    changePercent,
    recommendAll,
    recommendOneHour,
    recommendFourHour,
    rsi,
    rsiOneHour,
    rsiFourHour,
    ema20,
    ema20OneHour,
    ema20FourHour,
    sma50,
    sma50OneHour,
    sma50FourHour
  ] = row.d;

  return {
    symbol: row.s,
    name,
    close,
    changePercent,
    recommendAll,
    recommendOneHour,
    recommendFourHour,
    rsi,
    rsiOneHour,
    rsiFourHour,
    ema20,
    ema20OneHour,
    ema20FourHour,
    sma50,
    sma50OneHour,
    sma50FourHour,
    label: scoreLabel(recommendAll),
    oneHourLabel: scoreLabel(recommendOneHour),
    fourHourLabel: scoreLabel(recommendFourHour),
    rsiLabel: rsiLabel(rsi),
    updatedAt: new Date().toISOString()
  };
}

function buildSourceSamples(signals, goldTicker, silverTicker) {
  const samples = [];
  const gold = signals.find((signal) => signal.symbol === goldTicker);
  const silver = signals.find((signal) => signal.symbol === silverTicker);

  if (gold && Number.isFinite(gold.close)) {
    samples.push({
      name: 'tradingview-gold',
      gold18Price: null,
      coinPrice: null,
      dollarToman: null,
      ounceUsd: gold.close,
      updatedAt: gold.updatedAt
    });
  }

  if (silver && Number.isFinite(silver.close)) {
    samples.push({
      name: 'tradingview-silver',
      gold18Price: null,
      coinPrice: null,
      dollarToman: null,
      silverOunceUsd: silver.close,
      updatedAt: silver.updatedAt
    });
  }

  return samples;
}

async function fetchTradingViewData(config) {
  const tickers = parseTickers(config.tradingViewTickers);
  if (!tickers.length) {
    return { samples: [], technical: { signals: [], summary: 'نمادی برای TradingView تنظیم نشده.' } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(TRADINGVIEW_SCAN_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'nabz-bazar/1.0 Mozilla/5.0'
      },
      body: JSON.stringify({
        symbols: { tickers, query: { types: [] } },
        columns: COLUMNS
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error('TradingView request failed: ' + response.status + ' ' + response.statusText);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const signals = rows.map(parseRow);
  const samples = buildSourceSamples(signals, config.tradingViewGoldTicker, config.tradingViewSilverTicker);

  return {
    samples,
    technical: {
      provider: 'tradingview',
      signals,
      gold: signals.find((signal) => signal.symbol === config.tradingViewGoldTicker) || null,
      silver: signals.find((signal) => signal.symbol === config.tradingViewSilverTicker) || null,
      updatedAt: new Date().toISOString()
    }
  };
}

module.exports = { fetchTradingViewData, scoreLabel, rsiLabel };
