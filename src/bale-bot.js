const { mkdir, writeFile } = require('fs/promises');
const { dirname } = require('path');
const { config } = require('./config');
const { buildReport, getSnapshot } = require('./monitor');
const { parseMarketMessage } = require('./message-parser');
const { formatAdminPanel } = require('./format');
const { formatAdminAlert, getNewAdminAlerts } = require('./admin-alerts');
const {
  publicChatId,
  listDueNotificationSettings,
  markNotificationSent,
  setNotificationEnabled,
  setNotificationInterval,
  upsertNotificationSettings,
  upsertUser
} = require('./database');

const PLATFORM = 'bale';
const messageOptions = { disable_web_page_preview: true };
const pendingCustomIntervals = new Set();

function isEnabled() {
  return Boolean(config.baleBotToken);
}

function apiUrl(method) {
  return config.baleApiBaseUrl + config.baleBotToken + '/' + method;
}

function mainKeyboard(isAdmin = false) {
  const rows = [
    [{ text: '📊 گزارش فوری' }, { text: '🔔 تنظیمات اطلاع‌رسانی' }],
    [{ text: '⚙️ تنظیمات' }]
  ];
  if (isAdmin) rows[1].push({ text: '🛡 پنل ادمین' });
  return { keyboard: rows, resize_keyboard: true };
}

async function callBale(method, body) {
  const response = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok === false) {
    const description = payload && (payload.description || payload.error) ? payload.description || payload.error : response.statusText;
    throw new Error('Bale ' + method + ' failed: ' + description);
  }
  return payload.result;
}

