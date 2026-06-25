// @ts-nocheck
const { mkdir, writeFile } = require('fs/promises');
const { dirname } = require('path');
const { config, setRuntimeConfig } = require('./config');
const { buildAnalysisReport, buildReport, getSnapshot } = require('./monitor');
const { parseMarketMessage } = require('./message-parser');
const { formatAdminPanel, formatSourceAuditReport, formatBotLinks } = require('./format');
const { formatAdminAlert, getNewAdminAlerts } = require('./admin-alerts');
const {
  createAccountLinkCode,
  getProfile,
  getLatestSourceAudit,
  linkAccountWithCode,
  publicChatId,
  listDueNotificationSettings,
  markNotificationSent,
  setProfilePhone,
  setNotificationEnabled,
  setNotificationInterval,
  upsertNotificationSettings,
  upsertUser
} = require('./database');

const PLATFORM = 'bale';
const messageOptions = { disable_web_page_preview: true };
const pendingCustomIntervals = new Set();
const pendingPhoneLinks = new Set();
const pendingCodeLinks = new Set();
let balePollingStopped = true;

function isEnabled() {
  return Boolean(config.baleBotToken);
}

function apiUrl(method) {
  return config.baleApiBaseUrl + config.baleBotToken + '/' + method;
}

function mainKeyboard(isAdmin = false) {
  const rows = [
    [{ text: '📊 گزارش فوری' }, { text: '🧠 تحلیل بازار' }],
    [{ text: '🔔 تنظیمات اطلاع‌رسانی' }, { text: '👤 پروفایل' }],
    [{ text: '🔗 اتصال اکانت‌ها' }],
    [{ text: '⚙️ تنظیمات' }]
  ];
  if (isAdmin) rows[3].push({ text: '🛡 پنل ادمین' }, { text: '🧪 audit پارسیان' });
  return { keyboard: rows, resize_keyboard: true };
}

