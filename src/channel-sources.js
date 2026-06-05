const { parseMarketMessage } = require('./message-parser');

function stripHtml(input) {
  return String(input || '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function hasEnoughMarketData(source, minImportantFields = 2) {
  if (!source) return false;
  const importantFields = ['gold18Price', 'coinPrice', 'dollarToman', 'ounceUsd'];
  return importantFields.filter((field) => Number.isFinite(source[field]) && source[field] > 0).length >= minImportantFields;
}

function shouldSkipMarketText(text, allowDollarOnly) {
  if (/vpn|VPN|استارلینک|تبلیغ|VIP/i.test(text)) return true;
  if (!allowDollarOnly) return false;
  if (/هرات/.test(text)) return true;
  if (/فردایی|فردا/.test(text) && !/تهران/.test(text)) return true;
  return false;
}

function parseLatestMarketSource(messages, name, options = {}) {
  const minImportantFields = options.minImportantFields || 2;
  const allowDollarOnly = minImportantFields <= 1;
  const sorted = messages
    .filter((message) => message && message.text)
    .sort((a, b) => Date.parse(b.datetime || 0) - Date.parse(a.datetime || 0));

  for (const message of sorted) {
    if (shouldSkipMarketText(message.text, allowDollarOnly)) continue;
    const source = parseMarketMessage(message.text, name);
    if (!hasEnoughMarketData(source, minImportantFields)) continue;
    return {
      ...source,
      updatedAt: message.datetime || source.updatedAt,
      sourceMessageText: message.text.slice(0, 500)
    };
  }
  return null;
}

function extractTelegramMessages(html) {
  const matches = [...String(html || '').matchAll(/<div class="tgme_widget_message_wrap[\s\S]*?<time datetime="([^"]+)"[\s\S]*?<div class="tgme_widget_message_text[^>]*>(.*?)<\/div>/gs)];
  return matches
    .map((match) => ({ datetime: match[1], text: stripHtml(match[2]) }))
    .filter((message) => message.text);
}

function extractNextData(html) {
  const match = String(html || '').match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

function normalizeBaleDate(value) {
  if (!value) return null;
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function extractBaleMessageText(message) {
  const payload = message && message.message;
  if (!payload) return '';
  return [
    payload.textMessage && payload.textMessage.text,
    payload.photoMessage && payload.photoMessage.caption && payload.photoMessage.caption.text,
    payload.documentMessage && payload.documentMessage.caption && payload.documentMessage.caption.text
  ].filter(Boolean).join('\n').trim();
}

function extractBaleMessages(html) {
  const data = extractNextData(html);
  const messages = data && data.props && data.props.pageProps && data.props.pageProps.messages;
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => ({
      datetime: normalizeBaleDate(message.date),
      text: extractBaleMessageText(message)
    }))
    .filter((message) => message.text);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
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

async function fetchTelegramMarketSources(channels) {
  const sources = [];
  for (const channel of channels) {
    try {
      const html = await fetchHtml('https://t.me/s/' + encodeURIComponent(channel));
      const source = parseLatestMarketSource(extractTelegramMessages(html), 'telegram-' + channel, {
        minImportantFields: 1
      });
      if (source) {
        sources.push(source);
      } else {
        sources.push({
          name: 'telegram-' + channel,
          error: 'no recent parseable market message',
          updatedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      sources.push({ name: 'telegram-' + channel, error: error.message, updatedAt: new Date().toISOString() });
    }
  }
  return sources;
}

async function fetchBaleMarketSources(channels) {
  const sources = [];
  for (const channel of channels) {
    try {
      const html = await fetchHtml('https://ble.ir/s/' + encodeURIComponent(channel));
      const source = parseLatestMarketSource(extractBaleMessages(html), 'bale-' + channel);
      if (source) {
        sources.push(source);
      } else {
        sources.push({
          name: 'bale-' + channel,
          error: 'no recent parseable market message',
          updatedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      sources.push({ name: 'bale-' + channel, error: error.message, updatedAt: new Date().toISOString() });
    }
  }
  return sources;
}

module.exports = {
  stripHtml,
  extractTelegramMessages,
  extractBaleMessages,
  fetchTelegramMarketSources,
  fetchBaleMarketSources
};
