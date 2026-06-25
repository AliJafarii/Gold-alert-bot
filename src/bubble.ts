// @ts-nocheck
function calculateCoinBubble({ gold18Price, coinPrice, coinWeightGrams, coinPurity, goldPricePurity }) {
  const intrinsicValue = gold18Price * coinWeightGrams * (coinPurity / goldPricePurity);
  const bubbleValue = coinPrice - intrinsicValue;
  const bubblePercent = (bubbleValue / intrinsicValue) * 100;
  return { intrinsicValue, bubbleValue, bubblePercent };
}

function calculateGoldBubble({ gold18Price, dollarToman, ounceUsd }) {
  const ounceGrams = 31.1034768;
  const theoreticalGold18Rial = ((ounceUsd * dollarToman) / ounceGrams) * 0.75 * 10;
  const goldBubbleValue = gold18Price - theoreticalGold18Rial;
  const goldBubblePercent = (goldBubbleValue / theoreticalGold18Rial) * 100;
  return { theoreticalGold18Rial, goldBubbleValue, goldBubblePercent };
}

function calculateSilverBubble({ silverPrice, dollarToman, silverOunceUsd }) {
  const ounceGrams = 31.1034768;
  const theoreticalSilverRial = ((silverOunceUsd * dollarToman) / ounceGrams) * 10;
  const silverBubbleValue = silverPrice - theoreticalSilverRial;
  const silverBubblePercent = (silverBubbleValue / theoreticalSilverRial) * 100;
  return { theoreticalSilverRial, silverBubbleValue, silverBubblePercent };
}

function classifyBubble(bubblePercent, buyThreshold, sellThreshold) {
  if (bubblePercent <= buyThreshold) return 'buy';
  if (bubblePercent >= sellThreshold) return 'sell';
  return 'hold';
}

module.exports = { calculateCoinBubble, calculateGoldBubble, calculateSilverBubble, classifyBubble };