function phoneKeyboard(isAdmin = false) {
  const rows = [
    [{ text: '📱 ارسال شماره موبایل', request_contact: true }],
    [{ text: '🔢 دریافت کد اتصال' }, { text: '⌨️ وارد کردن کد' }],
    [{ text: '📊 گزارش فوری' }, { text: '🧠 تحلیل بازار' }],
    [{ text: '🔔 تنظیمات اطلاع‌رسانی' }, { text: '👤 پروفایل' }],
    [{ text: '🔗 اتصال اکانت‌ها' }],
    [{ text: '⚙️ تنظیمات' }]
  ];
  if (isAdmin) rows[5].push({ text: '🛡 پنل ادمین' }, { text: '🧪 audit پارسیان' });
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

async function replyLong(ctx, text, extra = {}) {
  const maxLength = 3500;
  const lines = String(text || '').split('\n');
  let chunk = '';
  for (const line of lines) {
    const next = chunk ? chunk + '\n' + line : line;
    if (next.length > maxLength && chunk) {
      await reply(ctx, chunk, extra);
      chunk = line;
    } else {
      chunk = next;
    }
  }
  if (chunk) await reply(ctx, chunk, extra);
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

function formatProfileText(profileData) {
  const profile = profileData.profile || {};
  const settings = profileData.settings || {};
  const accounts = profileData.accounts || [];
  const payments = profileData.payments || [];
  const accountLines = accounts.length
    ? accounts.map((account) => '• ' + (account.platform === 'bale' ? 'بله' : 'تلگرام') + ': ' + (account.username ? '@' + account.username : account.platform_chat_id))
    : ['• هنوز اکانتی ثبت نشده است.'];
  const paymentLines = payments.length
    ? payments.map((payment) => '• ' + [payment.amount, payment.currency, payment.status, payment.created_at].filter(Boolean).join(' | '))
    : ['• پرداختی ثبت نشده است.'];
  return [
    '<b>👤 پروفایل</b>',
    '',
    'شناسه پروفایل: ' + Number(profile.id || 0).toLocaleString('fa-IR'),
    'پلن فعلی: ' + (profile.plan === 'free' ? 'رایگان' : profile.plan),
    'وضعیت نوتیف: ' + (settings.enabled ? 'روشن' : 'خاموش'),
    'بازه نوتیف: ' + intervalLabel(settings.interval_minutes || config.defaultNotificationIntervalMinutes),
    'شماره تاییدشده: ' + (profile.phone ? profile.phone : 'ثبت نشده'),
    '',
    '<b>اکانت‌های متصل</b>',
    ...accountLines,
    '',
    '<b>تاریخچه پرداخت</b>',
    ...paymentLines,
    '',
    'برای اتصال بله و تلگرام، دکمه «🔗 اتصال اکانت‌ها» را بزن و یکی از دو روش کد یا شماره موبایل را انتخاب کن.'
  ].join('\n');
}

function introText() {
  return [
    '<b>📊 نبض بازار</b>',
    'ربات پایش قیمت طلا، سکه، دلار و نقره با گزارش دوره‌ای و تحلیل جداگانه بازار.',
    '',
    ...formatBotLinks(PLATFORM),
    '',
    '<b>از دکمه‌های پایین صفحه استفاده کن</b>',
    '📊 گزارش فوری: قیمت‌ها و منابع',
    '🧠 تحلیل بازار: خرید پله‌ای/نگهداری/کاهش ریسک به‌صورت جدا',
    '🔔 تنظیمات اطلاع‌رسانی: انتخاب بازه پیام',
    '👤 پروفایل: پلن، اکانت‌های متصل و پرداخت‌ها',
    '',
    'برای اتصال بله و تلگرام، دکمه «🔗 اتصال اکانت‌ها» را بزن. هم اتصال با کد فعال است، هم اتصال با شماره موبایل.'
  ].join('\n');
}

async function sendAccountLinkMenu(ctx) {
  await reply(ctx, [
    '<b>🔗 اتصال تلگرام و بله</b>',
    '',
    'برای یکی‌کردن پروفایل و تنظیمات نوتیف، یکی از این دکمه‌ها را بزن:',
    '',
    '📱 ثبت شماره موبایل',
    '🔢 دریافت کد اتصال',
    '⌨️ وارد کردن کد',
    '',
    'اگر نمی‌خواهی شماره موبایل بدهی، روش کد را انتخاب کن.'
  ].join('\n'), {
    reply_markup: {
      keyboard: [
        [{ text: '📱 ثبت شماره موبایل' }],
        [{ text: '🔢 دریافت کد اتصال' }, { text: '⌨️ وارد کردن کد' }],
        ...mainKeyboard(isAdminChat(ctx.chat.id)).keyboard
      ],
      resize_keyboard: true
    }
  });
}

async function sendPhonePrompt(ctx) {
  pendingPhoneLinks.add(String(ctx.chat.id));
  await reply(ctx, [
    '<b>📱 اتصال با شماره موبایل</b>',
    '',
    'شماره موبایل فقط برای لینک‌کردن پروفایل تلگرام و بله استفاده می‌شود.',
    'اگر همین شماره را در بات دیگر هم تایید کنی، دو اکانت یکی می‌شوند.',
    '',
    'دکمه ارسال شماره را بزن یا شماره را همینجا بنویس.',
    'اگر نمی‌خواهی شماره بدهی، از بخش اتصال، روش کد را انتخاب کن.'
  ].join('\n'), {
    reply_markup: phoneKeyboard(isAdminChat(ctx.chat.id))
  });
}

async function sendCreatedLinkCode(ctx) {
  pendingCodeLinks.delete(String(ctx.chat.id));
  const link = createAccountLinkCode(ctx.chat.id, PLATFORM);
  await reply(ctx, [
    '<b>🔢 کد اتصال</b>',
    '',
    'این کد تا ۱۵ دقیقه دیگر معتبر است:',
    link.code,
    '',
    'در بات دیگر دکمه «⌨️ وارد کردن کد» را بزن و همین عدد را بفرست.'
  ].join('\n'));
}

async function sendCodePrompt(ctx) {
  pendingCodeLinks.add(String(ctx.chat.id));
  await reply(ctx, [
    '<b>⌨️ وارد کردن کد اتصال</b>',
    '',
    'کد ۶ رقمی‌ای که از بات دیگر گرفتی را همینجا بفرست.',
    'اگر کد نداری، اول «🔢 دریافت کد اتصال» را بزن.'
  ].join('\n'));
}

async function handleCodeLink(ctx, code) {
  const result = linkAccountWithCode(ctx.chat.id, code, PLATFORM);
  pendingCodeLinks.delete(String(ctx.chat.id));
  if (!result.ok) {
    await reply(ctx, result.reason === 'expired'
      ? 'کد اتصال منقضی شده است. از دکمه «🔢 دریافت کد اتصال» یک کد تازه بگیر.'
      : 'کد اتصال معتبر نیست. اگر کد نداری، از دکمه «🔢 دریافت کد اتصال» استفاده کن.');
    return;
  }
  await reply(ctx, 'اکانت‌ها متصل شدند. از این به بعد تنظیمات نوتیف و پروفایل بین تلگرام و بله مشترک است.\n\n' + formatProfileText(getProfile(ctx.chat.id, PLATFORM)));
}

async function handlePhoneLink(ctx, rawPhone) {
  const result = setProfilePhone(ctx.chat.id, rawPhone, PLATFORM);
  pendingPhoneLinks.delete(String(ctx.chat.id));
  if (!result.ok) {
    await reply(ctx, [
      'شماره موبایل معتبر نبود.',
      'برای اتصال با شماره، باید شماره یکسان را در هر دو بات تایید کنی.',
      'اگر نمی‌خواهی شماره بدهی، از دکمه «🔢 دریافت کد اتصال» استفاده کن.'
    ].join('\n'));
    return;
  }
  if (result.linked) {
    await reply(ctx, 'اکانت‌ها با شماره موبایل متصل شدند. تنظیمات نوتیف و پروفایل از این به بعد مشترک است.\n\n' + formatProfileText(getProfile(ctx.chat.id, PLATFORM)));
    return;
  }
  await reply(ctx, [
    'شماره موبایل ثبت شد.',
    'برای تکمیل اتصال، در بات دیگر هم دکمه «📱 ثبت شماره موبایل» را بزن و همین شماره را تایید کن.',
    'تا وقتی شماره در هر دو طرف تایید نشود، اکانت‌ها با روش شماره موبایل لینک نمی‌شوند. روش کد ۶ رقمی هم همچنان فعال است.'
  ].join('\n'));
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

function parseHours(text) {
  const match = String(text || '').match(/[0-9۰-۹٠-٩]+(?:[.,][0-9۰-۹٠-٩]+)?/);
  if (!match) return null;
  const normalized = match[0]
    .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)))
    .replace(',', '.');
  const hours = Number(normalized);
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

async function collectReport() {
  const { snapshot, message } = await buildReport('bale');
  const newAdminAlerts = await getNewAdminAlerts(snapshot);
  if (newAdminAlerts.length) await sendAdminChats(formatAdminAlert(newAdminAlerts));
  return { snapshot, message };
}

async function collectAnalysis() {
  const { snapshot, message } = await buildAnalysisReport('bale');
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
    '• سقف تازگی تلگرام و بله: ' + config.channelSourceMaxAgeHours + ' ساعت',
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
      if (/forbidden|blocked/i.test(String(error && error.message || error))) {
        setNotificationEnabled(chatId, false, PLATFORM);
      }
      console.error('Bale scheduled notification failed for chat ' + chatId + ':', error);
    }
  }
}

