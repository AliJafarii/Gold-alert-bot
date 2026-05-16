const { mkdir, readFile, appendFile } = require('fs/promises');
const { dirname } = require('path');
const { config } = require('./config');

async function appendHistory(snapshot) {
  await mkdir(dirname(config.historyFile), { recursive: true });
  const row = {
    timestamp: new Date().toISOString(),
    gold18Price: snapshot.gold.price,
    coinPrice: snapshot.coin.price,
    dollarToman: snapshot.dollarToman,
    ounceUsd: snapshot.ounceUsd,
    silverPrice: snapshot.silverPrice,
    silverOunceUsd: snapshot.silverOunceUsd,
    theoreticalSilverRial: snapshot.theoreticalSilverRial,
    silverBubbleValue: snapshot.silverBubbleValue,
    silverBubblePercent: snapshot.silverBubblePercent,
    theoreticalGold18Rial: snapshot.theoreticalGold18Rial,
    goldBubbleValue: snapshot.goldBubbleValue,
    goldBubblePercent: snapshot.goldBubblePercent,
    intrinsicValue: snapshot.intrinsicValue,
    bubbleValue: snapshot.bubbleValue,
    bubblePercent: snapshot.bubblePercent,
    decision: snapshot.decision,
    sources: snapshot.sources
  };
  await appendFile(config.historyFile, JSON.stringify(row) + '\n');
}

async function readHistory(limit = 5000) {
  try {
    const content = await readFile(config.historyFile, 'utf8');
    return content.trim().split('\n').filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

module.exports = { appendHistory, readHistory };
