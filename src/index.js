const { Markup, Telegraf } = require('telegraf');
const { mkdir, writeFile } = require('fs/promises');
const { dirname } = require('path');
const { config, setRuntimeConfig } = require('./config');
const { buildAnalysisReport, buildReport, getSnapshot, refreshSnapshotCache } = require('./monitor');
const { parseMarketMessage } = require('./message-parser');
const { formatAdminPanel, formatSourceAuditReport, formatBotLinks } = require('./format');
const { formatAdminAlert, getNewAdminAlerts } = require('./admin-alerts');
const { startBaleBot } = require('./bale-bot');
const {
  createAccountLinkCode,
  getProfile,
  getLatestSourceAudit,
  getNotificationSettings,
  linkAccountWithCode,
  listDueNotificationSettings,
  markNotificationSent,
  setProfilePhone,
  setNotificationEnabled,
  setNotificationInterval,
  upsertNotificationSettings,
  upsertUser
} = require('./database');

if (!config.telegramBotToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

const bot = new Telegraf(config.telegramBotToken);
const messageOptions = { disable_web_page_preview: true, parse_mode: 'HTML' };
const pendingCustomIntervals = new Set();
const pendingPhoneLinks = new Set();
const pendingCodeLinks = new Set();

function mainKeyboard(isAdmin = false) {
  const rows = [
    ['📊 گزارش فوری', '🧠 تحلیل بازار'],
    ['🔔 تنظیمات اطلاع‌رسانی', '👤 پروفایل'],
    ['🔗 اتصال اکانت‌ها'],
    ['⚙️ تنظیمات']
  ];
  if (isAdmin) rows[3].push('🛡 پنل ادمین');
  return Markup.keyboard(rows).resize();
}

async function safeReply(ctx, text, extra = {}) {
  return ctx.reply(text, { ...messageOptions, ...mainKeyboard(isAdminChat(ctx)), ...extra });
}

async function safeReplyLong(ctx, text, extra = {}) {
  const maxLength = 3500;
  const lines = String(text || '').split('\n');
  let chunk = '';
  for (const line of lines) {
    const next = chunk ? chunk + '\n' + line : line;
    if (next.length > maxLength && chunk) {
      await safeReply(ctx, chunk, extra);
      chunk = line;
    } else {
      chunk = next;
    }
  }
  if (chunk) await safeReply(ctx, chunk, extra);
}

async function sendConfiguredChat(text) {
  if (!config.telegramChatId) return;
  await bot.telegram.sendMessage(config.telegramChatId, text, messageOptions);
}

async function sendChat(chatId, text) {
  await bot.telegram.sendMessage(chatId, text, messageOptions);
}

async function sendAdminChats(text) {
  for (const chatId of config.adminChatIds) {
    await bot.telegram.sendMessage(chatId, text, messageOptions);
  }
}

function isAdminChat(ctx) {
  return config.adminChatIds.includes(String(ctx.chat && ctx.chat.id));
}

function intervalLabel(minutes) {
  if (minutes < 60) return minutes.toLocaleString('fa-IR') + ' دقیقه';
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours.toLocaleString('fa-IR') + ' ساعت';
  }
  return minutes.toLocaleString('fa-IR') + ' دقیقه';
}

function notificationKeyboard(settings) {
  const toggleButton = settings && settings.enabled
    ? Markup.button.callback('خاموش', 'notify:off')
    : Markup.button.callback('روشن', 'notify:on');
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('۱۰ دقیقه', 'notify:10'),
      Markup.button.callback('۳۰ دقیقه', 'notify:30')
    ],
    [
      Markup.button.callback('۱ ساعت', 'notify:60'),
      Markup.button.callback('۲ ساعت', 'notify:120')
    ],
    [
      Markup.button.callback('۶ ساعت', 'notify:360'),
      Markup.button.callback('۱۲ ساعت', 'notify:720'),
      Markup.button.callback('۲۴ ساعت', 'notify:1440')
    ],
    [
      toggleButton
    ],
    [
      Markup.button.callback('بازه دلخواه', 'notify:custom')
    ]
  ]);
}

function adminKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('۱ ساعت', 'admin:channelAge:1'),
      Markup.button.callback('۲ ساعت', 'admin:channelAge:2'),
      Markup.button.callback('۳ ساعت', 'admin:channelAge:3')
    ],
    [
      Markup.button.callback('۶ ساعت', 'admin:channelAge:6'),
      Markup.button.callback('۱۲ ساعت', 'admin:channelAge:12')
    ],
    [
      Markup.button.callback('🧪 audit پارسیان', 'admin:parsianAudit')
    ]
  ]);
}

function formatNotificationSettings(settings) {
  if (!settings || !settings.enabled) {
    return [
      '<b>🔔 تنظیمات اطلاع‌رسانی</b>',
      '',
      'وضعیت فعلی: خاموش',
      '',
      'برای شروع، یکی از بازه‌های آماده را انتخاب کن یا «بازه دلخواه» را بزن.'
    ].join('\n');
  }
  return [
    '<b>🔔 تنظیمات اطلاع‌رسانی</b>',
    '',
    'وضعیت فعلی: روشن',
    'بازه ارسال: ' + intervalLabel(settings.interval_minutes),
    '',
    'یکی از بازه‌های آماده را انتخاب کن یا «بازه دلخواه» را بزن.'
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
    ...formatBotLinks('telegram'),
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

function phoneRequestKeyboard(ctx) {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 ارسال شماره موبایل')],
    ['📊 گزارش فوری', '🧠 تحلیل بازار'],
    ['🔔 تنظیمات اطلاع‌رسانی', '👤 پروفایل'],
    ['🔗 اتصال اکانت‌ها'],
    ['⚙️ تنظیمات']
  ]).resize();
}

function accountLinkKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📱 ثبت شماره موبایل', 'account:phone')
    ],
    [
      Markup.button.callback('🔢 دریافت کد اتصال', 'account:create_code'),
      Markup.button.callback('⌨️ وارد کردن کد', 'account:enter_code')
    ]
  ]);
}

async function sendAccountLinkMenu(ctx, edit = false) {
  const text = [
    '<b>🔗 اتصال تلگرام و بله</b>',
    '',
    'برای یکی‌کردن پروفایل و تنظیمات نوتیف، یکی از این روش‌ها را انتخاب کن:',
    '',
    '📱 شماره موبایل: همان شماره را در هر دو بات تایید کن.',
    '🔢 کد اتصال: از یک بات کد بگیر و در بات دیگر وارد کن.',
    '',
    'اگر نمی‌خواهی شماره موبایل بدهی، روش کد را انتخاب کن.'
  ].join('\n');
  if (edit) {
    await ctx.editMessageText(text, { ...messageOptions, ...accountLinkKeyboard() });
    return;
  }
  await safeReply(ctx, text, accountLinkKeyboard());
}

async function sendPhonePrompt(ctx) {
  pendingPhoneLinks.add(String(ctx.chat.id));
  await ctx.reply([
    '<b>📱 اتصال با شماره موبایل</b>',
    '',
    'شماره موبایل فقط برای لینک‌کردن پروفایل تلگرام و بله استفاده می‌شود.',
    'اگر همین شماره را در بات دیگر هم تایید کنی، دو اکانت یکی می‌شوند.',
    '',
    'دکمه ارسال شماره را بزن یا شماره را همینجا بنویس.',
    'اگر نمی‌خواهی شماره بدهی، از بخش اتصال، روش کد را انتخاب کن.'
  ].join('\n'), { ...messageOptions, ...phoneRequestKeyboard(ctx) });
}

async function sendCreatedLinkCode(ctx) {
  pendingCodeLinks.delete(String(ctx.chat.id));
  const link = createAccountLinkCode(ctx.chat.id);
  await safeReply(ctx, [
    '<b>🔢 کد اتصال</b>',
    '',
    'این کد تا ۱۵ دقیقه دیگر معتبر است:',
    '<code>' + link.code + '</code>',
    '',
    'در بات دیگر دکمه «⌨️ وارد کردن کد» را بزن و همین عدد را بفرست.'
  ].join('\n'), accountLinkKeyboard());
}

