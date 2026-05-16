function analyzeTrend(rows) {
  if (rows.length < 2) {
    return { label: 'داده تاریخی کافی نداریم؛ باید چند نوبت قیمت جمع شود.', changePercent: null };
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const changePercent = ((last.gold18Price - first.gold18Price) / first.gold18Price) * 100;
  let label = 'رفتار قیمت در داده ذخیره‌شده تقریباً خنثی است.';
  if (changePercent >= 3) label = 'رفتار قیمت در داده ذخیره‌شده صعودی است؛ برای خرید باید محتاط‌تر بود.';
  if (changePercent <= -3) label = 'رفتار قیمت در داده ذخیره‌شده نزولی است؛ برای خرید باید دنبال تثبیت بهتر گشت.';
  return { label, changePercent };
}

module.exports = { analyzeTrend };
