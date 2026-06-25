// @ts-nocheck
const { config } = require('./config');

function toToman(value) {
  return value / 10;
}

function formatToman(value) {
  return Math.round(toToman(value)).toLocaleString('fa-IR') + ' تومان';
}

function formatPercent(value) {
  return value.toLocaleString('fa-IR', { maximumFractionDigits: 2 }) + '٪';
}

function formatUsd(value) {
  return value.toLocaleString('fa-IR', { maximumFractionDigits: 2 }) + ' دلار';
}

function formatOptionalToman(value) {
  return value ? formatToman(value) : 'نامشخص';
}

function formatOptionalUsd(value) {
  return value ? formatUsd(value) : 'نامشخص';
}

function formatOptionalPercent(value) {
  return value !== undefined && value !== null ? formatPercent(value) : 'نامشخص';
}

function formatMarketPrice(value) {
  return Number.isFinite(value) ? value.toLocaleString('fa-IR', { maximumFractionDigits: 2 }) : 'نامشخص';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function maskContactNumbers(value) {
  return String(value || '').replace(/(?:\+?98|0|۰)?[9۹٩][0-9۰-۹٠-٩\s-]{9,}/g, '09*********');
}

function formatTechnicalLine(label, signal) {
  if (!signal) return ['• <b>' + escapeHtml(label) + '</b>', '  وضعیت: نامشخص'];
  return [
    '• <b>' + escapeHtml(label) + '</b>',
    '  قیمت: ' + formatMarketPrice(signal.close),
    '  تغییر: ' + formatOptionalPercent(signal.changePercent),
    '  کلی: ' + escapeHtml(signal.label),
    '  ۱ساعته: ' + escapeHtml(signal.oneHourLabel),
    '  ۴ساعته: ' + escapeHtml(signal.fourHourLabel),
    '  RSI: ' + escapeHtml(signal.rsiLabel.replace(/^RSI\s*/, ''))
  ];
}

function formatReportDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return parts.day + ' ' + parts.month + ' ' + parts.year + ' - ساعت ' + parts.hour + ':' + parts.minute;
}

function sourceUrl(name) {
  if (name === 'tgju') return 'https://www.tgju.org';
  if (name === 'tala') return 'https://www.tala.ir/price/18k/13';
  if (name === 'tajnoghreh') return 'https://tajnoghreh.com/silver-price/';
  if (name === 'estjt') return 'https://www.estjt.ir/';
  if (name === 'tradingview-gold') return 'https://www.tradingview.com/symbols/TVC-GOLD/';
  if (name === 'tradingview-silver') return 'https://www.tradingview.com/symbols/TVC-SILVER/';
  if (name === 'tabdeal-tether') return 'https://tabdeal.org/usdt-price';
  if (name === 'nobitex-tether') return 'https://nobitex.ir/price/usdt/';
  if (name === 'isignal-tether') return 'https://isignal.ir/cryptocurrency/tether/';
  if (name === 'arzdigital-tether') return 'https://arzdigital.com/coins/tether/';
  if (name === 'tgju-tether') return 'https://www.tgju.org/profile/crypto-tether';
  if (name === 'bitpin-tether') return 'https://bitpin.ir/coin/USDT/';
  if (name === 'okex-tether') return 'https://ok-ex.io/buy-and-sell/USDT/';
  if (name.startsWith('telegram-deal-')) return config.telegramDealInviteUrl || null;
  if (name.startsWith('telegram-dollar-')) return 'https://t.me/' + encodeURIComponent(name.replace(/^telegram-dollar-/, ''));
  if (name.startsWith('telegram-')) return 'https://t.me/' + encodeURIComponent(name.replace(/^telegram-/, ''));
  if (name.startsWith('bale-')) return 'https://ble.ir/' + encodeURIComponent(name.replace(/^bale-/, ''));
  return null;
}

function formatSourceLink(source) {
  const name = source && source.name;
  if (!name) return null;
  const url = sourceUrl(name);
  return url ? '• ' + escapeHtml(url) : null;
}

function usedSourceNames(snapshot) {
  const diagnostics = snapshot.sourceDiagnostics || {};
  const names = new Set();
  for (const detail of Object.values(diagnostics)) {
    for (const item of detail.used || []) {
      if (item.source && item.source.name) names.add(item.source.name);
    }
  }
  return names;
}

