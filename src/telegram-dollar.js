function stripHtml(input) {
  return input
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

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

function extractMessages(html) {
  const matches = [...html.matchAll(/<div class="tgme_widget_message_wrap[\s\S]*?<time datetime="([^"]+)"[\s\S]*?<div class="tgme_widget_message_text[^>]*>(.*?)<\/div>/gs)];
  return matches
    .map((match) => ({ datetime: match[1], text: stripHtml(match[2]) }))
    .filter((message) => message.text);
}

function extractDollarPrices(messages) {
  const prices = [];
  for (const message of messages) {
    const text = message.text || message;
    if (!/دلار/.test(text)) continue;
    if (/vpn|VPN|استارلینک|تبلیغ|VIP/i.test(text)) continue;
    if (/هرات/.test(text)) continue;
    if (/فردایی|فردا/.test(text) && !/تهران/.test(text)) continue;
    const candidates = [...text.matchAll(/[0-9۰-۹٠-٩][0-9۰-۹٠-٩,٬]{4,}/g)]
      .map((match) => parseLocalizedNumber(match[0]))
      .filter((value) => value && value >= 100000 && value <= 300000);
    for (const value of candidates) {
      prices.push({ value, datetime: message.datetime || null });
    }
  }
  return prices;
}

async function fetchTelegramDollarSources(channels, options = {}) {
  const maxAgeMs = (options.maxAgeHours || 8) * 60 * 60 * 1000;
  const now = Date.now();
  const sources = [];
  for (const channel of channels) {
    try {
      const response = await fetch('https://t.me/s/' + encodeURIComponent(channel), {
        headers: { 'user-agent': 'gold-alert-bot/1.0 Mozilla/5.0' }
      });
      if (!response.ok) continue;
      const html = await response.text();
      const messages = extractMessages(html);
      const prices = extractDollarPrices(messages)
        .filter((price) => {
          if (!price.datetime) return true;
          return now - Date.parse(price.datetime) <= maxAgeMs;
        })
        .slice(-10);
      if (!prices.length) continue;
      const dollarToman = prices.reduce((sum, item) => sum + item.value, 0) / prices.length;
      sources.push({
        name: 'telegram-' + channel,
        dollarToman,
        sampleCount: prices.length,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      sources.push({
        name: 'telegram-' + channel,
        error: error.message,
        updatedAt: new Date().toISOString()
      });
    }
  }
  return sources.filter((source) => source.dollarToman);
}

module.exports = { fetchTelegramDollarSources, extractMessages, extractDollarPrices };
