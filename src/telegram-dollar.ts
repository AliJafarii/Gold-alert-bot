// @ts-nocheck
const { parseLocalizedNumber } = require('./numbers');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { saveSourceAudit } = require('./database');

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

function extractMessages(html) {
  const matches = [...html.matchAll(/<div class="tgme_widget_message_wrap[\s\S]*?<time datetime="([^"]+)"[\s\S]*?<div class="tgme_widget_message_text[^>]*>(.*?)<\/div>/gs)];
  return matches
    .map((match) => ({ datetime: match[1], text: stripHtml(match[2]) }))
    .filter((message) => message.text);
}

function normalizePersianText(text) {
  return String(text || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBuyerMessage(text) {
  return /خریدار|خريدار|خریدارم|میخرم|می‌خرم|ميخرم|مخرم|میخوام|می‌خوام|میگیرم|می‌گیرم|ميگيرم|طالبم|خریداری|خريداری|معاوضه|تبدیل/.test(text);
}

function isCashDenominationSwap(text) {
  return /تراول|کاغذ|تمنی|تومنی|اسکناس\s*(?:صدی|صدى|دویستی|دوویستی|پونصدی|پانصدی|پونزدی|پنجاهی|پنجاھی)|(?:با|و)\s*(?:صدی|صدى|دویستی|دوویستی|پونصدی|پانصدی|پونزدی|پنجاهی|پنجاھی|یکی|یک تومنی|یه تومنی)|(?:صدی|صدى|دویستی|دوویستی|پونصدی|پانصدی|پونزدی|پنجاهی|پنجاھی)\s*(?:میدم|می‌دم|میگیرم|می‌گیرم)/.test(text);
}

function hasNonUsdCurrency(text) {
  return /دلار\s*(?:کانادا|استرالیا)|کانادا|استرالیا|دینار|دينار|لیر|لیر|پوند|یورو|تتر|ایترانسفر/.test(text);
}

function shouldSkipDollarMessage(text) {
  const normalized = normalizePersianText(text);
  if (isBuyerMessage(normalized)) return 'buyer';
  if (isCashDenominationSwap(normalized)) return 'cash_denomination_swap';
  if (hasNonUsdCurrency(normalized)) return 'non_usd_currency';
  return null;
}

function maskContactNumbers(text) {
  return String(text || '').replace(/(?:\+?98|0|۰)?[9۹٩][0-9۰-۹٠-٩\s-]{9,}/g, '09*********');
}

function analyzeDollarMessages(messages) {
  const prices = [];
  const rejected = [];
  for (const message of messages) {
    const originalText = String(message.text || message || '');
    const maskedText = maskContactNumbers(originalText);
    const text = originalText.replace(/(?:\+?98|0|۰)?[9۹٩][0-9۰-۹٠-٩\s-]{9,}/g, ' ');
    const base = {
      datetime: message.datetime || null,
      messageId: message.id || null,
      text: maskedText
    };
    if (!/دلار/.test(text)) continue;
    const skipReason = shouldSkipDollarMessage(text);
    if (skipReason) {
      rejected.push({ ...base, reason: skipReason });
      continue;
    }
    if (/vpn|VPN|استارلینک|تبلیغ|VIP/i.test(text)) {
      rejected.push({ ...base, reason: 'ad_or_service' });
      continue;
    }
    if (/هرات/.test(text)) {
      rejected.push({ ...base, reason: 'herat' });
      continue;
    }
    if (/فردایی|فردا/.test(text) && !/تهران/.test(text)) {
      rejected.push({ ...base, reason: 'tomorrow_market' });
      continue;
    }

    const candidates = [...text.matchAll(/[0-9۰-۹٠-٩][0-9۰-۹٠-٩,٬]{1,8}/g)]
      .map((match) => {
        const raw = match[0];
        const value = parseLocalizedNumber(raw);
        if (!value) return null;
        const after = text.slice(match.index + raw.length, match.index + raw.length + 12);
        if (/دلار/.test(after)) return null;
        if (value >= 100000 && value <= 300000) return value;
        if (value >= 100 && value <= 300) return value * 1000;
        return null;
      })
      .filter(Boolean);

    if (!candidates.length) {
      rejected.push({ ...base, reason: 'no_valid_price' });
      continue;
    }
    for (const value of candidates) {
      prices.push({
        value,
        datetime: base.datetime,
        messageId: base.messageId,
        text: maskedText
      });
    }
  }
  return { prices, rejected };
}

function extractDollarPrices(messages) {
  return analyzeDollarMessages(messages).prices;
}

function recentPrices(prices, now, maxAgeMs) {
  return prices
    .filter((price) => {
      if (!price.datetime) return true;
      return now - Date.parse(price.datetime) <= maxAgeMs;
    })
    .sort((a, b) => {
      if (!a.datetime && !b.datetime) return 0;
      if (!a.datetime) return 1;
      if (!b.datetime) return -1;
      return Date.parse(b.datetime) - Date.parse(a.datetime);
    });
}

function recentRejected(rejected, now, maxAgeMs) {
  return rejected
    .filter((item) => {
      if (!item.datetime) return true;
      return now - Date.parse(item.datetime) <= maxAgeMs;
    })
    .sort((a, b) => {
      if (!a.datetime && !b.datetime) return 0;
      if (!a.datetime) return 1;
      if (!b.datetime) return -1;
      return Date.parse(b.datetime) - Date.parse(a.datetime);
    });
}

function withTimeout(promise, timeoutMs, label) {
  let timeout = null;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(label + ' timeout after ' + timeoutMs + 'ms')), timeoutMs);
    })
  ]);
}

