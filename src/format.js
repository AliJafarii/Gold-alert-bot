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

function formatDecision(decision) {
  if (decision === 'buy') return 'حباب منفی است؛ از نظر حباب، موقعیت خرید جذاب‌تر شده.';
  if (decision === 'sell') return 'حباب مثبت و بالاست؛ از نظر حباب، موقعیت فروش یا احتیاط جدی‌تر شده.';
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
    'رفتار قیمت:',
    'ـ ' + snapshot.trend.label,
    trendChange ? 'ـ ' + trendChange : '',
    '',
    'جمع‌بندی:',
    'ـ ' + formatDecision(snapshot.decision),
    '',
    'زمان بروزرسانی منبع: ' + (snapshot.coin.updatedAt || snapshot.gold.updatedAt || 'نامشخص')
  ].filter((line) => line !== '').join('\n');
}

module.exports = { formatReport };