function toBaleText(text) {
  return String(text || '')
    .replace(/<b>(.*?)<\/b>/g, '$1')
    .replace(/<strong>(.*?)<\/strong>/g, '$1')
    .replace(/<code>(.*?)<\/code>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

async function sendChat(chatId, text, extra = {}) {
  return callBale('sendMessage', {
    chat_id: Number.isFinite(Number(chatId)) ? Number(chatId) : chatId,
    text: toBaleText(text),
    ...messageOptions,
    ...extra
  });
}

async function sendConfiguredChat(text) {
  if (!config.baleChatId) return;
  await sendChat(config.baleChatId, text);
}

async function sendAdminChats(text) {
  for (const chatId of config.baleAdminChatIds) {
    await sendChat(chatId, text);
  }
}

function isAdminChat(chatId) {
  return config.baleAdminChatIds.includes(String(chatId));
}

async function reply(ctx, text, extra = {}) {
  return sendChat(ctx.chat.id, text, {
    reply_markup: mainKeyboard(isAdminChat(ctx.chat.id)),
    ...extra
  });
}

function intervalLabel(minutes) {
  if (minutes < 60) return minutes.toLocaleString('fa-IR') + ' دقیقه';
  if (minutes % 60 === 0) return (minutes / 60).toLocaleString('fa-IR') + ' ساعت';
  return minutes.toLocaleString('fa-IR') + ' دقیقه';
}

function formatNotificationSettings(settings) {
  if (!settings || !settings.enabled) {
    return [
      '<b>🔔 تنظیمات اطلاع‌رسانی</b>',
      '',
      'وضعیت فعلی: خاموش',
      '',
      'برای تنظیم بازه از فرمان /notify استفاده کن.',
      'نمونه: /notify 30'
    ].join('\n');
  }
  return [
    '<b>🔔 تنظیمات اطلاع‌رسانی</b>',
    '',
    'وضعیت فعلی: روشن',
    'بازه ارسال: ' + intervalLabel(settings.interval_minutes),
    '',
    'برای تغییر بازه از فرمان /notify استفاده کن.',
    'نمونه‌ها: /notify 10، /notify 60، /notify off'
  ].join('\n');
}

function parseNotifyMinutes(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return null;
  if (['off', 'خاموش', 'stop'].includes(raw)) return 'off';
  if (['on', 'روشن'].includes(raw)) return 'on';
  const match = raw.match(/[0-9۰-۹٠-٩]+/);
  if (!match) return null;
  const normalized = match[0]
    .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
  const minutes = Number(normalized);
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

async function collectReport() {
  const { snapshot, message } = await buildReport();
  const newAdminAlerts = await getNewAdminAlerts(snapshot);
  if (newAdminAlerts.length) await sendAdminChats(formatAdminAlert(newAdminAlerts));
  return { snapshot, message };
}

async function sendImmediateReportAndStartInterval(chatId) {
  const { message } = await collectReport();
  await sendChat(chatId, message);
  markNotificationSent(chatId, undefined, PLATFORM);
}

async function sendSettings(ctx) {
  await reply(ctx, [
    '<b>⚙️ تنظیمات فعلی</b>',
    '',
    '• نماد طلا: ' + config.tgjuGoldSymbol,
    '• نماد سکه: ' + config.tgjuCoinSymbol,
    '• منابع فعال: ' + config.enabledSources.join(', '),
    '• آستانه خرید: ' + config.buyBubblePercent + '٪',
    '• آستانه فروش: ' + config.sellBubblePercent + '٪',
    '• فاصله جمع‌آوری داخلی: ' + config.checkIntervalMinutes + ' دقیقه'
  ].join('\n'));
}

async function runScheduledNotifications() {
  const dueSettings = listDueNotificationSettings(new Date(), PLATFORM);
  if (!dueSettings.length) return;
  const { message } = await collectReport();
  const sentAt = new Date().toISOString();
  for (const settings of dueSettings) {
    const chatId = publicChatId(PLATFORM, settings.chat_id);
    try {
      await sendChat(chatId, message);
      markNotificationSent(chatId, sentAt, PLATFORM);
    } catch (error) {
      console.error('Bale scheduled notification failed for chat ' + chatId + ':', error);
    }
  }
}

async function handleText(ctx) {
  upsertUser(ctx.chat, isAdminChat(ctx.chat.id), PLATFORM);
  const text = String(ctx.text || '').trim();
  const command = text.replace(/@\w+/, '').split(/\s+/)[0].toLowerCase();

  if (pendingCustomIntervals.has(String(ctx.chat.id))) {
    const minutes = parseNotifyMinutes(text);
    if (typeof minutes !== 'number' || minutes < 1 || minutes > 1440) {
      await reply(ctx, 'یک عدد بین ۱ تا ۱۴۴۰ دقیقه بفرست.');
      return;
    }
    pendingCustomIntervals.delete(String(ctx.chat.id));
    const settings = setNotificationInterval(ctx.chat.id, minutes, PLATFORM);
    await reply(ctx, formatNotificationSettings(settings));
    await sendImmediateReportAndStartInterval(ctx.chat.id);
    return;
  }

  if (command === '/start') {
    upsertNotificationSettings(ctx.chat.id, undefined, PLATFORM);
    await reply(ctx, [
      '<b>📊 بات اطلاع‌رسانی بازار طلا</b>',
      '',
      'از دکمه‌های پایین صفحه استفاده کن.',
      '',
      '📊 گزارش فوری: دریافت گزارش همین حالا',
      '🔔 تنظیمات اطلاع‌رسانی: انتخاب بازه ارسال پیام',
      '⚙️ تنظیمات: نمایش تنظیمات فعلی'
    ].join('\n'));
    return;
  }

  if (command === '/check' || text === '📊 گزارش فوری') {
    try {
      upsertNotificationSettings(ctx.chat.id, undefined, PLATFORM);
      const { message } = await collectReport();
      await reply(ctx, message);
    } catch (error) {
      await reply(ctx, 'خطا در بررسی قیمت: ' + error.message);
    }
    return;
  }

  if (command === '/settings' || text === '⚙️ تنظیمات') {
    await sendSettings(ctx);
    return;
  }

  if (command === '/notify' || command === '/notifications') {
    const arg = text.replace(/^\/(?:notify|notifications)(@\w+)?\s*/i, '').trim();
    const parsed = parseNotifyMinutes(arg);
    if (parsed === 'off') {
      const settings = setNotificationEnabled(ctx.chat.id, false, PLATFORM);
      await reply(ctx, formatNotificationSettings(settings));
      return;
    }
    if (parsed === 'on') {
      const settings = setNotificationEnabled(ctx.chat.id, true, PLATFORM);
      await reply(ctx, formatNotificationSettings(settings));
      await sendImmediateReportAndStartInterval(ctx.chat.id);
      return;
    }
    if (typeof parsed === 'number') {
      if (parsed < 1 || parsed > 1440) {
        await reply(ctx, 'بازه نوتیف باید بین ۱ تا ۱۴۴۰ دقیقه باشد.');
        return;
      }
      const settings = setNotificationInterval(ctx.chat.id, parsed, PLATFORM);
      await reply(ctx, formatNotificationSettings(settings));
      await sendImmediateReportAndStartInterval(ctx.chat.id);
      return;
    }
    const settings = upsertNotificationSettings(ctx.chat.id, undefined, PLATFORM);
    await reply(ctx, formatNotificationSettings(settings));
    return;
  }

  if (text === '🔔 تنظیمات اطلاع‌رسانی') {
    const settings = upsertNotificationSettings(ctx.chat.id, undefined, PLATFORM);
    await reply(ctx, formatNotificationSettings(settings));
    return;
  }

  if (text === '🛡 پنل ادمین' || command === '/admin' || command === '/sources') {
    if (!isAdminChat(ctx.chat.id)) {
      await reply(ctx, 'این بخش فقط برای ادمین فعال است.');
      return;
    }
    try {
      const snapshot = await getSnapshot();
      await reply(ctx, formatAdminPanel(snapshot));
    } catch (error) {
      await reply(ctx, 'خطا در پنل ادمین: ' + error.message);
    }
    return;
  }

  if (command === '/source') {
    const sourceText = text.replace(/^\/source(@\w+)?\s*/i, '').trim();
    const source = parseMarketMessage(sourceText, 'manual-bale');
    if (!source) {
      await reply(ctx, 'قیمت قابل تشخیص پیدا نکردم؛ متن پیام قیمت را بعد از فرمان source بفرست.');
      return;
    }
    await mkdir(dirname(config.externalSourcesFile), { recursive: true });
    await writeFile(config.externalSourcesFile, JSON.stringify([source], null, 2));
    const { message } = await collectReport();
    await reply(ctx, 'منبع دستی ذخیره شد.\n\n' + message);
  }
}

function updateToContext(update) {
  const message = update && update.message;
  if (!message || !message.chat || !message.text) return null;
  return {
    chat: message.chat,
    text: message.text,
    message
  };
}

async function pollUpdates() {
  let offset = 0;
  while (isEnabled()) {
    try {
      const updates = await callBale('getUpdates', { offset, timeout: 30 });
      for (const update of updates || []) {
        offset = Math.max(offset, Number(update.update_id || 0) + 1);
        const ctx = updateToContext(update);
        if (!ctx) continue;
        await handleText(ctx);
      }
    } catch (error) {
      console.error('Bale polling failed:', error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function startBaleBot() {
  if (!isEnabled()) return null;
  if (config.baleChatId) {
    upsertUser(config.baleChatId, config.baleAdminChatIds.includes(String(config.baleChatId)), PLATFORM);
    upsertNotificationSettings(config.baleChatId, undefined, PLATFORM);
  }
  if (config.sendStartupMessage) {
    await sendConfiguredChat('بات هشدار حباب طلا در بله روشن شد.').catch((error) => {
      console.error('Bale startup message failed:', error);
    });
  }
  setInterval(() => {
    runScheduledNotifications().catch((error) => {
      console.error('Bale scheduled check failed:', error);
    });
  }, 60 * 1000);
  await runScheduledNotifications().catch((error) => {
    console.error('Initial Bale check failed:', error);
  });
  pollUpdates();
  console.log('Gold Alert Bale bot started');
  return { stop: () => {} };
}

module.exports = { startBaleBot };