async function sendCodePrompt(ctx) {
  pendingCodeLinks.add(String(ctx.chat.id));
  await safeReply(ctx, [
    '<b>⌨️ وارد کردن کد اتصال</b>',
    '',
    'کد ۶ رقمی‌ای که از بات دیگر گرفتی را همینجا بفرست.',
    'اگر کد نداری، اول «🔢 دریافت کد اتصال» را بزن.'
  ].join('\n'), accountLinkKeyboard());
}

async function handleCodeLink(ctx, code) {
  const result = linkAccountWithCode(ctx.chat.id, code);
  pendingCodeLinks.delete(String(ctx.chat.id));
  if (!result.ok) {
    await safeReply(ctx, result.reason === 'expired'
      ? 'کد اتصال منقضی شده است. از دکمه «🔢 دریافت کد اتصال» یک کد تازه بگیر.'
      : 'کد اتصال معتبر نیست. اگر کد نداری، از دکمه «🔢 دریافت کد اتصال» استفاده کن.', accountLinkKeyboard());
    return;
  }
  await safeReply(ctx, 'اکانت‌ها متصل شدند. از این به بعد تنظیمات نوتیف و پروفایل بین تلگرام و بله مشترک است.\n\n' + formatProfileText(getProfile(ctx.chat.id)));
}