function formatUsedSources(snapshot) {
  const usedNames = usedSourceNames(snapshot);
  const sources = (snapshot.sources || []).filter((source) => usedNames.has(source.name));
  const lines = sources
    .map((source) => {
      const url = sourceUrl(source.name);
      return '• ' + escapeHtml(displaySourceName(source.name)) + (url ? ' = ' + escapeHtml(url) : '');
    })
    .filter(Boolean);
  return lines.length ? lines : ['موردی ثبت نشده.'];
}

function formatPriceLine(icon, label, value) {
  return icon + ' ' + label + ' = ' + formatOptionalToman(value);
}

function formatTomanPlain(value) {
  return Number.isFinite(value) && value > 0
    ? Math.round(value).toLocaleString('fa-IR') + ' تومان'
    : 'نامشخص';
}

function formatBubbleLine(icon, label, bubbleValue, bubblePercent) {
  return icon + ' حباب ' + label + ' = '
    + formatOptionalToman(bubbleValue)
    + ' | '
    + formatOptionalPercent(bubblePercent);
}

function formatAnalysisPrice(asset) {
  if (!Number.isFinite(asset.price)) return 'نامشخص';
  if (asset.key === 'dollar') return Math.round(asset.price).toLocaleString('fa-IR') + ' تومان';
  return formatToman(asset.price);
}

function shortDecisionLabel(decision) {
  return {
    buy: 'روند افزایشی',
    sell: 'روند کاهشی',
    hold: 'روند خنثی'
  }[decision] || 'نامشخص';
}

function analysisIcon(asset) {
  return {
    dollar: '💵',
    gold18: '🥇',
    coin: '🟡',
    silver: '🥈'
  }[asset.key] || '•';
}

function formatAnalysisLine(asset) {
  return analysisIcon(asset)
    + ' <b>' + escapeHtml(asset.title) + ':</b> '
    + '<b>' + escapeHtml(shortDecisionLabel(asset.decision)) + '</b>'
    + '\n   ' + escapeHtml(asset.summary || asset.reason || 'رصد بازار')
    + '\n   ' + escapeHtml(asset.horizonHint || 'کوتاه: رصد | میان: رصد | بلند: داده کم');
}

function formatAnalysisSection(snapshot) {
  const order = { dollar: 0, gold18: 1, coin: 2, silver: 3 };
  const assets = snapshot.analysis && Array.isArray(snapshot.analysis.assets)
    ? snapshot.analysis.assets
    : [];
  if (!assets.length) return ['• تحلیل الگوریتمی فعلاً در دسترس نیست.'];
  return assets
    .slice()
    .sort((a, b) => (order[a.key] ?? 99) - (order[b.key] ?? 99))
    .map(formatAnalysisLine);
}

function formatTechnicalCaution(technical) {
  const gold = technical && technical.gold;
  if (!gold) return '';
  if (gold.recommendFourHour <= -0.5 || gold.recommendAll <= -0.5) {
    return 'شاخص جهانی طلا فشار کاهشی نشان می‌دهد؛ این بخش فقط وضعیت بازار را توصیف می‌کند.';
  }
  if (gold.recommendFourHour >= 0.5 || gold.recommendAll >= 0.5) {
    return 'شاخص جهانی طلا فشار افزایشی نشان می‌دهد؛ این بخش فقط وضعیت بازار را توصیف می‌کند.';
  }
  if (gold.rsi <= 30 || gold.rsiOneHour <= 30 || gold.rsiFourHour <= 30) {
    return 'طلا در TradingView نزدیک محدوده اشباع فروش است؛ این فقط یک وضعیت تکنیکال است.';
  }
  return 'شاخص جهانی طلا فعلاً تغییر شدید و هم‌جهت نشان نمی‌دهد.';
}

function formatSourceDiagnostics(snapshot) {
  const diagnostics = snapshot.sourceDiagnostics || {};
  const lines = [];
  for (const [metric, detail] of Object.entries(diagnostics)) {
    const excluded = summarizeSourceIssues(detail.excluded || []);
    if (excluded.length) {
      lines.push('• <b>' + escapeHtml(metricLabelFa(metric)) + ':</b> ' + excluded.join('، '));
    }
  }
  return lines;
}

function metricLabelFa(metric) {
  return {
    gold18Price: 'طلای ۱۸',
    coinPrice: 'سکه امامی',
    baharCoinPrice: 'بهار آزادی',
    halfCoinPrice: 'نیم سکه',
    quarterCoinPrice: 'ربع سکه',
    gramCoinPrice: 'سکه گرمی',
    dollarToman: 'دلار',
    tetherToman: 'تتر',
    ounceUsd: 'اونس طلا',
    silverPrice: 'نقره',
    silverOunceUsd: 'اونس نقره'
  }[metric] || metric;
}