async function handleText(ctx) {
  upsertUser(ctx.chat, isAdminChat(ctx.chat.id), PLATFORM);
  if (ctx.contact) {
    await handlePhoneLink(ctx, ctx.contact.phone_number || ctx.contact.phone || '');
    return;
  }
  const text = String(ctx.text || '').trim();
  const command = text.replace(/@\w+/, '').split(/\s+/)[0].toLowerCase();

  if (text === '🔗 اتصال اکانت‌ها') {
    pendingPhoneLinks.delete(String(ctx.chat.id));
    pendingCodeLinks.delete(String(ctx.chat.id));
    await sendAccountLinkMenu(ctx);
    return;
  }

  if (text === '📱 ثبت شماره موبایل') {
    pendingCodeLinks.delete(String(ctx.chat.id));
    await sendPhonePrompt(ctx);
    return;
  }

  if (text === '🔢 دریافت کد اتصال') {
    pendingPhoneLinks.delete(String(ctx.chat.id));
    await sendCreatedLinkCode(ctx);
    return;
  }

  if (text === '⌨️ وارد کردن کد') {
    pendingPhoneLinks.delete(String(ctx.chat.id));
    await sendCodePrompt(ctx);
    return;
  }

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

  if (pendingPhoneLinks.has(String(ctx.chat.id))) {
    await handlePhoneLink(ctx, text);
    return;
  }

  if (pendingCodeLinks.has(String(ctx.chat.id))) {
    if (!/^\d{6}$/.test(text)) {
      await reply(ctx, 'کد باید دقیقاً ۶ رقم باشد. اگر کد نداری، دکمه «🔢 دریافت کد اتصال» را بزن.');
      return;
    }
    await handleCodeLink(ctx, text);
    return;
  }

  if (command === '/start') {
    upsertNotificationSettings(ctx.chat.id, undefined, PLATFORM);
    await reply(ctx, introText());
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

  if (command === '/analysis' || command === '/analyze' || text === '🧠 تحلیل بازار') {
    try {
      upsertNotificationSettings(ctx.chat.id, undefined, PLATFORM);
      const { message } = await collectAnalysis();
      await reply(ctx, message);
    } catch (error) {
      await reply(ctx, 'خطا در تحلیل بازار: ' + error.message);
    }
    return;
  }

  if (command === '/profile' || command === '/account' || text === '👤 پروفایل') {
    upsertNotificationSettings(ctx.chat.id, undefined, PLATFORM);
    await reply(ctx, formatProfileText(getProfile(ctx.chat.id, PLATFORM)));
    return;
  }

  if (command === '/link') {
    const arg = text.replace(/^\/link(@\w+)?\s*/i, '').trim();
    if (arg) {
      await handleCodeLink(ctx, arg);
      return;
    }
    await sendAccountLinkMenu(ctx);
    return;
  }

  if (command === '/phone') {
    const arg = text.replace(/^\/phone(@\w+)?\s*/i, '').trim();
    if (arg) {
      await handlePhoneLink(ctx, arg);
      return;
    }
    await sendPhonePrompt(ctx);
    return;
  }

  if (/^\d{6}$/.test(text)) {
    await handleCodeLink(ctx, text);
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

  if (command === '/audit' || command === '/parsian_audit' || command === '/parsianaudit') {
    if (!isAdminChat(ctx.chat.id)) {
      await reply(ctx, 'این بخش فقط برای ادمین فعال است.');
      return;
    }
    try {
      await replyLong(ctx, formatSourceAuditReport(getLatestSourceAudit('telegram-dollar-ParsianSarafi')));
    } catch (error) {
      await reply(ctx, 'خطا در audit پارسیان: ' + error.message);
    }
    return;
  }

  if (text === '🧪 audit پارسیان') {
    if (!isAdminChat(ctx.chat.id)) {
      await reply(ctx, 'این بخش فقط برای ادمین فعال است.');
      return;
    }
    try {
      await replyLong(ctx, formatSourceAuditReport(getLatestSourceAudit('telegram-dollar-ParsianSarafi')));
    } catch (error) {
      await reply(ctx, 'خطا در audit پارسیان: ' + error.message);
    }
    return;
  }

  if (command === '/channel_age' || command === '/channelage') {
    if (!isAdminChat(ctx.chat.id)) {
      await reply(ctx, 'این فرمان فقط برای ادمین فعال است.');
      return;
    }
    const arg = text.replace(/^\/(?:channel_age|channelage)(@\w+)?\s*/i, '').trim();
    const hours = parseHours(arg);
    if (!Number.isFinite(hours) || hours < 0.25 || hours > 48) {
      await reply(ctx, 'عدد باید بین ۰٫۲۵ تا ۴۸ ساعت باشد. نمونه: /channel_age 2');
      return;
    }
    setRuntimeConfig('channelSourceMaxAgeHours', hours);
    const snapshot = await getSnapshot();
    await reply(ctx, 'سقف تازگی تلگرام و بله روی ' + hours.toLocaleString('fa-IR') + ' ساعت تنظیم شد.\n\n' + formatAdminPanel(snapshot));
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
  if (!message || !message.chat || (!message.text && !message.contact)) return null;
  return {
    chat: message.chat,
    text: message.text || '',
    contact: message.contact,
    message
  };
}

async function pollUpdates() {
  let offset = 0;
  while (isEnabled() && !balePollingStopped) {
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
  balePollingStopped = false;
  if (config.sendStartupMessage) {
    await sendConfiguredChat('نبض بازار در بله روشن شد.').catch((error) => {
      console.error('Bale startup message failed:', error);
    });
  }
  const notificationInterval = setInterval(() => {
    runScheduledNotifications().catch((error) => {
      console.error('Bale scheduled check failed:', error);
    });
  }, 60 * 1000);
  await runScheduledNotifications().catch((error) => {
    console.error('Initial Bale check failed:', error);
  });
  pollUpdates();
  console.log('nabz bazar Bale bot started');
  return {
    stop: () => {
      balePollingStopped = true;
      clearInterval(notificationInterval);
    }
  };
}

module.exports = { startBaleBot };
