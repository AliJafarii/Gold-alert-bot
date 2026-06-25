const { parseLocalizedNumber } = require('./numbers');

function normalizePriceByUnit(value, unit, options = {}) {
  if (!value) return null;
  const target = options.target || 'rial';
  if (/تومان/.test(unit || '')) return target === 'toman' ? value : value * 10;
  if (/ریال/.test(unit || '')) return target === 'toman' ? value / 10 : value;
  if (/\$|دلار/.test(unit || '')) return value;
  return value * (options.defaultMultiplier || 10);
}

function findPrice(text, labels, options = {}) {
  for (const label of labels) {
    const pattern = new RegExp(label + '\\s*[=:：]?\\s*([0-9۰-۹٠-٩,٬]+)\\s*([^\\n\\r]*)', 'i');
    const match = text.match(pattern);
    if (match) {
      const value = parseLocalizedNumber(match[1]);
      if (value) return normalizePriceByUnit(value, match[2], options);
    }
  }
  return null;
}

function findPercent(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(label + '\\s*=\\s*%?\\s*([+\\-−]?[0-9۰-۹٠-٩,.٫]+)', 'i');
    const match = text.match(pattern);
    if (match) {
      const normalized = match[1]
        .replace('−', '-')
        .replace('٫', '.')
        .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
        .replace(/[٠-٩]/g, (char) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)))
        .replace(',', '.');
      const value = Number(normalized);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function parseMarketMessage(text, name = 'external') {
  const gold18Price = findPrice(text, ['قیمت طلا 18 عیار', 'قیمت طلا ۱۸ عیار', 'طلای 18 عیار', 'طلای ۱۸ عیار']);
  const coinPrice = findPrice(text, ['سکه امامی', 'قیمت سکه امامی']);
  const dollarToman = findPrice(text, ['قیمت دلار', 'دلار'], { target: 'toman', defaultMultiplier: 1 });
  const tetherToman = findPrice(text, ['قیمت تتر', 'تتر'], { target: 'toman', defaultMultiplier: 1 });
  const ounceUsd = findPrice(text, ['اونس جهانی طلا', 'اونس طلا'], { defaultMultiplier: 1 });
  const silverPrice = findPrice(text, ['نقره\\(عیار 999\\)', 'نقره 999', 'نقره']);
  const reportedGoldBubblePercent = findPercent(text, ['حباب طلا']);
  const reportedCoinBubblePercent = findPercent(text, ['حباب سکه امامی']);
  if (!gold18Price && !coinPrice && !dollarToman && !tetherToman && !ounceUsd) return null;
  return {
    name,
    gold18Price,
    coinPrice,
    dollarToman,
    tetherToman,
    ounceUsd,
    silverPrice,
    reportedGoldBubblePercent,
    reportedCoinBubblePercent,
    updatedAt: new Date().toISOString()
  };
}

module.exports = { parseMarketMessage };
