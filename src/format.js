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

function formatTechnicalLine(label, signal) {
  if (!signal) return '• <b>' + escapeHtml(label) + ':</b> نامشخص';
  const parts = [
    '• <b>' + escapeHtml(label) + ':</b> ' + escapeHtml(signal.label),
    'قیمت: ' + formatMarketPrice(signal.close),
    'تغییر: ' + formatOptionalPercent(signal.changePercent),
    '۱ساعته: ' + escapeHtml(signal.oneHourLabel),
    '۴ساعته: ' + escapeHtml(signal.fourHourLabel),
    escapeHtml(signal.rsiLabel)
  ];
  return parts.join(' | ');
}

function formatTechnicalCaution(technical) {
  const gold = technical && technical.gold;
  if (!gold) return '';
  if (gold.recommendFourHour <= -0.5 || gold.recommendAll <= -0.5) {
    return 'سیگنال جهانی طلا فروش قوی است؛ حتی اگر حباب داخلی جذاب شد، ورود پله‌ای و محتاط‌تر بهتر است.';
  }
  if (gold.recommendFourHour >= 0.5 || gold.recommendAll >= 0.5) {
    return 'سیگنال جهانی طلا خرید قوی است؛ اگر حباب داخلی هم مناسب باشد، تایید بیرونی بهتری داریم.';
  }
  if (gold.rsi <= 30 || gold.rsiOneHour <= 30 || gold.rsiFourHour <= 30) {
    return 'طلا در TradingView نزدیک اشباع فروش است؛ احتمال برگشت کوتاه‌مدت را باید جدی‌تر دید.';
  }
  return 'سیگنال جهانی طلا فعلاً تایید قوی خلاف حباب داخلی نمی‌دهد.';
}

function formatSourceDiagnostics(snapshot) {
  const diagnostics = snapshot.sourceDiagnostics || {};
  const lines = [];
  for (const [metric, detail] of Object.entries(diagnostics)) {
    const excluded = (detail.excluded || []).map((item) => escapeHtml(item.source) + ' / ' + escapeHtml(item.metricLabel) + ' / ' + escapeHtml(item.reason));
    if (excluded.length) {
      lines.push('• <b>' + escapeHtml(metric) + ':</b> ' + excluded.join('، '));
    }
  }
  return lines;
}

function formatAdminPanel(snapshot) {
  const sourceErrorLines = (snapshot.sourceErrors || []).map((item) => '⚠️ <b>خطا:</b> ' + escapeHtml(item.source) + ' | ' + escapeHtml(item.error));
  const sourceAlertLines = (snapshot.sourceAlerts || []).map((item) => '🚫 <b>حذف از میانگین:</b> ' + escapeHtml(item.message));
  const diagnosticsLines = formatSourceDiagnostics(snapshot);
  return [
    'آقا سید،',
    '<b>🛡 پنل ادمین بات طلا</b>',
    '',
    '<b>وضعیت منابع</b>',
    sourceErrorLines.length || sourceAlertLines.length || diagnosticsLines.length
      ? ''
      : '✅ همه منابع فعال فعلاً بدون خطا/حذف پرت هستند.',
    ...sourceErrorLines,
    ...sourceAlertLines,
    ...diagnosticsLines,
    '',
    '<b>میانگین‌های فعلی پس از فیلتر</b>',
    '💵 <b>دلار:</b> ' + Math.round(snapshot.dollarToman).toLocaleString('fa-IR') + ' تومان',
    '🌕 <b>اونس طلا:</b> ' + formatUsd(snapshot.ounceUsd),
    '🥇 <b>طلای ۱۸:</b> ' + formatToman(snapshot.gold.price),
    '🟡 <b>سکه:</b> ' + formatToman(snapshot.coin.price),
    '',
    '<b>تصمیم فعلی</b>',
    '🧭 ' + escapeHtml(formatDecision(snapshot.decision, snapshot.technical))
  ].filter((line) => line !== '').join('\n');
}

function formatDecision(decision, technical) {
  const caution = formatTechnicalCaution(technical);
  if (decision === 'buy') {
    return 'حباب منفی است؛ از نظر حباب، موقعیت خرید جذاب‌تر شده.'
      + (caution ? ' ' + caution : '');
  }
  if (decision === 'sell') {
    return 'حباب مثبت و بالاست؛ از نظر حباب، موقعیت فروش یا احتیاط جدی‌تر شده.'
      + (caution ? ' ' + caution : '');
  }
  return 'فعلاً سیگنال خرید یا فروش نداریم؛ فقط رصد بازار.';
}

