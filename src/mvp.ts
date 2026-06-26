// @ts-nocheck
const { config } = require('./config');

const ASSETS = {
  usd: { title: 'دلار آزاد', aliases: ['usd', 'dollar', 'دلار', 'دلار آزاد'], icon: '💵' },
  usdt: { title: 'تتر', aliases: ['usdt', 'tether', 'تتر'], icon: '💲' },
  gold18: { title: 'طلای ۱۸ عیار', aliases: ['gold18', 'gold', 'طلا', 'طلای ۱۸', 'طلای 18', '۱۸', '18'], icon: '🌕' },
  coin: { title: 'سکه امامی', aliases: ['coin', 'emami', 'سکه', 'امامی', 'سکه امامی'], icon: '🟡' },
  half_coin: { title: 'نیم سکه', aliases: ['half', 'half_coin', 'نیم', 'نیم سکه'], icon: '🟡' },
  quarter_coin: { title: 'ربع سکه', aliases: ['quarter', 'quarter_coin', 'ربع', 'ربع سکه'], icon: '🟡' },
  gram_coin: { title: 'سکه گرمی', aliases: ['gram', 'gram_coin', 'گرمی', 'سکه گرمی'], icon: '🟡' },
  silver: { title: 'نقره ۹۹۹', aliases: ['silver', 'نقره'], icon: '🪙' }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeDigits(value) {
  return String(value || '')
    .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
}

function parseNumber(value) {
  const normalized = normalizeDigits(value)
    .replace(/[٬,،\s]/g, '')
    .replace(/٫/g, '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function formatToman(value) {
  if (!Number.isFinite(Number(value))) return 'در حال بروزرسانی';
  return Math.round(Number(value)).toLocaleString('fa-IR') + ' تومان';
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return 'نامشخص';
  const prefix = Number(value) > 0 ? '+' : '';
  return prefix + Number(value).toLocaleString('fa-IR', { maximumFractionDigits: 2 }) + '٪';
}

function normalizeAsset(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;
  for (const [key, asset] of Object.entries(ASSETS)) {
    if (key === raw || asset.aliases.some((alias) => alias.toLowerCase() === raw)) return key;
  }
  for (const [key, asset] of Object.entries(ASSETS)) {
    if (asset.aliases.some((alias) => raw.includes(alias.toLowerCase()))) return key;
  }
  return null;
}

function assetValue(snapshot, assetKey) {
  const extraCoins = snapshot && snapshot.extraCoins ? snapshot.extraCoins : {};
  const toToman = (value) => Number.isFinite(Number(value)) ? Number(value) / 10 : value;
  const map = {
    usd: snapshot && snapshot.dollarToman,
    usdt: snapshot && snapshot.tetherToman,
    gold18: toToman(snapshot && snapshot.gold && snapshot.gold.price),
    coin: toToman(snapshot && snapshot.coin && snapshot.coin.price),
    half_coin: toToman(extraCoins.half && extraCoins.half.price),
    quarter_coin: toToman(extraCoins.quarter && extraCoins.quarter.price),
    gram_coin: toToman(extraCoins.gram && extraCoins.gram.price),
    silver: toToman(snapshot && snapshot.silverPrice)
  };
  const asset = ASSETS[assetKey];
  if (!asset) return null;
  const price = Number(map[assetKey]);
  if (!Number.isFinite(price) || price <= 0) return { ...asset, key: assetKey, price: null };
  return { ...asset, key: assetKey, price };
}

function allAssetValues(snapshot, requestedAssets = null) {
  const keys = Array.isArray(requestedAssets) && requestedAssets.length ? requestedAssets : Object.keys(ASSETS);
  return keys.map((key) => assetValue(snapshot, key)).filter(Boolean);
}

function parsePriceAlertCommand(text) {
  const arg = String(text || '')
    .replace(/^\/(?:alert|هشدار)(@\w+)?\s*/i, '')
    .trim();
  if (!arg) return null;
  const asset = normalizeAsset(arg.split(/\s+/)[0]) || normalizeAsset(arg);
  const condition = /<|کمتر|زیر|پایین/i.test(arg)
    ? 'less_than'
    : />|بیشتر|بالا|رسید|حداقل/i.test(arg)
      ? 'greater_than'
      : null;
  const numbers = normalizeDigits(arg).match(/[0-9][0-9,٬،\s.]*/g) || [];
  const targetPrice = numbers.length ? parseNumber(numbers[numbers.length - 1]) : null;
  if (!asset || !condition || !targetPrice) return null;
  const repeatType = /همیشه|always/i.test(arg)
    ? 'always'
    : /روزانه|daily/i.test(arg)
      ? 'daily_once'
      : 'once';
  return { asset, condition, targetPrice, repeatType };
}

function parseScheduledReportCommand(text) {
  const arg = String(text || '').replace(/^\/(?:report_time|schedule|گزارش)(@\w+)?\s*/i, '').trim();
  if (!arg) return null;
  const timeMatch = normalizeDigits(arg).match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/);
  if (!timeMatch) return null;
  const scheduleTime = String(timeMatch[1]).padStart(2, '0') + ':' + timeMatch[2];
  const assets = [];
  for (const token of arg.split(/[\s,،]+/)) {
    const asset = normalizeAsset(token);
    if (asset && !assets.includes(asset)) assets.push(asset);
  }
  return { scheduleTime, assets: assets.length ? assets : ['usd', 'usdt', 'gold18', 'coin'], messengerChannel: 'both' };
}

function subscriptionLabel(subscription) {
  if (!subscription) return 'نامشخص';
  const statusLabels = {
    free: 'رایگان',
    trial: 'آزمایشی',
    active: 'فعال',
    expired: 'منقضی',
    cancelled: 'لغوشده'
  };
  const planLabels = { free: 'رایگان', basic: 'پایه', pro: 'حرفه‌ای' };
  return (statusLabels[subscription.status] || subscription.status) + ' / ' + (planLabels[subscription.plan] || subscription.plan);
}

function formatSubscriptionText(profileData) {
  const subscription = profileData.subscription || {};
  const trialEnd = subscription.trial_ends_at
    ? new Date(subscription.trial_ends_at).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })
    : 'ثبت نشده';
  const expiresAt = subscription.expires_at
    ? new Date(subscription.expires_at).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })
    : 'ثبت نشده';
  return [
    '<b>💳 اشتراک من</b>',
    '',
    'وضعیت: ' + subscriptionLabel(subscription),
    'پایان دوره آزمایشی/اشتراک: ' + expiresAt,
    'پایان trial: ' + trialEnd,
    '',
    'هشدار فعال: ' + Number(profileData.alertCounts && profileData.alertCounts.active || 0).toLocaleString('fa-IR'),
    'گزارش زمان‌بندی‌شده فعال: ' + Number(profileData.reportCounts && profileData.reportCounts.active || 0).toLocaleString('fa-IR'),
    '',
    config.paymentInstructions
  ].join('\n');
}

