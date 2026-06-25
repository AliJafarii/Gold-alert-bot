// @ts-nocheck
const { getDb } = require('./database');

async function appendHistory(snapshot) {
  getDb().prepare(`
    insert into market_history (
      timestamp,
      gold18_price,
      coin_price,
      dollar_toman,
      ounce_usd,
      silver_price,
      silver_ounce_usd,
      theoretical_silver_rial,
      silver_bubble_value,
      silver_bubble_percent,
      theoretical_gold18_rial,
      gold_bubble_value,
      gold_bubble_percent,
      intrinsic_value,
      bubble_value,
      bubble_percent,
      decision,
      sources_json
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    snapshot.gold.price,
    snapshot.coin.price,
    snapshot.dollarToman,
    snapshot.ounceUsd,
    snapshot.silverPrice,
    snapshot.silverOunceUsd,
    snapshot.theoreticalSilverRial,
    snapshot.silverBubbleValue,
    snapshot.silverBubblePercent,
    snapshot.theoreticalGold18Rial,
    snapshot.goldBubbleValue,
    snapshot.goldBubblePercent,
    snapshot.intrinsicValue,
    snapshot.bubbleValue,
    snapshot.bubblePercent,
    snapshot.decision,
    JSON.stringify([...(snapshot.sources || []), ...(snapshot.analysisSources || [])])
  );
}

async function readHistory(limit = 5000) {
  return getDb().prepare(`
    select
      timestamp,
      gold18_price as gold18Price,
      coin_price as coinPrice,
      dollar_toman as dollarToman,
      ounce_usd as ounceUsd,
      silver_price as silverPrice,
      silver_ounce_usd as silverOunceUsd,
      theoretical_silver_rial as theoreticalSilverRial,
      silver_bubble_value as silverBubbleValue,
      silver_bubble_percent as silverBubblePercent,
      theoretical_gold18_rial as theoreticalGold18Rial,
      gold_bubble_value as goldBubbleValue,
      gold_bubble_percent as goldBubblePercent,
      intrinsic_value as intrinsicValue,
      bubble_value as bubbleValue,
      bubble_percent as bubblePercent,
      decision,
      sources_json as sourcesJson
    from market_history
    order by timestamp desc
    limit ?
  `).all(limit).reverse().map((row) => ({
    ...row,
    sources: row.sourcesJson ? JSON.parse(row.sourcesJson) : []
  }));
}

module.exports = { appendHistory, readHistory };