async function handlePhoneLink(ctx, rawPhone) {
  const result = setProfilePhone(ctx.chat.id, rawPhone);
  pendingPhoneLinks.delete(String(ctx.chat.id));
  if (!result.ok) {
    await safeReply(ctx, [
      'شماره موبایل معتبر نبود.',
      'برای اتصال با شماره، باید شماره یکسان را در هر دو بات تایید کنی.',
      'اگر نمی‌خواهی شماره بدهی، از دکمه «🔢 دریافت کد اتصال» استفاده کن.'
    ].join('\n'), accountLinkKeyboard());
    return;
  }
  if (result.linked) {
    await safeReply(ctx, 'اکانت‌ها با شماره موبایل متصل شدند. تنظیمات نوتیف و پروفایل از این به بعد مشترک است.\n\n' + formatProfileText(getProfile(ctx.chat.id)));
    return;
  }
  await safeReply(ctx, [
    'شماره موبایل ثبت شد.',
    'برای تکمیل اتصال، در بات دیگر هم دکمه «📱 ثبت شماره موبایل» را بزن و همین شماره را تایید کن.',
    'تا وقتی شماره در هر دو طرف تایید نشود، اکانت‌ها با روش شماره موبایل لینک نمی‌شوند. روش کد ۶ رقمی هم همچنان فعال است.'
  ].join('\n'), accountLinkKeyboard());
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

async function setChannelAgeHours(ctx, hours, edit = false) {
  if (!isAdminChat(ctx)) {
    if (edit) await ctx.answerCbQuery('این بخش فقط برای ادمین فعال است.');
    else await safeReply(ctx, 'این فرمان فقط برای ادمین فعال است.');
    return;
  }
  if (!Number.isFinite(hours) || hours < 0.25 || hours > 48) {
    if (edit) await ctx.answerCbQuery('عدد باید بین ۰٫۲۵ تا ۴۸ ساعت باشد.');
    else await safeReply(ctx, 'عدد باید بین ۰٫۲۵ تا ۴۸ ساعت باشد.');
    return;
  }
  setRuntimeConfig('channelSourceMaxAgeHours', hours);
  const snapshot = await getSnapshot();
  const text = formatAdminPanel(snapshot);
  if (edit) {
    await ctx.answerCbQuery('تنظیم شد');
    await ctx.editMessageText(text, { ...messageOptions, ...adminKeyboard() });
  } else {
    await safeReply(ctx, 'سقف تازگی تلگرام و بله روی ' + hours.toLocaleString('fa-IR') + ' ساعت تنظیم شد.\n\n' + text, adminKeyboard());
  }
}

async function collectReport() {
  const { snapshot, message } = await buildReport('telegram');
  const newAdminAlerts = await getNewAdminAlerts(snapshot);
  if (newAdminAlerts.length) {
    await sendAdminChats(formatAdminAlert(newAdminAlerts));
  }
  return { snapshot, message };
}

async function collectAnalysis() {
  const { snapshot, message } = await buildAnalysisReport('telegram');
  const newAdminAlerts = await getNewAdminAlerts(snapshot);
  if (newAdminAlerts.length) {
    await sendAdminChats(formatAdminAlert(newAdminAlerts));
  }
  return { snapshot, message };
}

async function sendImmediateReportAndStartInterval(chatId) {
  const { message } = await collectReport();
  await sendChat(chatId, message);
  markNotificationSent(chatId);
}

async function runScheduledNotifications() {
  const dueSettings = listDueNotificationSettings();
  if (!dueSettings.length) return;
  const { message } = await collectReport();
  const sentAt = new Date().toISOString();
  for (const settings of dueSettings) {
    try {
      await sendChat(settings.chat_id, message);
      markNotificationSent(settings.chat_id, sentAt);
    } catch (error) {
      if (/forbidden|blocked/i.test(String(error && error.message || error))) {
        setNotificationEnabled(settings.chat_id, false);
      }
      console.error('Scheduled notification failed for chat ' + settings.chat_id + ':', error);
    }
  }
}

async function configureTelegramBotInfo() {
  const description = [
    'نبض بازار، ربات پایش قیمت طلا، سکه، دلار و نقره است.',
    'گزارش فوری، تحلیل جداگانه بازار، اطلاع‌رسانی دوره‌ای و اتصال پروفایل تلگرام/بله را از دکمه‌های داخل بات مدیریت کن.',
    '',
    ...formatBotLinks('telegram')
  ].join('\n');
  const shortDescription = 'پایش قیمت طلا، سکه، دلار و نقره با گزارش و تحلیل جداگانه';
  await bot.telegram.setMyDescription(description).catch((error) => {
    console.error('Telegram setMyDescription failed:', error.message);
  });
  await bot.telegram.setMyShortDescription(shortDescription).catch((error) => {
    console.error('Telegram setMyShortDescription failed:', error.message);
  });
}

bot.start(async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  upsertNotificationSettings(ctx.chat.id);
  await safeReply(ctx, introText());
});

bot.command('check', async (ctx) => {
  try {
    upsertUser(ctx.chat, isAdminChat(ctx));
    upsertNotificationSettings(ctx.chat.id);
    const { message } = await collectReport();
    await safeReply(ctx, message);
  } catch (error) {
    await safeReply(ctx, 'خطا در بررسی قیمت: ' + error.message);
  }
});

bot.command('settings', async (ctx) => {
  await sendSettings(ctx);
});

bot.command(['analysis', 'analyze'], async (ctx) => {
  try {
    upsertUser(ctx.chat, isAdminChat(ctx));
    upsertNotificationSettings(ctx.chat.id);
    const { message } = await collectAnalysis();
    await safeReply(ctx, message);
  } catch (error) {
    await safeReply(ctx, 'خطا در تحلیل بازار: ' + error.message);
  }
});

bot.command(['profile', 'account'], async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  upsertNotificationSettings(ctx.chat.id);
  await safeReply(ctx, formatProfileText(getProfile(ctx.chat.id)));
});

bot.command('link', async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  const arg = ctx.message.text.replace(/^\/link(@\w+)?\s*/i, '').trim();
  if (arg) {
    await handleCodeLink(ctx, arg);
    return;
  }
  await sendAccountLinkMenu(ctx);
});

bot.command('phone', async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  const arg = ctx.message.text.replace(/^\/phone(@\w+)?\s*/i, '').trim();
  if (arg) {
    await handlePhoneLink(ctx, arg);
    return;
  }
  await sendPhonePrompt(ctx);
});