function formatPlansText() {
  return [
    '<b>💳 پلن‌های نبض بازار</b>',
    '',
    'پلن رایگان: مشاهده قیمت و ۱ هشدار فعال',
    'پلن پایه: ماهانه ۴۹ هزار تومان، ۵ هشدار قیمت و ۱ گزارش روزانه',
    'پلن حرفه‌ای: ماهانه ۹۹ هزار تومان، ۳۰ هشدار قیمت و چند گزارش روزانه',
    '',
    'دوره آزمایشی کاربران جدید: ۷ روز با امکانات حرفه‌ای',
    '',
    config.paymentInstructions
  ].join('\n');
}

function formatAlertList(alerts) {
  if (!alerts.length) {
    return [
      '<b>🎯 هشدارهای من</b>',
      '',
      'هنوز هشدار فعالی نداری.',
      'نمونه ساخت هشدار:',
      '<code>/alert usdt &gt; 93000</code>',
      '<code>/alert dollar &lt; 90000</code>'
    ].join('\n');
  }
  return [
    '<b>🎯 هشدارهای من</b>',
    '',
    ...alerts.map((alert) => {
      const asset = ASSETS[alert.asset] || { title: alert.asset };
      const condition = alert.condition === 'less_than' ? 'کمتر از' : 'بیشتر از';
      return [
        '#' + alert.id.toLocaleString('fa-IR'),
        alert.is_active ? 'فعال' : 'خاموش',
        asset.title,
        condition,
        formatToman(alert.target_price),
        'تکرار: ' + alert.repeat_type
      ].join(' | ');
    }),
    '',
    'برای خاموش کردن: <code>/alert_off 12</code>'
  ].join('\n');
}