function shortIssueReason(reason) {
  return {
    stale: 'قدیمی',
    outlier: 'عدد پرت',
    scale: 'اصلاح مقیاس',
    timeout: 'timeout',
    'بدون پیام معتبر': 'بدون پیام معتبر',
    'خطای دسترسی': 'خطای دسترسی',
    'خطای سرور': 'خطای سرور',
    'نماد نامعتبر': 'نماد نامعتبر',
    'خطای خواندن': 'خطای خواندن'
  }[reason] || 'نامعتبر';
}

function summarizeSourceIssues(items) {
  const seen = new Set();
  const lines = [];
  for (const item of items) {
    const source = displaySourceName(item.source);
    const key = source + ':' + String(item.reason || '');
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(escapeHtml(source) + ' / ' + shortIssueReason(item.reason));
  }
  return lines;
}

function displaySourceName(name) {
  return String(name || '')
    .replace(/^telegram-deal-/, '')
    .replace(/^telegram-dollar-/, '')
    .replace(/^telegram-/, '')
    .replace(/^bale-/, '');
}

function sourceChannelKey(name) {
  return displaySourceName(name).trim().toLowerCase();
}

function successfulSourceChannelKeys(snapshot) {
  const keys = new Set();
  for (const source of snapshot.sources || []) {
    if (source && source.name && !source.error) keys.add(sourceChannelKey(source.name));
  }
  for (const source of snapshot.analysisSources || []) {
    if (source && source.name && !source.error) keys.add(sourceChannelKey(source.name));
  }
  return keys;
}

function filterRedundantSourceErrors(snapshot) {
  const successfulKeys = successfulSourceChannelKeys(snapshot);
  return (snapshot.sourceErrors || []).filter((item) => !successfulKeys.has(sourceChannelKey(item.source)));
}

function shortFetchError(error) {
  const text = String(error || '').toLowerCase();
  if (/timeout|abort/.test(text)) return 'timeout';
  if (/not found|no recent|parseable/.test(text)) return 'بدون پیام معتبر';
  if (/request failed:?\s*4/.test(text)) return 'خطای دسترسی';
  if (/request failed:?\s*5/.test(text)) return 'خطای سرور';
  if (/did not return symbol/.test(text)) return 'نماد نامعتبر';
  return 'خطای خواندن';
}

function formatAdminAnalysisDetails(snapshot) {
  const assets = snapshot.analysis && Array.isArray(snapshot.analysis.assets)
    ? snapshot.analysis.assets
    : [];
  if (!assets.length) return ['تحلیل فعلاً در دسترس نیست.'];
  const order = { dollar: 0, gold18: 1, coin: 2, silver: 3 };
  return assets.slice().sort((a, b) => (order[a.key] ?? 99) - (order[b.key] ?? 99)).map((asset) => {
    const bubble = Number.isFinite(asset.bubblePercent) ? 'حباب ' + formatPercent(asset.bubblePercent) : 'بدون حباب';
    const score = Number.isFinite(asset.score) ? 'امتیاز ' + asset.score.toLocaleString('fa-IR') : 'امتیاز نامشخص';
    return analysisIcon(asset) + ' <b>' + escapeHtml(asset.title) + ':</b> '
      + escapeHtml(shortDecisionLabel(asset.decision))
      + ' | ' + score
      + ' | ' + bubble
      + ' | ' + escapeHtml(asset.summary || '')
      + '\n  ' + escapeHtml(asset.horizonHint || '')
      + (asset.adminDetail ? '\n  ' + escapeHtml(asset.adminDetail) : '');
  });
}

