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

function formatTechnicalLine(label, signal) {
  if (!signal) return 'ـ ' + label + ': نامشخص';
  const parts = [
    'ـ ' + label + ': ' + signal.label,
    'قیمت: ' + formatMarketPrice(signal.close),
    'تغییر: ' + formatOptionalPercent(signal.changePercent),
    '۱ساعته: ' + signal.oneHourLabel,
    '۴ساعته: ' + signal.fourHourLabel,
    signal.rsiLabel
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
  return 'حباب داخل محدوده تنظیم‌شده است؛ فعلاً هشدار خرید یا فروش نداریم.';
}

function formatReport(snapshot) {
  const now = new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
  const sourceLines = snapshot.sources.map((source) => {
    const parts = ['ـ ' + source.name];
    if (source.gold18Price) parts.push('طلا: ' + formatToman(source.gold18Price));
    if (source.coinPrice) parts.push('سکه: ' + formatToman(source.coinPrice));
    if (source.dollarToman) parts.push('دلار: ' + Math.round(source.dollarToman).toLocaleString('fa-IR') + ' تومان');
    if (source.ounceUsd) parts.push('اونس: ' + formatUsd(source.ounceUsd));
    if (source.silverPrice) parts.push('نقره: ' + formatToman(source.silverPrice));
    if (source.silverOunceUsd) parts.push('اونس نقره: ' + formatUsd(source.silverOunceUsd));
    if (source.reportedGoldBubblePercent !== undefined && source.reportedGoldBubblePercent !== null) {
      parts.push('حباب طلای اعلامی: ' + formatPercent(source.reportedGoldBubblePercent));
    }
    return parts.join(' | ');
  });
  const trendChange = snapshot.trend.changePercent === null
    ? ''
    : 'تغییر ذخیره‌شده: ' + formatPercent(snapshot.trend.changePercent);
  const sourceErrorLines = (snapshot.sourceErrors || []).map((item) => 'ـ ' + item.source + ': ' + item.error);
  const technical = snapshot.technical || {};

  return [
    'گزارش بازار طلا و ارز',
    'زمان گزارش: ' + now,
    '',
    'دلار',
    'ـ نرخ میانگین دلار: ' + Math.round(snapshot.dollarToman).toLocaleString('fa-IR') + ' تومان',
    'ـ اونس جهانی طلا: ' + formatUsd(snapshot.ounceUsd),
    '',
    'طلا',
    'ـ نرخ میانگین طلای ۱۸ عیار: ' + formatToman(snapshot.gold.price),
    'ـ ارزش نظری طلای ۱۸ عیار: ' + formatToman(snapshot.theoreticalGold18Rial),
    'ـ حباب طلای ۱۸ عیار: ' + formatToman(snapshot.goldBubbleValue),
    'ـ درصد حباب طلا: ' + formatPercent(snapshot.goldBubblePercent),
    '',
    'سکه',
    'ـ نرخ میانگین سکه: ' + formatToman(snapshot.coin.price),
    'ـ ارزش ذاتی محاسبه‌شده: ' + formatToman(snapshot.intrinsicValue),
    'ـ حباب تومانی سکه: ' + formatToman(snapshot.bubbleValue),
    'ـ درصد حباب سکه: ' + formatPercent(snapshot.bubblePercent),
    '',
    'نقره',
    'ـ نرخ میانگین نقره ۹۹۹: ' + formatOptionalToman(snapshot.silverPrice),
    'ـ اونس جهانی نقره: ' + formatOptionalUsd(snapshot.silverOunceUsd),
    'ـ ارزش نظری نقره ۹۹۹: ' + formatOptionalToman(snapshot.theoreticalSilverRial),
    'ـ حباب نقره ۹۹۹: ' + formatOptionalToman(snapshot.silverBubbleValue),
    'ـ درصد حباب نقره: ' + formatOptionalPercent(snapshot.silverBubblePercent),
    '',
    'منابع قیمت:',
    ...sourceLines,
    ...(sourceErrorLines.length ? ['', 'خطاهای منبع:', ...sourceErrorLines] : []),
    '',
    'سیگنال جهانی TradingView:',
    formatTechnicalLine('طلا جهانی', technical.gold),
    formatTechnicalLine('نقره جهانی', technical.silver),
    technical.updatedAt ? 'ـ بروزرسانی سیگنال: ' + new Date(technical.updatedAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) : '',
    '',
    'رفتار قیمت:',
    'ـ ' + snapshot.trend.label,
    trendChange ? 'ـ ' + trendChange : '',
    '',
    'جمع‌بندی:',
    'ـ ' + formatDecision(snapshot.decision, snapshot.technical),
    '',
    'زمان بروزرسانی منبع: ' + (snapshot.coin.updatedAt || snapshot.gold.updatedAt || 'نامشخص')
  ].filter((line) => line !== '').join('\n');
}

module.exports = { formatReport };
