// @ts-nocheck
const HOUR_MS = 60 * 60 * 1000;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function changePercent(from, to) {
  if (!validNumber(from) || !validNumber(to)) return null;
  return ((to - from) / from) * 100;
}

function rowsSince(rows, hours) {
  if (!rows.length) return [];
  const lastTime = Date.parse(rows[rows.length - 1].timestamp);
  if (!Number.isFinite(lastTime)) return rows;
  const cutoff = lastTime - (hours * HOUR_MS);
  return rows.filter((row) => {
    const time = Date.parse(row.timestamp);
    return Number.isFinite(time) && time >= cutoff;
  });
}

function metricChange(rows, key, hours) {
  const scoped = rowsSince(rows, hours).filter((row) => validNumber(row[key]));
  if (scoped.length < 2) return null;
  return changePercent(scoped[0][key], scoped[scoped.length - 1][key]);
}

function trendScore(rows, key) {
  const oneHour = metricChange(rows, key, 1);
  const fourHour = metricChange(rows, key, 4);
  const day = metricChange(rows, key, 24);
  const week = metricChange(rows, key, 168);
  const available = [oneHour, fourHour, day].filter(Number.isFinite);
  if (!available.length) {
    return {
      score: 0,
      oneHour,
      fourHour,
      day,
      week,
      label: 'تاریخچه کافی نیست'
    };
  }
  const weighted = (
    (Number.isFinite(oneHour) ? oneHour * 0.45 : 0)
    + (Number.isFinite(fourHour) ? fourHour * 0.35 : 0)
    + (Number.isFinite(day) ? day * 0.2 : 0)
  ) / (
    (Number.isFinite(oneHour) ? 0.45 : 0)
    + (Number.isFinite(fourHour) ? 0.35 : 0)
    + (Number.isFinite(day) ? 0.2 : 0)
  );
  const score = clamp(weighted / 1.8, -1, 1);
  let label = 'روند داخلی خنثی است';
  if (score >= 0.35) label = 'روند داخلی صعودی است';
  if (score <= -0.35) label = 'روند داخلی نزولی است';
  return {
    score,
    oneHour,
    fourHour,
    day,
    week,
    label
  };
}

function sourceMetricRows(rows, sourceName, metric, currentValue) {
  const normalized = String(sourceName || '').toLowerCase();
  const mapped = rows.map((row) => {
    const source = (row.sources || []).find((item) => String(item.name || '').toLowerCase() === normalized);
    return {
      timestamp: row.timestamp,
      [metric]: source && source[metric]
    };
  }).filter((row) => validNumber(row[metric]));
  if (validNumber(currentValue)) {
    mapped.push({ timestamp: new Date().toISOString(), [metric]: currentValue });
  }
  return mapped;
}

function valuationScore(bubblePercent, cheapAt, expensiveAt) {
  if (!Number.isFinite(bubblePercent)) return 0;
  if (bubblePercent < 0) return clamp(Math.abs(bubblePercent) / Math.abs(cheapAt), 0, 1);
  return -clamp(bubblePercent / expensiveAt, 0, 1);
}

function technicalScore(signal) {
  if (!signal) return { score: 0, label: 'شاخص جهانی در دسترس نیست' };
  const pieces = [
    Number(signal.recommendAll),
    Number(signal.recommendOneHour),
    Number(signal.recommendFourHour)
  ].filter(Number.isFinite);
  let score = pieces.length ? pieces.reduce((sum, item) => sum + item, 0) / pieces.length : 0;
  if (Number.isFinite(signal.rsi)) {
    if (signal.rsi <= 30) score += 0.2;
    if (signal.rsi >= 70) score -= 0.2;
  }
  score = clamp(score, -1, 1);
  let label = 'تکنیکال جهانی خنثی است';
  if (score >= 0.35) label = 'تکنیکال جهانی مثبت است';
  if (score <= -0.35) label = 'تکنیکال جهانی منفی است';
  return { score, label };
}

function sourceCount(snapshot, metric) {
  const diagnostics = snapshot.sourceDiagnostics && snapshot.sourceDiagnostics[metric];
  if (diagnostics && Array.isArray(diagnostics.used)) return diagnostics.used.length;
  return (snapshot.sources || []).filter((source) => validNumber(source[metric])).length;
}

function confidence(snapshot, metric, historyRows, hasTechnical) {
  const count = sourceCount(snapshot, metric);
  const sourcePart = clamp(count / 3, 0, 1) * 45;
  const historyPart = clamp(historyRows.length / 24, 0, 1) * 35;
  const technicalPart = hasTechnical ? 20 : 8;
  return Math.round(sourcePart + historyPart + technicalPart);
}