function formatReport(snapshot) {
  const now = new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
  const sourceLines = snapshot.sources.flatMap((source) => {
    const lines = ['• <b>' + escapeHtml(source.name) + '</b>'];
    if (source.gold18Price) lines.push('  🥇 طلا: ' + formatToman(source.gold18Price));
    if (source.coinPrice) lines.push('  🟡 سکه: ' + formatToman(source.coinPrice));
    if (source.dollarToman) lines.push('  💵 دلار: ' + Math.round(source.dollarToman).toLocaleString('fa-IR') + ' تومان');
    if (source.ounceUsd) lines.push('  🌕 اونس طلا: ' + formatUsd(source.ounceUsd));
    if (source.silverPrice) lines.push('  🥈 نقره: ' + formatToman(source.silverPrice));
    if (source.silverOunceUsd) lines.push('  ⚪ اونس نقره: ' + formatUsd(source.silverOunceUsd));
    if (source.reportedGoldBubblePercent !== undefined && source.reportedGoldBubblePercent !== null) {
      lines.push('  📍 حباب اعلامی طلا: ' + formatPercent(source.reportedGoldBubblePercent));
    }
    return lines;
  });
  const trendChange = snapshot.trend.changePercent === null
    ? ''
    : 'تغییر ذخیره‌شده: ' + formatPercent(snapshot.trend.changePercent);
  const technical = snapshot.technical || {};

  return [
    'آقا سید،',
    '<b>📊 گزارش بازار طلا و ارز</b>',
    '🕒 زمان گزارش: ' + now,
    '',
    '<b>💵 دلار و اونس</b>',
    '• دلار میانگین: ' + Math.round(snapshot.dollarToman).toLocaleString('fa-IR') + ' تومان',
    '• اونس جهانی طلا: ' + formatUsd(snapshot.ounceUsd),
    '',
    '<b>🥇 طلا</b>',
    '• طلای ۱۸ عیار: ' + formatToman(snapshot.gold.price),
    '• ارزش نظری: ' + formatToman(snapshot.theoreticalGold18Rial),
    '• حباب: ' + formatToman(snapshot.goldBubbleValue),
    '• درصد حباب: ' + formatPercent(snapshot.goldBubblePercent),
    '',
    '<b>🟡 سکه</b>',
    '• قیمت میانگین: ' + formatToman(snapshot.coin.price),
    '• ارزش ذاتی: ' + formatToman(snapshot.intrinsicValue),
    '• حباب تومانی: ' + formatToman(snapshot.bubbleValue),
    '• درصد حباب: ' + formatPercent(snapshot.bubblePercent),
    '',
    '<b>🥈 نقره</b>',
    '• نقره ۹۹۹: ' + formatOptionalToman(snapshot.silverPrice),
    '• اونس جهانی نقره: ' + formatOptionalUsd(snapshot.silverOunceUsd),
    '• ارزش نظری: ' + formatOptionalToman(snapshot.theoreticalSilverRial),
    '• حباب: ' + formatOptionalToman(snapshot.silverBubbleValue),
    '• درصد حباب: ' + formatOptionalPercent(snapshot.silverBubblePercent),
    '',
    '<b>📌 منابع قیمت</b>',
    ...sourceLines,
    '',
    '<b>📈 سیگنال جهانی TradingView</b>',
    formatTechnicalLine('طلا جهانی', technical.gold),
    formatTechnicalLine('نقره جهانی', technical.silver),
    technical.updatedAt ? '• بروزرسانی سیگنال: ' + new Date(technical.updatedAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) : '',
    '',
    '<b>📉 رفتار قیمت</b>',
    '• ' + escapeHtml(snapshot.trend.label),
    trendChange ? '• ' + trendChange : '',
    '',
    '<b>🧭 جمع‌بندی</b>',
    '• ' + escapeHtml(formatDecision(snapshot.decision, snapshot.technical))
  ].filter((line) => line !== '').join('\n');
}

module.exports = { formatReport, formatAdminPanel };
