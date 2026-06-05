const { Telegraf } = require('telegraf');
const { mkdir, writeFile } = require('fs/promises');
const { dirname } = require('path');
const { config } = require('./config');
const { buildReport, getSnapshot, shouldAlert } = require('./monitor');
const { parseMarketMessage } = require('./message-parser');
const { formatAdminPanel } = require('./format');
const { formatAdminAlert, getNewAdminAlerts } = require('./admin-alerts');

if (!config.telegramBotToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

const bot = new Telegraf(config.telegramBotToken);
let previousDecision = 'hold';
const messageOptions = { disable_web_page_preview: true, parse_mode: 'HTML' };

async function safeReply(ctx, text) {
  return ctx.reply(text, messageOptions);
}

async function sendConfiguredChat(text) {
  if (!config.telegramChatId) return;
  await bot.telegram.sendMessage(config.telegramChatId, text, messageOptions);
}

async function sendAdminChats(text) {
  for (const chatId of config.adminChatIds) {
    await bot.telegram.sendMessage(chatId, text, messageOptions);
  }
}

function isAdminChat(ctx) {
  return config.adminChatIds.includes(String(ctx.chat && ctx.chat.id));
}

async function runCheck({ force = false } = {}) {
  const { snapshot, message } = await buildReport();
  const newAdminAlerts = await getNewAdminAlerts(snapshot);
  if (newAdminAlerts.length) {
    await sendAdminChats(formatAdminAlert(newAdminAlerts));
  }
  if (force || config.alwaysSendReport || shouldAlert(snapshot, previousDecision)) {
    await sendConfiguredChat(message);
  }
  previousDecision = snapshot.decision;
  return { snapshot, message };
}

bot.start(async (ctx) => {
  const { message } = await buildReport();
  await safeReply(ctx, message);
});

bot.command('check', async (ctx) => {
  try {
    const { message } = await runCheck({ force: true });
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
    '• فاصله بررسی: ' + config.checkIntervalMinutes + ' دقیقه'
  ].join('\n'));
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
  const { message } = await runCheck({ force: true });
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
  if (config.sendStartupMessage) {
    await sendConfiguredChat('بات هشدار حباب طلا روشن شد.');
  }
  setInterval(() => {
    runCheck().catch((error) => {
      console.error('Scheduled check failed:', error);
    });
  }, config.checkIntervalMinutes * 60 * 1000);
  await runCheck({ force: false }).catch((error) => {
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
