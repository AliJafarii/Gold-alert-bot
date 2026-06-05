const { Markup, Telegraf } = require('telegraf');
const { mkdir, writeFile } = require('fs/promises');
const { dirname } = require('path');
const { config } = require('./config');
const { buildReport, getSnapshot } = require('./monitor');
const { parseMarketMessage } = require('./message-parser');
const { formatAdminPanel } = require('./format');
const { formatAdminAlert, getNewAdminAlerts } = require('./admin-alerts');
const {
  getNotificationSettings,
  listDueNotificationSettings,
  markNotificationSent,
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

async function safeReply(ctx, text, extra = {}) {
  return ctx.reply(text, { ...messageOptions, ...extra });
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

function notificationKeyboard() {
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
      Markup.button.callback('خاموش', 'notify:off')
    ]
  ]);
}

function formatNotificationSettings(settings) {
  if (!settings || !settings.enabled) {
    return [
      '<b>🔔 تنظیم نوتیف قیمت</b>',
      '',
      'وضعیت فعلی: خاموش',
      '',
      'یکی از بازه‌های آماده را انتخاب کن یا برای بازه دلخواه بنویس:',
      '<code>/notify 5</code>'
    ].join('\n');
  }
  return [
    '<b>🔔 تنظیم نوتیف قیمت</b>',
    '',
    'وضعیت فعلی: روشن',
    'بازه ارسال: ' + intervalLabel(settings.interval_minutes),
    '',
    'یکی از بازه‌های آماده را انتخاب کن یا برای بازه دلخواه بنویس:',
    '<code>/notify 5</code>',
    '',
    'برای خاموش کردن:',
    '<code>/notify off</code>'
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
  if (newAdminAlerts.length) {
    await sendAdminChats(formatAdminAlert(newAdminAlerts));
  }
  return { snapshot, message };
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
      console.error('Scheduled notification failed for chat ' + settings.chat_id + ':', error);
    }
  }
}

bot.start(async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  upsertNotificationSettings(ctx.chat.id);
  const { message } = await buildReport();
  await safeReply(ctx, message);
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
  await safeReply(ctx, [
    '<b>⚙️ تنظیمات فعلی</b>',
    '',
    '• نماد طلا: ' + config.tgjuGoldSymbol,
    '• نماد سکه: ' + config.tgjuCoinSymbol,
    '• منابع فعال: ' + config.enabledSources.join(', '),
    '• آستانه خرید: ' + config.buyBubblePercent + '٪',
    '• آستانه فروش: ' + config.sellBubblePercent + '٪',
    '• فاصله جمع‌آوری داخلی: ' + config.checkIntervalMinutes + ' دقیقه'
  ].join('\n'));
});

bot.command(['notify', 'notifications'], async (ctx) => {
  upsertUser(ctx.chat, isAdminChat(ctx));
  const text = ctx.message.text.replace(/^\/(?:notify|notifications)(@\w+)?\s*/i, '').trim();
  const parsed = parseNotifyMinutes(text);
  if (parsed === 'off') {
    const settings = setNotificationEnabled(ctx.chat.id, false);
    await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard());
    return;
  }
  if (parsed === 'on') {
    const settings = setNotificationEnabled(ctx.chat.id, true);
    await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard());
    return;
  }
  if (typeof parsed === 'number') {
    if (parsed < 1 || parsed > 1440) {
      await safeReply(ctx, 'بازه نوتیف باید بین ۱ تا ۱۴۴۰ دقیقه باشد.');
      return;
    }
    const settings = setNotificationInterval(ctx.chat.id, parsed);
    await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard());
    return;
  }
  const settings = upsertNotificationSettings(ctx.chat.id);
  await safeReply(ctx, formatNotificationSettings(settings), notificationKeyboard());
});

bot.action(/^notify:(\d+|off)$/, async (ctx) => {
  const value = ctx.match[1];
  let settings;
  if (value === 'off') {
    settings = setNotificationEnabled(ctx.chat.id, false);
  } else {
    settings = setNotificationInterval(ctx.chat.id, Number(value));
  }
  await ctx.answerCbQuery('تنظیم شد');
  await ctx.editMessageText(formatNotificationSettings(settings), {
    ...messageOptions,
    ...notificationKeyboard()
  });
});

bot.command(['admin', 'sources'], async (ctx) => {
  if (!isAdminChat(ctx)) {
    await safeReply(ctx, 'این فرمان فقط برای ادمین فعال است.');
    return;
  }
  try {
    const snapshot = await getSnapshot();
    await safeReply(ctx, formatAdminPanel(snapshot));
  } catch (error) {
    await safeReply(ctx, 'خطا در پنل ادمین: ' + error.message);
  }
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

async function main() {
  bot.launch().catch((error) => {
    console.error('Bot launch failed:', error);
    process.exit(1);
  });
  console.log('Gold Alert Bot started');
  if (config.telegramChatId) {
    upsertUser(config.telegramChatId, config.adminChatIds.includes(String(config.telegramChatId)));
    upsertNotificationSettings(config.telegramChatId);
  }
  if (config.sendStartupMessage) {
    await sendConfiguredChat('بات هشدار حباب طلا روشن شد.');
  }
  setInterval(() => {
    runScheduledNotifications().catch((error) => {
      console.error('Scheduled check failed:', error);
    });
  }, 60 * 1000);
  await runScheduledNotifications().catch((error) => {
    console.error('Initial check failed:', error);
  });
}

function shutdown(signal) {
  bot.stop(signal);
  setTimeout(() => process.exit(0), 250).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