function formatReportList(reports) {
  if (!reports.length) {
    return [
      '<b>🕘 گزارش‌های من</b>',
      '',
      'هنوز گزارش زمان‌بندی‌شده نداری.',
      'نمونه ساخت گزارش:',
      '<code>/report_time 09:00 usd,usdt,gold18</code>'
    ].join('\n');
  }
  return [
    '<b>🕘 گزارش‌های من</b>',
    '',
    ...reports.map((report) => {
      const assets = JSON.parse(report.assets_json || '[]').map((key) => ASSETS[key] ? ASSETS[key].title : key).join('، ');
      return [
        '#' + report.id.toLocaleString('fa-IR'),
        report.is_active ? 'فعال' : 'خاموش',
        report.schedule_time,
        assets
      ].join(' | ');
    }),
    '',
    'برای خاموش کردن: <code>/report_off 12</code>'
  ].join('\n');
}

function formatPriceAlertCreated(alert) {
  const asset = ASSETS[alert.asset] || { title: alert.asset };
  const condition = alert.condition === 'less_than' ? 'کمتر از' : 'بیشتر از';
  return [
    '<b>🎯 هشدار ساخته شد</b>',
    '',
    asset.title + ' ' + condition + ' ' + formatToman(alert.target_price),
    'شناسه هشدار: #' + Number(alert.id).toLocaleString('fa-IR')
  ].join('\n');
}

function formatScheduledReportCreated(report) {
  const assets = JSON.parse(report.assets_json || '[]').map((key) => ASSETS[key] ? ASSETS[key].title : key).join('، ');
  return [
    '<b>🕘 گزارش زمان‌بندی‌شده ساخته شد</b>',
    '',
    'ساعت ارسال: ' + report.schedule_time,
    'دارایی‌ها: ' + assets,
    'شناسه گزارش: #' + Number(report.id).toLocaleString('fa-IR')
  ].join('\n');
}

function formatLimitText(type, limit, subscription) {
  const label = type === 'report' ? 'گزارش زمان‌بندی‌شده' : 'هشدار فعال';
  return [
    'سقف پلن فعلی برای ' + label + ' پر شده است.',
    'پلن فعلی: ' + subscriptionLabel(subscription),
    'سقف فعلی: ' + Number(limit || 0).toLocaleString('fa-IR')
  ].join('\n');
}

function alertMatches(alert, snapshot) {
  const asset = assetValue(snapshot, alert.asset);
  if (!asset || !asset.price) return { ok: false, asset, reason: 'no_price' };
  const conditionMet = alert.condition === 'less_than'
    ? asset.price <= Number(alert.target_price)
    : asset.price >= Number(alert.target_price);
  if (!conditionMet) return { ok: false, asset, reason: 'condition' };
  if (alert.last_triggered_at) {
    const last = Date.parse(alert.last_triggered_at);
    if (Number.isFinite(last) && Date.now() - last < (config.alertCooldownMinutes || 30) * 60 * 1000) {
      return { ok: false, asset, reason: 'cooldown' };
    }
    if (alert.repeat_type === 'daily_once') {
      const lastDay = new Date(last).toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
      if (lastDay === today) return { ok: false, asset, reason: 'daily' };
    }
  }
  return { ok: true, asset };
}