function formatAdminPanel(snapshot) {
  const sourceErrorLines = summarizeSourceIssues(filterRedundantSourceErrors(snapshot).map((item) => ({
    source: item.source,
    reason: shortFetchError(item.error)
  }))).map((line) => '⚠️ ' + line);
  const diagnosticsLines = formatSourceDiagnostics(snapshot);
  const analysisSourceLines = (snapshot.analysisSources || []).flatMap((source) => {
    const lines = ['• <b>' + escapeHtml(source.name) + '</b>'];
    if (source.dollarToman) lines.push('  💵 دلار تحلیلی: ' + Math.round(source.dollarToman).toLocaleString('fa-IR') + ' تومان');
    if (source.sampleCount) lines.push('  تعداد نمونه معتبر: ' + Number(source.sampleCount).toLocaleString('fa-IR'));
    if (source.readMode) lines.push('  روش خواندن: ' + escapeHtml(source.readMode));
    return lines;
  });
  return [
    '<b>🛡 پنل ادمین نبض بازار</b>',
    '',
    '<b>قیمت‌های میانگین</b>',
    '💵 دلار: ' + formatTomanPlain(snapshot.dollarToman),
    '💲 تتر: ' + formatTomanPlain(snapshot.tetherToman),
    '🌕 اونس طلا: ' + formatOptionalUsd(snapshot.ounceUsd),
    '🥇 طلای ۱۸: ' + formatToman(snapshot.gold.price),
    '🟡 سکه امامی: ' + formatToman(snapshot.coin.price),
    '🥈 نقره ۹۹۹: ' + formatOptionalToman(snapshot.silverPrice),
    '',
    '<b>منابع استفاده‌شده</b>',
    ...formatUsedSources(snapshot),
    '',
    '<b>تحلیل بازار</b>',
    ...formatAdminAnalysisDetails(snapshot),
    '',
    '<b>منابع و حذف‌شده‌ها</b>',
    sourceErrorLines.length || diagnosticsLines.length
      ? ''
      : '✅ همه منابع فعال فعلاً بدون خطا/حذف پرت هستند.',
    ...sourceErrorLines,
    ...diagnosticsLines,
    '',
    '<b>منابع تحلیلی مخفی</b>',
    analysisSourceLines.length
      ? ''
      : 'فعلاً منبع تحلیلی مخفی فعال نیست.',
    ...analysisSourceLines,
    'برای دیدن ۳۰ پیام معتبر و ردشده‌های اخیر، دکمه audit پارسیان را بزن.',
    '',
    '<b>تنظیمات</b>',
    '⏱ سقف تلگرام و بله: ' + Number(snapshot.channelSourceMaxAgeHours || 0).toLocaleString('fa-IR') + ' ساعت',
    '⏱ سقف عمومی منابع دیگر: ' + Number(snapshot.sourceMaxAgeHours || 0).toLocaleString('fa-IR') + ' ساعت',
    'برای تغییر دستی: <code>/channel_age 2</code>'
  ].join('\n');
}

function formatDecision(decision, technical, buyThreshold, sellThreshold) {
  const caution = formatTechnicalCaution(technical);
  if (decision === 'buy') {
    return 'حباب منفی است و بازار از این زاویه فاصله بیشتری با ارزش نظری دارد.'
      + (caution ? ' ' + caution : '');
  }
  if (decision === 'sell') {
    return 'حباب مثبت و بالاست و بازار از این زاویه فاصله بیشتری با ارزش نظری دارد.'
      + (caution ? ' ' + caution : '');
  }
  return 'وضعیت فعلی خنثی است؛ آستانه رصد حباب پایین '
    + formatPercent(buyThreshold)
    + ' و آستانه رصد حباب بالا '
    + formatPercent(sellThreshold)
    + ' است.';
}

function botLinkLines(platform = 'telegram') {
  const telegramLine = config.telegramBotUrl;
  const baleLine = config.baleBotUrl;
  return platform === 'bale'
    ? [baleLine, telegramLine]
    : [telegramLine, baleLine];
}

function formatBotLinks(platform = 'telegram') {
  return [
    '💰 نبض بازار 👇🏻',
    ...botLinkLines(platform).map(escapeHtml)
  ];
}