bot.on('contact', async (ctx) => {
  const contact = ctx.message && ctx.message.contact;
  if (!contact || (contact.user_id && ctx.from && contact.user_id !== ctx.from.id)) {
    await safeReply(ctx, 'برای اتصال، شماره خودت را بفرست. اگر نمی‌خواهی شماره بدهی، از دکمه «🔢 دریافت کد اتصال» استفاده کن.', accountLinkKeyboard());
    return;
  }
  await handlePhoneLink(ctx, contact.phone_number);
});

async function sendSettings(ctx) {
  await safeReply(ctx, [
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

bot.command(['notify', 'notifications'], async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  const text = ctx.message.text.replace(/^\/(?:notify|notifications)(@\w+)?\s*/i, '').trim();
  const parsed = parseNotifyMinutes(text);
  if (parsed === 'off') {
    const settings = setNotificationEnabled(ctx.chat.id, false);
    await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard(settings));
    return;
  }
  if (parsed === 'on') {
    const settings = setNotificationEnabled(ctx.chat.id, true);
    await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard(settings));
    await sendImmediateReportAndStartInterval(ctx.chat.id);
    return;
  }
  if (typeof parsed === 'number') {
    if (parsed < 1 || parsed > 1440) {
      await safeReply(ctx, 'بازه نوتیف باید بین ۱ تا ۱۴۴۰ دقیقه باشد.');
      return;
    }
    const settings = setNotificationInterval(ctx.chat.id, parsed);
    await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard(settings));
    await sendImmediateReportAndStartInterval(ctx.chat.id);
    return;
  }
  const settings = upsertNotificationSettings(ctx.chat.id);
  await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard(settings));
});

bot.hears('📊 گزارش فوری', async (ctx) => {
  try {
    upsertUser(ctx.chat, isAdminChat(ctx));
    upsertNotificationSettings(ctx.chat.id);
    const { message } = await collectReport();
    await safeReply(ctx, message);
  } catch (error) {
    await safeReply(ctx, 'خطا در بررسی قیمت: ' + error.message);
  }
});

bot.hears('🧠 تحلیل بازار', async (ctx) => {
  try {
    upsertUser(ctx.chat, isAdminChat(ctx));
    upsertNotificationSettings(ctx.chat.id);
    const { message } = await collectAnalysis();
    await safeReply(ctx, message);
  } catch (error) {
    await safeReply(ctx, 'خطا در تحلیل بازار: ' + error.message);
  }
});

bot.hears('🔔 تنظیمات اطلاع‌رسانی', async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  const settings = upsertNotificationSettings(ctx.chat.id);
  await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard(settings));
});

bot.hears('👤 پروفایل', async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  upsertNotificationSettings(ctx.chat.id);
  await safeReply(ctx, formatProfileText(getProfile(ctx.chat.id)));
});

bot.hears('🔗 اتصال اکانت‌ها', async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  await sendAccountLinkMenu(ctx);
});

bot.hears('⚙️ تنظیمات', async (ctx) => {
  await sendSettings(ctx);
});

bot.hears('🛡 پنل ادمین', async (ctx) => {
  if (!isAdminChat(ctx)) {
    await safeReply(ctx, 'این بخش فقط برای ادمین فعال است.');
    return;
  }
  try {
    const snapshot = await getSnapshot();
    await safeReply(ctx, formatAdminPanel(snapshot), adminKeyboard());
  } catch (error) {
    await safeReply(ctx, 'خطا در پنل ادمین: ' + error.message);
  }
});

bot.hears('🧪 audit پارسیان', async (ctx) => {
  if (!isAdminChat(ctx)) {
    await safeReply(ctx, 'این بخش فقط برای ادمین فعال است.');
    return;
  }
  try {
    await safeReplyLong(ctx, formatSourceAuditReport(getLatestSourceAudit('telegram-dollar-ParsianSarafi')));
  } catch (error) {
    await safeReply(ctx, 'خطا در audit پارسیان: ' + error.message);
  }
});

