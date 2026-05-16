const { parseLocalizedNumber } = require('./sources');

function findPrice(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(label + '\\\\s*[=:：]?\\\\s*([0-9۰-۹٠-٩,٬]+)', 'i');
    const match = text.match(pattern);
    if (match) {
      const toman = parseLocalizedNumber(match[1]);
      if (toman) return toman * 10;
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
  const dollarToman = findPrice(text, ['قیمت دلار', 'دلار']);
  const ounceUsdRaw = findPrice(text, ['اونس جهانی طلا', 'اونس طلا']);
  const silverPrice = findPrice(text, ['نقره\\(عیار 999\\)', 'نقره 999', 'نقره']);
  const reportedGoldBubblePercent = findPercent(text, ['حباب طلا']);
  const reportedCoinBubblePercent = findPercent(text, ['حباب سکه امامی']);
  if (!gold18Price && !coinPrice && !dollarToman && !ounceUsdRaw) return null;
  return {
    name,
    gold18Price,
    coinPrice,
    dollarToman: dollarToman ? dollarToman / 10 : null,
    ounceUsd: ounceUsdRaw ? ounceUsdRaw / 10 : null,
    silverPrice,
    reportedGoldBubblePercent,
    reportedCoinBubblePercent,
    updatedAt: new Date().toISOString()
  };
}

module.exports = { parseMarketMessage };
