const TGJU_WIDGET_URL = 'https://api.tgju.org/v1/widget/tmp';
const REQUEST_TIMEOUT_MS = 15000;

function parsePrice(raw) {
  const normalized = String(raw || '').replace(/[,\s]/g, '');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

async function fetchTgjuPrices(symbols) {
  const uniqueSymbols = [...new Set(symbols)];
  const url = new URL(TGJU_WIDGET_URL);
  url.searchParams.set('keys', uniqueSymbols.join(','));

  let response;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'gold-alert-bot/1.0'
        },
        signal: controller.signal
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!response.ok) {
    throw new Error('TGJU request failed: ' + response.status + ' ' + response.statusText);
  }

  const data = await response.json();
  const indicators = data && data.response && data.response.indicators;
  if (!Array.isArray(indicators)) {
    throw new Error('TGJU response did not include indicators');
  }

  const prices = new Map();
  for (const item of indicators) {
    const price = parsePrice(item.p);
    if (item.name && price) {
      prices.set(item.name, {
        symbol: item.name,
        title: item.title || item.name,
        price,
        updatedAt: item.updated_at || null
      });
    }
  }

  for (const symbol of uniqueSymbols) {
    if (!prices.has(symbol)) {
      throw new Error('TGJU did not return symbol: ' + symbol);
    }
  }

  return prices;
}

module.exports = { fetchTgjuPrices };