function decisionFromScore(score) {
  if (score >= 0.35) return 'buy';
  if (score <= -0.35) return 'sell';
  return 'hold';
}

function decisionLabel(decision) {
  return {
    buy: 'روند افزایشی',
    sell: 'روند کاهشی',
    hold: 'روند خنثی'
  }[decision] || 'نامشخص';
}

function trendWord(change) {
  if (!Number.isFinite(change)) return 'نامشخص';
  if (change >= 0.7) return 'مثبت';
  if (change <= -0.7) return 'منفی';
  return 'خنثی';
}

function actionWord(decision) {
  return {
    buy: 'رصد رشد',
    sell: 'رصد کاهش',
    hold: 'رصد'
  }[decision] || 'رصد';
}

function formatChange(value) {
  if (!Number.isFinite(value)) return 'نامشخص';
  const rounded = round(value, 2);
  return (rounded > 0 ? '+' : '') + rounded + '٪';
}

function shortReason(decision, bubblePercent, trend, tech) {
  const pieces = [];
  if (Number.isFinite(bubblePercent)) {
    if (bubblePercent <= -1) pieces.push('حباب منفی');
    else if (bubblePercent >= 1) pieces.push('حباب مثبت');
  }
  if (trend && trend.label && !/خنثی|کافی نیست/.test(trend.label)) {
    pieces.push(trend.label.replace(' است', ''));
  }
  if (tech && tech.label && !/خنثی|نداریم/.test(tech.label)) {
    pieces.push(tech.label.replace(' است', ''));
  }
  if (!pieces.length) {
    pieces.push(decision === 'hold' ? 'شاخص‌ها هم‌جهت نیستند' : 'امتیاز تغییرات از آستانه عبور کرده');
  }
  return pieces.slice(0, 2).join('، ');
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return null;
  return formatChange(value);
}

function dollarSpread(snapshot) {
  if (!validNumber(snapshot.analysisDollarToman) || !validNumber(snapshot.dollarToman)) return null;
  return ((snapshot.analysisDollarToman - snapshot.dollarToman) / snapshot.dollarToman) * 100;
}

function softenDecision(decision, score, threshold) {
  if (Math.abs(score) < threshold) return 'hold';
  return decision;
}

function publicHorizonHint(decision, score) {
  return 'کوتاه‌مدت (۱ ماه): ' + actionWord(softenDecision(decision, score, 0.35))
    + ' | میان‌مدت (۳ ماه): ' + actionWord(softenDecision(decision, score, 0.55))
    + ' | بلندمدت (۶ ماه): ' + actionWord(softenDecision(decision, score, 0.75));
}

function adminTrendDetail(trend) {
  return 'روند داده‌ها: ۱ساعت ' + formatChange(trend && trend.oneHour)
    + ' | ۴ساعت ' + formatChange(trend && trend.fourHour)
    + ' | ۲۴ساعت ' + formatChange(trend && trend.day)
    + ' | ۷روز ' + formatChange(trend && trend.week);
}

function riskLabel(score) {
  const abs = Math.abs(score);
  if (abs >= 0.7) return 'بالا';
  if (abs >= 0.35) return 'متوسط';
  return 'کم';
}

function buildAssetAnalysis({
  key,
  title,
  price,
  bubblePercent,
  cheapAt,
  expensiveAt,
  trend,
  technical,
  metric,
  historyRows,
  snapshot,
  weights,
  valueScoreOverride,
  summaryOverride
}) {
  if (!validNumber(price)) {
    return {
      key,
      title,
      decision: 'hold',
      decisionLabel: 'نامشخص',
      confidence: 0,
      score: 0,
      reason: 'قیمت قابل اتکا برای تحلیل نداریم.'
    };
  }

  const valueScore = Number.isFinite(valueScoreOverride)
    ? clamp(valueScoreOverride, -1, 1)
    : valuationScore(bubblePercent, cheapAt, expensiveAt);
  const tech = technicalScore(technical);
  const score = clamp(
    (valueScore * weights.valuation)
    + (trend.score * weights.trend)
    + (tech.score * weights.technical),
    -1,
    1
  );
  const decision = decisionFromScore(score);
  const recentTrend = clamp(trend.fourHour || trend.oneHour || 0, -6, 6);
  const projectedChangePercent = round(clamp((score * 1.1) + (recentTrend * 0.25), -5, 5), 2);
  const reasons = [];
  if (Number.isFinite(bubblePercent)) {
    reasons.push('حباب ' + round(bubblePercent, 2) + '٪');
  }
  reasons.push(trend.label);
  reasons.push(tech.label);

  return {
    key,
    title,
    price,
    decision,
    decisionLabel: decisionLabel(decision),
    confidence: confidence(snapshot, metric, historyRows, Boolean(technical)),
    score: round(score, 2),
    risk: riskLabel(score),
    summary: summaryOverride || shortReason(decision, bubblePercent, trend, tech),
    horizonHint: publicHorizonHint(decision, score),
    adminDetail: adminTrendDetail(trend),
    projectedChangePercent,
    trend,
    technical: tech,
    bubblePercent: Number.isFinite(bubblePercent) ? round(bubblePercent, 2) : null,
    reason: reasons.join('؛ ')
  };
}

