// @ts-nocheck
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
  const importantFields = ['gold18Price', 'coinPrice', 'dollarToman', 'tetherToman', 'ounceUsd'];
  return importantFields.filter((field) => Number.isFinite(source[field]) && source[field] > 0).length >= minImportantFields;
}

function shouldSkipMarketText(text, allowDollarOnly) {
  const hasMarketPrice = /طلا|سکه|دلار|تتر|اونس|نقره/.test(text) && /[0-9۰-۹٠-٩][0-9۰-۹٠-٩,٬]{2,}/.test(text);
  if (/vpn|VPN|استارلینک|تبلیغ|VIP/i.test(text) && !hasMarketPrice) return true;
  if (!allowDollarOnly) return false;
  if (/هرات/.test(text)) return true;
  if (/فردایی|فردا/.test(text) && !/تهران/.test(text)) return true;
  return false;
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

function parseMarketMessageDate(text) {
  const dateMatch = String(text || '').match(/تاریخ\s*[:：]?\s*([0-9۰-۹٠-٩]{4})[\/.-]([0-9۰-۹٠-٩]{1,2})[\/.-]([0-9۰-۹٠-٩]{1,2})/);
  const timeMatch = String(text || '').match(/ساعت\s*[:：]?\s*([0-9۰-۹٠-٩]{1,2})[:：]([0-9۰-۹٠-٩]{1,2})/);
  if (!dateMatch || !timeMatch) return null;
  const parseDateNumber = (value) => {
    const parsed = Number(String(value || '')
      .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
      .replace(/[٠-٩]/g, (char) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char))));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const year = parseDateNumber(dateMatch[1]);
  const month = parseDateNumber(dateMatch[2]);
  const day = parseDateNumber(dateMatch[3]);
  const hour = parseDateNumber(timeMatch[1]);
  const minute = parseDateNumber(timeMatch[2]);
  if (!year || !month || !day || hour === null || minute === null) return null;
  const gregorian = jalaliToGregorian(year, month, day);
  const date = new Date(Date.UTC(gregorian.gy, gregorian.gm - 1, gregorian.gd, hour - 3, minute - 30, 0));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseLatestMarketSource(messages, name, options = {}) {
  const minImportantFields = options.minImportantFields || 2;
  const allowDollarOnly = minImportantFields <= 1;
  const sorted = messages
    .filter((message) => message && message.text)
    .map((message) => ({
      ...message,
      marketDatetime: parseMarketMessageDate(message.text) || message.datetime
    }))
    .sort((a, b) => Date.parse(b.marketDatetime || 0) - Date.parse(a.marketDatetime || 0));

  for (const message of sorted) {
    if (shouldSkipMarketText(message.text, allowDollarOnly)) continue;
    const source = parseMarketMessage(message.text, name);
    if (!hasEnoughMarketData(source, minImportantFields)) continue;
    return {
      ...source,
      updatedAt: message.marketDatetime || source.updatedAt,
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
      headers: { 'user-agent': 'nabz-bazar/1.0 Mozilla/5.0' },
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
  parseMarketMessageDate,
  fetchTelegramMarketSources,
  fetchBaleMarketSources
};