function formatTriggeredAlert(alert, asset) {
  const condition = alert.condition === 'less_than' ? 'کمتر از' : 'بیشتر از';
  return [
    '<b>🎯 هشدار قیمت نبض بازار</b>',
    '',
    asset.icon + ' ' + asset.title + ' به شرط شما رسید.',
    'قیمت فعلی: ' + formatToman(asset.price),
    'شرط هشدار: ' + condition + ' ' + formatToman(alert.target_price),
    '',
    'این پیام صرفاً اطلاع‌رسانی است و توصیه خرید یا فروش محسوب نمی‌شود.'
  ].join('\n');
}

function tehranParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    time: map.hour + ':' + map.minute,
    day: dayMap[map.weekday] ?? date.getDay(),
    dateKey: date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' })
  };
}

function reportDue(report, date = new Date()) {
  const parts = tehranParts(date);
  if (report.schedule_time !== parts.time) return false;
  const days = JSON.parse(report.days_of_week_json || '[0,1,2,3,4,5,6]');
  if (Array.isArray(days) && days.length && !days.includes(parts.day)) return false;
  if (report.last_sent_at) {
    const lastKey = new Date(report.last_sent_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
    if (lastKey === parts.dateKey) return false;
  }
  return true;
}

function formatScheduledReport(report, snapshot) {
  const assets = JSON.parse(report.assets_json || '[]');
  const lines = allAssetValues(snapshot, assets).map((asset) => {
    return asset.icon + ' ' + asset.title + ': ' + formatToman(asset.price);
  });
  return [
    '<b>گزارش اختصاصی نبض بازار | ' + escapeHtml(report.schedule_time) + '</b>',
    '',
    ...(lines.length ? lines : ['قیمت‌ها در حال بروزرسانی هستند.']),
    '',
    'وضعیت کلی: این گزارش برای اطلاع‌رسانی سریع ارسال شده است.',
    'این پیام صرفاً اطلاع‌رسانی است و توصیه خرید یا فروش محسوب نمی‌شود.'
  ].join('\n');
}

function formatChannelReport(snapshot, platform = 'telegram') {
  const now = new Date().toLocaleTimeString('fa-IR', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit'
  });
  const lines = allAssetValues(snapshot, ['usd', 'usdt', 'gold18', 'coin', 'half_coin', 'quarter_coin', 'silver']).map((asset) => {
    const title = asset.key === 'silver' ? 'نقره' : asset.title;
    return title + ': ' + formatToman(asset.price);
  });
  return [
    'نبض بازار | بروزرسانی قیمت',
    '',
    ...lines,
    '',
    'آخرین بروزرسانی: ' + now,
    '',
    'برای هشدار اختصاصی قیمت:',
    platform === 'bale' ? config.baleBotUrl : '@NabzBazarBot'
  ].join('\n');
}

function channelPublishDue(state) {
  if (!config.channelPublishEnabled) return false;
  if (!state || !state.last_published_at) return true;
  const last = Date.parse(state.last_published_at);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= Math.max(1, config.channelPublishIntervalMinutes || 30) * 60 * 1000;
}

module.exports = {
  ASSETS,
  normalizeAsset,
  parsePriceAlertCommand,
  parseScheduledReportCommand,
  subscriptionLabel,
  formatSubscriptionText,
  formatPlansText,
  formatAlertList,
  formatReportList,
  formatPriceAlertCreated,
  formatScheduledReportCreated,
  formatLimitText,
  alertMatches,
  formatTriggeredAlert,
  reportDue,
  formatScheduledReport,
  formatChannelReport,
  channelPublishDue
};