bot.action(/^notify:(\d+|on|off)$/, async (ctx) => {
  const value = ctx.match[1];
  let settings;
  if (value === 'off') {
    settings = setNotificationEnabled(ctx.chat.id, false);
  } else if (value === 'on') {
    settings = setNotificationEnabled(ctx.chat.id, true);
  } else {
    settings = setNotificationInterval(ctx.chat.id, Number(value));
  }
  await ctx.answerCbQuery('تنظیم شد');
  await ctx.editMessageText(formatNotificationSettings(settings), {
    ...messageOptions,
    ...notificationKeyboard(settings)
  });
  if (value !== 'off') {
    await sendImmediateReportAndStartInterval(ctx.chat.id);
  }
});

bot.action('notify:custom', async (ctx) => {
  pendingCustomIntervals.add(String(ctx.chat.id));
  await ctx.answerCbQuery('عدد دقیقه را بفرست');
  await safeReply(ctx, [
    '<b>✏️ بازه دلخواه</b>',
    '',
    'عدد دقیقه را همینجا بفرست.',
    'مثلاً: <code>5</code>'
  ].join('\n'));
});

bot.action('account:phone', async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  await ctx.answerCbQuery('شماره موبایل');
  await sendPhonePrompt(ctx);
});

bot.action('account:create_code', async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  await ctx.answerCbQuery('کد ساخته شد');
  await sendCreatedLinkCode(ctx);
});

bot.action('account:enter_code', async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  await ctx.answerCbQuery('کد را بفرست');
  await sendCodePrompt(ctx);
});

bot.action(/^admin:channelAge:(\d+)$/, async (ctx) => {
  await setChannelAgeHours(ctx, Number(ctx.match[1]), true);
});

bot.action('admin:parsianAudit', async (ctx) => {
  if (!isAdminChat(ctx)) {
    await ctx.answerCbQuery('این بخش فقط برای ادمین فعال است.');
    return;
  }
  try {
    await ctx.answerCbQuery('audit پارسیان');
    await safeReplyLong(ctx, formatSourceAuditReport(getLatestSourceAudit('telegram-dollar-ParsianSarafi')));
  } catch (error) {
    await safeReply(ctx, 'خطا در audit پارسیان: ' + error.message);
  }
});

bot.on('text', async (ctx, next) => {
  const chatId = String(ctx.chat.id);
  const text = String(ctx.message.text || '').trim();
  if (text === '🔗 اتصال اکانت‌ها') {
    pendingPhoneLinks.delete(chatId);
    pendingCodeLinks.delete(chatId);
    await sendAccountLinkMenu(ctx);
    return;
  }
  if (pendingPhoneLinks.has(chatId)) {
    await handlePhoneLink(ctx, text);
    return;
  }
  if (pendingCodeLinks.has(chatId)) {
    if (!/^\d{6}$/.test(text)) {
      await safeReply(ctx, 'کد باید دقیقاً ۶ رقم باشد. اگر کد نداری، دکمه «🔢 دریافت کد اتصال» را بزن.', accountLinkKeyboard());
      return;
    }
    upsertUser(ctx.chat, isAdminChat(ctx));
    await handleCodeLink(ctx, text);
    return;
  }
  if (!pendingCustomIntervals.has(chatId)) {
    if (/^\d{6}$/.test(text)) {
      upsertUser(ctx.chat, isAdminChat(ctx));
      await handleCodeLink(ctx, text);
      return;
    }
    return next();
  }
  const minutes = parseNotifyMinutes(ctx.message.text);
  if (typeof minutes !== 'number' || minutes < 1 || minutes > 1440) {
    await safeReply(ctx, 'یک عدد بین ۱ تا ۱۴۴۰ دقیقه بفرست.');
    return;
  }
  pendingCustomIntervals.delete(chatId);
  const settings = setNotificationInterval(ctx.chat.id, minutes);
  await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard(settings));
  await sendImmediateReportAndStartInterval(ctx.chat.id);
});