function analyzeMarket(snapshot, historyRows) {
  const analysisDollarName = snapshot.analysisDollarSource && snapshot.analysisDollarSource.name;
  const analysisDollarRows = analysisDollarName
    ? sourceMetricRows(historyRows, analysisDollarName, 'dollarToman', snapshot.analysisDollarToman)
    : rowsSince(historyRows, 24);
  const rows = [...historyRows, {
    timestamp: new Date().toISOString(),
    gold18Price: snapshot.gold && snapshot.gold.price,
    dollarToman: snapshot.dollarToman,
    analysisDollarToman: snapshot.analysisDollarToman,
    silverPrice: snapshot.silverPrice,
    coinPrice: snapshot.coin && snapshot.coin.price,
    goldBubblePercent: snapshot.goldBubblePercent,
    silverBubblePercent: snapshot.silverBubblePercent
  }];
  const spread = dollarSpread(snapshot);
  const spreadText = formatSignedPercent(spread);
  const dollarSummary = spreadText
    ? 'اختلاف بازار آزاد با میانگین عمومی ' + spreadText + ' است'
    : null;
  const technical = snapshot.technical || {};
  const assets = [
    buildAssetAnalysis({
      key: 'gold18',
      title: 'طلای ۱۸ عیار',
      price: snapshot.gold && snapshot.gold.price,
      bubblePercent: Number.isFinite(snapshot.analysisGoldBubblePercent)
        ? snapshot.analysisGoldBubblePercent
        : snapshot.goldBubblePercent,
      cheapAt: 4,
      expensiveAt: 4,
      trend: trendScore(rows, 'gold18Price'),
      technical: technical.gold,
      metric: 'gold18Price',
      historyRows,
      snapshot,
      weights: { valuation: 0.45, trend: 0.3, technical: 0.25 }
    }),
    buildAssetAnalysis({
      key: 'dollar',
      title: 'دلار',
      price: snapshot.analysisDollarToman || snapshot.dollarToman,
      bubblePercent: null,
      cheapAt: 4,
      expensiveAt: 4,
      trend: trendScore(analysisDollarRows.length ? analysisDollarRows : rows, 'dollarToman'),
      technical: null,
      metric: 'dollarToman',
      historyRows,
      snapshot,
      weights: { valuation: 0.35, trend: 0.65, technical: 0 },
      valueScoreOverride: Number.isFinite(spread) ? spread / 1.2 : 0,
      summaryOverride: dollarSummary
    }),
    buildAssetAnalysis({
      key: 'coin',
      title: 'سکه امامی',
      price: snapshot.coin && snapshot.coin.price,
      bubblePercent: snapshot.analysisCoinBubblePercent,
      cheapAt: 5,
      expensiveAt: 5,
      trend: trendScore(rows, 'coinPrice'),
      technical: technical.gold,
      metric: 'coinPrice',
      historyRows,
      snapshot,
      weights: { valuation: 0.5, trend: 0.2, technical: 0.3 }
    }),
    buildAssetAnalysis({
      key: 'silver',
      title: 'نقره ۹۹۹',
      price: snapshot.silverPrice,
      bubblePercent: Number.isFinite(snapshot.analysisSilverBubblePercent)
        ? snapshot.analysisSilverBubblePercent
        : snapshot.silverBubblePercent,
      cheapAt: 5,
      expensiveAt: 5,
      trend: trendScore(rows, 'silverPrice'),
      technical: technical.silver,
      metric: 'silverPrice',
      historyRows,
      snapshot,
      weights: { valuation: 0.45, trend: 0.25, technical: 0.3 }
    })
  ];
  return {
    method: 'valuation + local momentum + global technical',
    horizon: 'کوتاه‌مدت',
    assets
  };
}

module.exports = { analyzeMarket };