function formatReport(snapshot, platform = 'telegram') {
  const usedNames = usedSourceNames(snapshot);
  const reportSources = usedNames.size
    ? (snapshot.sources || []).filter((source) => usedNames.has(source.name))
    : (snapshot.sources || []);
  const sourceLines = reportSources
    .map(formatSourceLink)
    .filter(Boolean);
  const extraCoins = snapshot.extraCoins || {};

  return [
    '<b>💰 قیمت لحظه‌ای دلار، طلا و سکه</b>',
    '<b>⏰ ' + formatReportDate() + '</b>',
    '',
    '💵 قیمت دلار = ' + Math.round(snapshot.dollarToman).toLocaleString('fa-IR') + ' تومان',
    '💲 قیمت تتر = ' + formatTomanPlain(snapshot.tetherToman),
    '🌕 اونس جهانی طلا = ' + formatUsd(snapshot.ounceUsd),
    formatPriceLine('🌕', 'طلای ۱۸ عیار', snapshot.gold.price),
    formatPriceLine('🟡', 'سکه امامی', snapshot.coin.price),
    formatPriceLine('🟡', 'سکه بهار آزادی', extraCoins.bahar && extraCoins.bahar.price),
    formatPriceLine('🟡', 'نیم سکه', extraCoins.half && extraCoins.half.price),
    formatPriceLine('🟡', 'ربع سکه', extraCoins.quarter && extraCoins.quarter.price),
    formatPriceLine('🟡', 'سکه گرمی', extraCoins.gram && extraCoins.gram.price),
    formatPriceLine('🪙', 'نقره ۹۹۹', snapshot.silverPrice),
    '',
    '<b>حباب‌ها</b>',
    formatBubbleLine('🥇', 'طلای ۱۸', snapshot.goldBubbleValue, snapshot.goldBubblePercent),
    formatBubbleLine('🟡', 'سکه امامی', snapshot.bubbleValue, snapshot.bubblePercent),
    formatBubbleLine('🟡', 'سکه بهار آزادی', extraCoins.bahar && extraCoins.bahar.bubbleValue, extraCoins.bahar && extraCoins.bahar.bubblePercent),
    formatBubbleLine('🟡', 'نیم سکه', extraCoins.half && extraCoins.half.bubbleValue, extraCoins.half && extraCoins.half.bubblePercent),
    formatBubbleLine('🟡', 'ربع سکه', extraCoins.quarter && extraCoins.quarter.bubbleValue, extraCoins.quarter && extraCoins.quarter.bubblePercent),
    formatBubbleLine('🟡', 'سکه گرمی', extraCoins.gram && extraCoins.gram.bubbleValue, extraCoins.gram && extraCoins.gram.bubblePercent),
    formatBubbleLine('🪙', 'نقره ۹۹۹', snapshot.silverBubbleValue, snapshot.silverBubblePercent),
    '',
    '<b>منابع قیمت</b>',
    ...(sourceLines.length ? sourceLines : ['نامشخص']),
    '',
    ...formatBotLinks(platform)
  ].join('\n');
}

function formatAnalysisReport(snapshot, platform = 'telegram') {
  return [
    '<b>📈 وضعیت بازار</b>',
    ...formatAnalysisSection(snapshot),
    '',
    'این پیام صرفاً اطلاع‌رسانی است و توصیه خرید یا فروش محسوب نمی‌شود.',
    '',
    ...formatBotLinks(platform)
  ].filter((line) => line !== '').join('\n');
}

function auditReasonLabel(reason) {
  return {
    buyer: 'خریدار',
    cash_denomination_swap: 'تراول/اسکناس',
    non_usd_currency: 'ارز غیر دلار',
    ad_or_service: 'تبلیغ/سرویس',
    herat: 'هرات',
    tomorrow_market: 'فردایی',
    not_deal: 'غیر معامله',
    no_valid_price: 'بدون قیمت معتبر'
  }[reason] || reason || 'نامشخص';
}

function formatAuditMessageLine(item, index) {
  const priceValue = item.price || item.value;
  const price = priceValue
    ? Math.round(priceValue).toLocaleString('fa-IR') + ' تومان'
    : auditReasonLabel(item.reason);
  return (index + 1).toLocaleString('fa-IR') + '. ' + price + ' | ' + escapeHtml(maskContactNumbers(item.text || ''));
}

function formatSourceAuditReport(audit) {
  if (!audit) return 'هنوز دیتای audit برای پارسیان ذخیره نشده.';
  const accepted = audit.accepted || [];
  const rejected = audit.rejected || [];
  return [
    '<b>🧪 audit پارسیان</b>',
    'میانگین: ' + Math.round(audit.average_dollar_toman || 0).toLocaleString('fa-IR') + ' تومان',
    'نمونه معتبر: ' + Number(audit.sample_count || accepted.length).toLocaleString('fa-IR'),
    'روش خواندن: ' + escapeHtml(audit.read_mode || 'نامشخص'),
    'زمان: ' + new Date(audit.created_at).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }),
    '',
    '<b>۳۰ پیام معتبر</b>',
    ...accepted.map(formatAuditMessageLine),
    '',
    '<b>چند پیام ردشده اخیر</b>',
    ...(rejected.length
      ? rejected.slice(0, 15).map(formatAuditMessageLine)
      : ['مورد ردشده‌ای ذخیره نشده.'])
  ].filter((line) => line !== '').join('\n');
}

module.exports = { formatAnalysisReport, formatReport, formatAdminPanel, formatSourceAuditReport, formatBotLinks };