bot.command(['admin', 'sources'], async (ctx) => {
  if (!isAdminChat(ctx)) {
    await safeReply(ctx, 'این فرمان فقط برای ادمین فعال است.');
    return;
  }
  try {
    const snapshot = await getSnapshot();
    await safeReply(ctx, formatAdminPanel(snapshot), adminKeyboard());
  } catch (error) {
    await safeReply(ctx, 'خطا در پنل ادمین: ' + error.message);
  }
});

bot.command(['audit', 'parsian_audit', 'parsianaudit'], async (ctx) => {
  if (!isAdminChat(ctx)) {
    await safeReply(ctx, 'این فرمان فقط برای ادمین فعال است.');
    return;
  }
  try {
    const audit = getLatestSourceAudit('telegram-dollar-ParsianSarafi');
    await safeReplyLong(ctx, formatSourceAuditReport(audit));
  } catch (error) {
    await safeReply(ctx, 'خطا در audit پارسیان: ' + error.message);
  }
});

bot.command(['channel_age', 'channelage'], async (ctx) => {
  const text = ctx.message.text.replace(/^\/(?:channel_age|channelage)(@\w+)?\s*/i, '').trim();
  const hours = parseHours(text);
  await setChannelAgeHours(ctx, hours, false);
});

bot.command('source', async (ctx) => {
  const text = ctx.message.text.replace(/^\/source(@\w+)?\s*/i, '').trim();
  const source = parseMarketMessage(text, 'manual');
  if (!source) {
    await safeReply(ctx, 'قیمت قابل تشخیص پیدا نکردم؛ متن پیام قیمت را بعد از فرمان source بفرست.');
    return;
  }
  await mkdir(dirname(config.externalSourcesFile), { recursive: true });
  await writeFile(config.externalSourcesFile, JSON.stringify([source], null, 2));
  const { message } = await collectReport();
  await safeReply(ctx, 'منبع دستی ذخیره شد.\n\n' + message);
});

bot.catch((error) => {
  console.error('Bot error:', error);
});

let runtime = null;

async function startNabzBazarBot() {
  if (runtime) return runtime;
  console.log('nabz bazar runtime starting');
  const intervals = [];
  console.log('nabz bazar configuring Telegram bot info');
  await configureTelegramBotInfo();
  console.log('nabz bazar launching Telegram bot');
  bot.launch().catch((error) => {
    console.error('Bot launch failed:', error);
  });
  console.log('nabz bazar Telegram bot started');
  if (config.sendStartupMessage) {
    await sendConfiguredChat('نبض بازار روشن شد.');
  }
  refreshSnapshotCache().catch((error) => {
    console.error('Initial cache refresh failed:', error);
  });
  intervals.push(setInterval(() => {
    refreshSnapshotCache().catch((error) => {
      console.error('Snapshot cache refresh failed:', error);
    });
  }, Math.max(15, Number(config.snapshotRefreshIntervalSeconds || 60)) * 1000));
  intervals.push(setInterval(() => {
    runScheduledNotifications().catch((error) => {
      console.error('Scheduled check failed:', error);
    });
  }, 60 * 1000));
  await runScheduledNotifications().catch((error) => {
    console.error('Initial check failed:', error);
  });
  console.log('nabz bazar starting Bale bot');
  const baleRuntime = await startBaleBot();
  console.log('nabz bazar runtime started');
  runtime = {
    stop: (signal = 'SIGTERM') => {
      intervals.forEach(clearInterval);
      if (baleRuntime && typeof baleRuntime.stop === 'function') baleRuntime.stop();
      bot.stop(signal);
      runtime = null;
    }
  };
  return runtime;
}

function shutdown(signal) {
  if (runtime) runtime.stop(signal);
  setTimeout(() => process.exit(0), 250).unref();
}

async function main() {
  await startNabzBazarBot();
}

if (require.main === module) {
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { startNabzBazarBot };
