const { calculateCoinBubble, calculateGoldBubble, calculateSilverBubble, classifyBubble } = require('./bubble');
const { config } = require('./config');
const { formatReport } = require('./format');
const { fetchMarketSources } = require('./sources');
const { appendHistory, readHistory } = require('./history');
const { analyzeTrend } = require('./trend');

async function getSnapshot() {
  const market = await fetchMarketSources(config);
  const gold = {
    symbol: 'average_gold18',
    title: 'میانگین طلای 18 عیار',
    price: market.gold18Price,
    updatedAt: null
  };
  const coin = {
    symbol: 'average_coin',
    title: 'میانگین سکه',
    price: market.coinPrice,
    updatedAt: null
  };
  const bubble = calculateCoinBubble({
    gold18Price: gold.price,
    coinPrice: coin.price,
    coinWeightGrams: config.coinWeightGrams,
    coinPurity: config.coinPurity,
    goldPricePurity: config.goldPricePurity
  });
  const goldBubble = calculateGoldBubble({
    gold18Price: gold.price,
    dollarToman: market.dollarToman,
    ounceUsd: market.ounceUsd
  });
  const silverBubble = market.silverPrice && market.silverOunceUsd
    ? calculateSilverBubble({
      silverPrice: market.silverPrice,
      dollarToman: market.dollarToman,
      silverOunceUsd: market.silverOunceUsd
    })
    : null;
  const decision = classifyBubble(
    bubble.bubblePercent,
    config.buyBubblePercent,
    config.sellBubblePercent
  );
  const historyRows = await readHistory(5000);
  const trend = analyzeTrend(historyRows);
  return {
    gold,
    coin,
    dollarToman: market.dollarToman,
    ounceUsd: market.ounceUsd,
    silverPrice: market.silverPrice,
    silverOunceUsd: market.silverOunceUsd,
    ...bubble,
    ...goldBubble,
    ...(silverBubble || {}),
    decision,
    sources: market.samples,
    sourceErrors: market.errors,
    trend
  };
}

function shouldAlert(snapshot, previousDecision) {
  if (snapshot.decision === 'hold') return false;
  return snapshot.decision !== previousDecision;
}

async function buildReport() {
  const snapshot = await getSnapshot();
  await appendHistory(snapshot);
  return { snapshot, message: formatReport(snapshot) };
}

module.exports = { buildReport, getSnapshot, shouldAlert };