async function createUserClient(options = {}) {
  if (!options.apiId || !options.apiHash || !options.sessionString) return null;
  const proxy = process.env.SOCKS_PROXY
    ? { ip: '127.0.0.1', port: 10808, socksType: 5 }
    : undefined;
  const client = new TelegramClient(
    new StringSession(options.sessionString),
    Number(options.apiId),
    options.apiHash,
    {
      connectionRetries: 3,
      ...(proxy ? { proxy } : {})
    }
  );
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || 30000));
  await withTimeout(client.connect(), timeoutMs, 'telegram user connect');
  const authorized = await withTimeout(client.checkAuthorization(), timeoutMs, 'telegram user auth');
  if (!authorized) {
    await client.disconnect().catch(() => {});
    throw new Error('Telegram user session is not authorized');
  }
  return client;
}

function normalizeChatKey(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function sampleSizeForChannel(channel, optionsSampleSize, overrides = {}) {
  return Number(overrides[normalizeChatKey(channel)] || optionsSampleSize || 10);
}

function limitForChannel(channel, optionsLimit, overrides = {}) {
  return Number(overrides[normalizeChatKey(channel)] || optionsLimit || 80);
}

function parseDealDollarMessages(messages) {
  const prices = [];
  const rejected = [];
  for (const message of messages) {
    const text = String(message.text || message || '');
    const base = {
      datetime: message.datetime || null,
      messageId: message.id || null,
      text: maskContactNumbers(text)
    };
    if (/هرات/.test(text)) {
      rejected.push({ ...base, reason: 'herat' });
      continue;
    }
    if (!/معامله/.test(text) || !/(امروزی|نقدی|فردایی|فردا)/.test(text)) {
      rejected.push({ ...base, reason: 'not_deal' });
      continue;
    }
    const match = text.match(/[0-9۰-۹٠-٩][0-9۰-۹٠-٩,٬]{1,8}/);
    const parsed = match ? parseLocalizedNumber(match[0]) : null;
    const value = parsed >= 100000 && parsed <= 300000
      ? parsed
      : parsed >= 100 && parsed <= 300
        ? parsed * 1000
        : null;
    if (!value) {
      rejected.push({ ...base, reason: 'no_valid_price' });
      continue;
    }
    prices.push({
      value,
      marketType: /امروزی|نقدی/.test(text) ? 'امروزی' : 'فردایی',
      datetime: base.datetime,
      messageId: base.messageId,
      text: base.text
    });
  }
  return { prices, rejected };
}

async function buildDialogEntityMap(client, channels, limit) {
  const wanted = new Set(channels.map(normalizeChatKey));
  const dialogs = await client.getDialogs({ limit });
  const entities = new Map();
  for (const dialog of dialogs) {
    const entity = dialog.entity;
    if (!entity) continue;
    const keys = [
      entity.username,
      entity.usernames && entity.usernames.map((item) => item.username),
      entity.title
    ].flat().filter(Boolean).map(normalizeChatKey);
    for (const key of keys) {
      if (wanted.has(key)) entities.set(key, entity);
    }
  }
  return entities;
}

async function fetchUserMessages(client, channel, limit, dialogEntities) {
  const entity = dialogEntities.get(normalizeChatKey(channel));
  if (!entity) throw new Error('chat not found in user dialogs');
  const messages = await client.getMessages(entity, { limit });
  return messages
    .map((message) => ({
      id: message.id,
      datetime: message.date ? new Date(Number(message.date) * 1000).toISOString() : null,
      text: message.message || ''
    }))
    .filter((message) => message.text);
}

async function fetchPublicMessages(channel) {
  const response = await fetch('https://t.me/s/' + encodeURIComponent(channel), {
    headers: { 'user-agent': 'nabz-bazar/1.0 Mozilla/5.0' }
  });
  if (!response.ok) throw new Error('Telegram public page failed: ' + response.status);
  const html = await response.text();
  return extractMessages(html);
}

async function fetchTelegramDollarSources(channels, options = {}) {
  const maxAgeMs = (options.maxAgeHours || 8) * 60 * 60 * 1000;
  const defaultLimit = Number(options.limit || 80);
  const limitOverrides = options.limitOverrides || {};
  const defaultSampleSize = Number(options.sampleSize || 10);
  const sampleSizeOverrides = options.sampleSizeOverrides || {};
  const now = Date.now();
  const sources = [];
  let client = null;
  let userClientError = null;
  let dialogEntities = new Map();
  try {
    client = await createUserClient(options.userClient || {});
    if (client) {
      dialogEntities = await buildDialogEntityMap(client, channels, Number(options.dialogLimit || 1000));
    }
  } catch (error) {
    userClientError = error;
  }
  for (const channel of channels) {
    try {
      let messages = [];
      let readMode = 'public';
      let userReadError = null;
      if (client) {
        try {
          messages = await fetchUserMessages(
            client,
            channel,
            limitForChannel(channel, defaultLimit, limitOverrides),
            dialogEntities
          );
          readMode = 'user';
        } catch (error) {
          userReadError = error;
        }
      }
      if (!messages.length && readMode !== 'user') {
        messages = await fetchPublicMessages(channel);
      } else if (userClientError) {
        sources.push({
          name: 'telegram-dollar-' + channel,
          error: 'user session failed: ' + userClientError.message,
          updatedAt: new Date().toISOString()
        });
        messages = await fetchPublicMessages(channel);
      }
      if (!messages.length) {
        sources.push({
          name: 'telegram-dollar-' + channel,
          error: readMode === 'user'
            ? 'no Telegram messages found with user session'
            : 'no public Telegram messages found' + (userReadError ? '; user session: ' + userReadError.message : ''),
          updatedAt: new Date().toISOString()
        });
        continue;
      }
      const analyzed = analyzeDollarMessages(messages);
      const prices = recentPrices(analyzed.prices, now, maxAgeMs)
        .slice(0, sampleSizeForChannel(channel, defaultSampleSize, sampleSizeOverrides));
      if (!prices.length) {
        sources.push({
          name: 'telegram-dollar-' + channel,
          error: 'no recent dollar prices found' + (userReadError ? '; user session: ' + userReadError.message : ''),
          updatedAt: new Date().toISOString()
        });
        continue;
      }
      const dollarToman = prices.reduce((sum, item) => sum + item.value, 0) / prices.length;
      const source = {
        name: 'telegram-dollar-' + channel,
        dollarToman,
        sampleCount: prices.length,
        readMode,
        updatedAt: new Date().toISOString()
      };
      sources.push(source);
      saveSourceAudit(source.name, {
        readMode,
        averageDollarToman: dollarToman,
        accepted: prices,
        rejected: recentRejected(analyzed.rejected, now, maxAgeMs).slice(0, 50)
      });
    } catch (error) {
      sources.push({
        name: 'telegram-dollar-' + channel,
        error: error.message,
        updatedAt: new Date().toISOString()
      });
    }
  }
  if (client) await client.destroy().catch(() => client.disconnect().catch(() => {}));
  return sources;
}

async function fetchTelegramDealDollarSources(channels, options = {}) {
  const maxAgeMs = (options.maxAgeHours || 8) * 60 * 60 * 1000;
  const defaultLimit = Number(options.limit || 80);
  const limitOverrides = options.limitOverrides || {};
  const defaultSampleSize = Number(options.sampleSize || 10);
  const sampleSizeOverrides = options.sampleSizeOverrides || {};
  const now = Date.now();
  const sources = [];
  let client = null;
  let dialogEntities = new Map();
  try {
    client = await createUserClient(options.userClient || {});
    if (!client) throw new Error('Telegram user session is required');
    dialogEntities = await buildDialogEntityMap(client, channels, Number(options.dialogLimit || 1000));
    for (const channel of channels) {
      try {
        const messages = await fetchUserMessages(
          client,
          channel,
          limitForChannel(channel, defaultLimit, limitOverrides),
          dialogEntities
        );
        const analyzed = parseDealDollarMessages(messages);
        const recent = recentPrices(analyzed.prices, now, maxAgeMs);
        const todayPrices = recent.filter((item) => item.marketType === 'امروزی');
        const prioritized = todayPrices.length ? todayPrices : recent;
        const prices = prioritized.slice(0, sampleSizeForChannel(channel, defaultSampleSize, sampleSizeOverrides));
        if (!prices.length) {
          sources.push({
            name: 'telegram-deal-' + channel,
            error: 'no recent deal dollar prices found',
            updatedAt: new Date().toISOString()
          });
          continue;
        }
        const dollarToman = prices.reduce((sum, item) => sum + item.value, 0) / prices.length;
        sources.push({
          name: 'telegram-deal-' + channel,
          dollarToman,
          sampleCount: prices.length,
          readMode: 'user',
          dealTypes: [...new Set(prices.map((item) => item.marketType))],
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        sources.push({
          name: 'telegram-deal-' + channel,
          error: error.message,
          updatedAt: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    for (const channel of channels) {
      sources.push({
        name: 'telegram-deal-' + channel,
        error: error.message,
        updatedAt: new Date().toISOString()
      });
    }
  } finally {
    if (client) await client.destroy().catch(() => client.disconnect().catch(() => {}));
  }
  return sources;
}

module.exports = {
  fetchTelegramDollarSources,
  fetchTelegramDealDollarSources,
  extractMessages,
  extractDollarPrices,
  analyzeDollarMessages,
  parseDealDollarMessages
};
