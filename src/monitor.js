const { calculateCoinBubble, calculateGoldBubble, calculateSilverBubble, classifyBubble } = require('./bubble');
const { config } = require('./config');
const { formatAnalysisReport, formatReport } = require('./format');
const { fetchMarketSources } = require('./sources');
const { appendHistory, readHistory } = require('./history');
const { analyzeTrend } = require('./trend');
const { analyzeMarket } = require('./analysis');

let snapshotCache = null;
let snapshotInFlight = null;
let lastHistoryCollectedAt = null;

function cacheTtlMs(options = {}) {
  const seconds = Number(options.ttlSeconds || config.snapshotCacheTtlSeconds || 0);
  return Math.max(0, seconds * 1000);
}

function isCacheFresh(options = {}) {
  if (!snapshotCache) return false;
  const ttl = cacheTtlMs(options);
  if (!ttl) return false;
  return Date.now() - snapshotCache.cachedAt <= ttl;
}

async function computeSnapshot() {
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
  const extraCoins = {
    bahar: {
      title: 'سکه بهار آزادی',
      price: market.baharCoinPrice,
      weightGrams: config.baharCoinWeightGrams
    },
    half: {
      title: 'نیم سکه',
      price: market.halfCoinPrice,
      weightGrams: config.halfCoinWeightGrams
    },
    quarter: {
      title: 'ربع سکه',
      price: market.quarterCoinPrice,
      weightGrams: config.quarterCoinWeightGrams
    },
    gram: {
      title: 'سکه گرمی',
      price: market.gramCoinPrice,
      weightGrams: config.gramCoinWeightGrams
    }
  };
  for (const item of Object.values(extraCoins)) {
    if (!item.price) continue;
    Object.assign(item, calculateCoinBubble({
      gold18Price: gold.price,
      coinPrice: item.price,
      coinWeightGrams: item.weightGrams,
      coinPurity: config.coinPurity,
      goldPricePurity: config.goldPricePurity
    }));
  }
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
  const analysisDollarSource = (market.analysisSamples || []).find((source) => source && source.dollarToman);
  const analysisDollarToman = analysisDollarSource && analysisDollarSource.dollarToman;
  const analysisGoldBubble = analysisDollarToman
    ? calculateGoldBubble({
      gold18Price: gold.price,
      dollarToman: analysisDollarToman,
      ounceUsd: market.ounceUsd
    })
    : goldBubble;
  const analysisSilverBubble = analysisDollarToman && market.silverPrice && market.silverOunceUsd
    ? calculateSilverBubble({
      silverPrice: market.silverPrice,
      dollarToman: analysisDollarToman,
      silverOunceUsd: market.silverOunceUsd
    })
    : silverBubble;
  const analysisCoinIntrinsicValue = analysisGoldBubble.theoreticalGold18Rial
    * config.coinWeightGrams
    * (config.coinPurity / config.goldPricePurity);
  const analysisCoinBubbleValue = coin.price - analysisCoinIntrinsicValue;
  const analysisCoinBubblePercent = (analysisCoinBubbleValue / analysisCoinIntrinsicValue) * 100;
  const decision = classifyBubble(
    bubble.bubblePercent,
    config.buyBubblePercent,
    config.sellBubblePercent
  );
  const historyRows = await readHistory(5000);
  const trend = analyzeTrend(historyRows);
  const snapshot = {
    collectedAt: new Date().toISOString(),
    gold,
    coin,
    extraCoins,
    dollarToman: market.dollarToman,
    tetherToman: market.tetherToman,
    ounceUsd: market.ounceUsd,
    silverPrice: market.silverPrice,
    silverOunceUsd: market.silverOunceUsd,
    ...bubble,
    ...goldBubble,
    ...(silverBubble || {}),
    decision,
    buyBubblePercent: config.buyBubblePercent,
    sellBubblePercent: config.sellBubblePercent,
    sourceMaxAgeHours: config.sourceMaxAgeHours,
    channelSourceMaxAgeHours: config.channelSourceMaxAgeHours,
    sources: market.samples,
    analysisSources: market.analysisSamples,
    analysisDollarSource,
    analysisDollarToman,
    analysisGoldBubblePercent: analysisGoldBubble.goldBubblePercent,
    analysisSilverBubblePercent: analysisSilverBubble && analysisSilverBubble.silverBubblePercent,
    analysisCoinBubblePercent,
    sourceErrors: market.errors,
    sourceDiagnostics: market.sourceDiagnostics,
    sourceAlerts: market.sourceAlerts,
    technical: market.technical,
    trend
  };
  snapshot.analysis = analyzeMarket(snapshot, historyRows);
  return snapshot;
}

async function getSnapshot(options = {}) {
  if (!options.force && isCacheFresh(options)) return snapshotCache.snapshot;
  if (!options.force && snapshotInFlight) return snapshotInFlight;

  snapshotInFlight = computeSnapshot()
    .then((snapshot) => {
      snapshotCache = {
        snapshot,
        cachedAt: Date.now()
      };
      return snapshot;
    })
    .catch((error) => {
      if (snapshotCache && !options.force) return snapshotCache.snapshot;
      throw error;
    })
    .finally(() => {
      snapshotInFlight = null;
    });
  return snapshotInFlight;
}

async function refreshSnapshotCache() {
  return getSnapshot({ force: true });
}

async function appendHistoryOnce(snapshot) {
  if (!snapshot || !snapshot.collectedAt) return;
  if (lastHistoryCollectedAt === snapshot.collectedAt) return;
  await appendHistory(snapshot);
  lastHistoryCollectedAt = snapshot.collectedAt;
}

function shouldAlert(snapshot, previousDecision) {
  if (snapshot.decision === 'hold') return false;
  return snapshot.decision !== previousDecision;
}

async function buildReport(platform = 'telegram') {
  const snapshot = await getSnapshot();
  await appendHistoryOnce(snapshot);
  return { snapshot, message: formatReport(snapshot, platform) };
}

async function buildAnalysisReport(platform = 'telegram') {
  const snapshot = await getSnapshot();
  await appendHistoryOnce(snapshot);
  return { snapshot, message: formatAnalysisReport(snapshot, platform) };
}

module.exports = { buildAnalysisReport, buildReport, getSnapshot, refreshSnapshotCache, shouldAlert };
