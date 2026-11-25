import type {
  BacktestRunMetrics,
  BacktestTrade,
  Candle,
  CustomIndicator,
  SchoolId,
  Timeframe,
} from '../types/trading.ts';
import { SCHOOL_MAP, SYMBOL_MAP } from './schools.ts';
import {
  calcEMA,
  calcMACD,
  calcRSI,
  evaluateAntiCounterTrendGuard,
  evaluateAntiLateEntry,
  evaluateCRTSetup,
  evaluateCustomIndicator,
  getTimeframeMaxSlCap,
} from './indicators.ts';

const RISK_USD_PER_R = 100; // $100 = 1% of $10,000 standard backtest unit

function computeAtrSeries(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(0);
  if (candles.length === 0) return out;
  out[0] = Math.max(candles[0].high - candles[0].low, 0.0001);
  let rolling = out[0];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    if (i < period) {
      rolling = (rolling * i + tr) / (i + 1);
    } else {
      rolling = (rolling * (period - 1) + tr) / period;
    }
    out[i] = Math.max(rolling, 0.00001);
  }
  return out;
}

/**
 * Strictly Causal (Zero Look-Ahead Bias) Backtest Setup Detector & Trade Simulator.
 * Only ever inspects `visibleCandles[0 .. visibleCandles.length - 1]` — future bars are never passed.
 */
export function evaluateCausalBacktest(
  visibleCandles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  activeSchools: SchoolId[],
  customIndicators: CustomIndicator[]
): BacktestTrade[] {
  if (visibleCandles.length < 36) return [];

  const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
  const dec = info.decimals;
  const roundP = (v: number) => Number(v.toFixed(dec));
  const schoolSet = new Set<SchoolId>(
    activeSchools.length > 0 ? activeSchools : ['price_action', 'smc', 'indicators']
  );

  // Precompute causal indicator maps (each point depends strictly on <= bar i)
  const atrArr = computeAtrSeries(visibleCandles, 14);
  const ema8 = new Map(calcEMA(visibleCandles, 8).map((p) => [p.time, p.value]));
  const ema21 = new Map(calcEMA(visibleCandles, 21).map((p) => [p.time, p.value]));
  const ema50 = new Map(calcEMA(visibleCandles, 50).map((p) => [p.time, p.value]));
  const rsi14 = new Map(calcRSI(visibleCandles, 14).map((p) => [p.time, p.value]));
  const { macdLine, signalLine } = calcMACD(visibleCandles, 12, 26, 9);
  const macdMap = new Map(macdLine.map((p) => [p.time, p.value]));
  const macdSigMap = new Map(signalLine.map((p) => [p.time, p.value]));

  // Precompute visible custom indicator series on visibleCandles
  const customSeriesMaps = customIndicators
    .filter((ind) => ind.visible)
    .map((ind) => ({
      ind,
      series: evaluateCustomIndicator(visibleCandles, ind).map((s) => ({
        id: s.id,
        name: s.name,
        pane: s.pane,
        map: new Map(s.data.map((pt) => [pt.time, pt.value])),
      })),
    }));

  const setups: BacktestTrade[] = [];
  let lastSignalBar = -20;

  for (let i = 35; i < visibleCandles.length; i++) {
    const bar = visibleCandles[i];
    const prev = visibleCandles[i - 1];
    const atr = atrArr[i];

    // 1. Update open/breakeven setups strictly using ONLY bar `i` (never look ahead)
    for (const tr of setups) {
      if (tr.exitTime !== undefined) continue; // Already finalized (frozen)
      if (i <= tr.barIndex) continue;

      const isBuy = tr.direction === 'BUY';
      const risk = Math.max(info.pipSize, Math.abs(tr.entryPrice - tr.stopLoss));

      // Conservative OHLC simulation: check active SL / BE / trailed-TP1 level first
      const slHit = isBuy ? bar.low <= tr.currentSl : bar.high >= tr.currentSl;
      if (slHit) {
        if (tr.tp2Hit) {
          // Stopped out at trailed TP1 after TP2 had already hit
          tr.status = 'Won';
          tr.exitPrice = tr.currentSl;
          tr.exitTime = bar.time;
          tr.pnlR = Number((Math.abs(tr.currentSl - tr.entryPrice) / risk).toFixed(2));
          tr.pnlUsd = Math.round(tr.pnlR * RISK_USD_PER_R * 100) / 100;
        } else if (tr.tp1Hit) {
          // Stopped out at Breakeven after TP1 had already locked SL at entry
          tr.status = 'Breakeven';
          tr.exitPrice = tr.entryPrice;
          tr.exitTime = bar.time;
          tr.pnlR = 0.25;
          tr.pnlUsd = Math.round(tr.pnlR * RISK_USD_PER_R * 100) / 100;
        } else {
          tr.status = 'Lost';
          tr.exitPrice = tr.stopLoss;
          tr.exitTime = bar.time;
          tr.pnlR = -1;
          tr.pnlUsd = -RISK_USD_PER_R;
        }
        continue;
      }

      // Check TP1, TP2, TP3 individually
      const hitTp1 = isBuy ? bar.high >= tr.tp1 : bar.low <= tr.tp1;
      const hitTp2 = isBuy ? bar.high >= tr.tp2 : bar.low <= tr.tp2;
      const hitTp3 = isBuy ? bar.high >= tr.tp3 : bar.low <= tr.tp3;

      if (hitTp1 && !tr.tp1Hit) {
        tr.tp1Hit = true;
        tr.currentSl = tr.entryPrice; // Move SL -> Breakeven
        tr.status = 'Breakeven';
        tr.pnlR = 0.35;
        tr.pnlUsd = Math.round(tr.pnlR * RISK_USD_PER_R * 100) / 100;
      }

      if (hitTp2 && !tr.tp2Hit) {
        tr.tp1Hit = true;
        tr.tp2Hit = true;
        tr.currentSl = tr.tp1; // Protect TP1 profit while targeting TP3
        tr.status = 'Breakeven';
        tr.pnlR = Number((Math.abs(tr.tp2 - tr.entryPrice) / risk).toFixed(2));
        tr.pnlUsd = Math.round(tr.pnlR * RISK_USD_PER_R * 100) / 100;
      }

      if (hitTp3) {
        tr.tp1Hit = true;
        tr.tp2Hit = true;
        tr.tp3Hit = true;
        tr.status = 'Won';
        tr.exitPrice = tr.tp3;
        tr.exitTime = bar.time;
        tr.pnlR = Number((Math.abs(tr.tp3 - tr.entryPrice) / risk).toFixed(2));
        tr.pnlUsd = Math.round(tr.pnlR * RISK_USD_PER_R * 100) / 100;
      }
    }

    // 2. Causal Confluence Evaluation at bar `i`
    const activeOpenCount = setups.filter((s) => s.exitTime === undefined).length;
    if (i - lastSignalBar < 10 || activeOpenCount >= 3) continue;

    // Causal lookback window [i - 24 .. i]
    let hi20 = -Infinity;
    let lo20 = Infinity;
    let hi10 = -Infinity;
    let lo10 = Infinity;
    let avgVol = 0;
    const winStart = Math.max(0, i - 20);
    for (let k = winStart; k < i; k++) {
      const ck = visibleCandles[k];
      if (ck.high > hi20) hi20 = ck.high;
      if (ck.low < lo20) lo20 = ck.low;
      if (k >= i - 10) {
        if (ck.high > hi10) hi10 = ck.high;
        if (ck.low < lo10) lo10 = ck.low;
      }
      avgVol += Math.max(1, ck.volume);
    }
    avgVol /= Math.max(1, i - winStart);

    const body = Math.abs(bar.close - bar.open);
    const range = Math.max(0.00001, bar.high - bar.low);
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const isBullBar = bar.close > bar.open;
    const isBearBar = bar.close < bar.open;

    const e8 = ema8.get(bar.time) ?? bar.close;
    const e21 = ema21.get(bar.time) ?? bar.close;
    const e50 = ema50.get(bar.time) ?? bar.close;
    const rsi = rsi14.get(bar.time) ?? 50;
    const prevRsi = rsi14.get(prev.time) ?? rsi;
    const macd = macdMap.get(bar.time) ?? 0;
    const macdSig = macdSigMap.get(bar.time) ?? 0;

    let buyVotes = 0;
    let sellVotes = 0;
    let buyWeight = 0;
    let sellWeight = 0;
    const buySchools: SchoolId[] = [];
    const sellSchools: SchoolId[] = [];
    const buyCustom: string[] = [];
    const sellCustom: string[] = [];

    const addSchoolVote = (dir: 'BUY' | 'SELL', school: SchoolId, weight = 1) => {
      const sw = SCHOOL_MAP[school]?.defaultWeight ?? 1;
      if (dir === 'BUY') {
        buyVotes++;
        buyWeight += weight * sw * 14;
        if (!buySchools.includes(school)) buySchools.push(school);
      } else {
        sellVotes++;
        sellWeight += weight * sw * 14;
        if (!sellSchools.includes(school)) sellSchools.push(school);
      }
    };

    // Price Action: Pin Bar / Engulfing / Strong Displacement
    if (schoolSet.has('price_action')) {
      const bullPin = lowerWick > body * 1.45 && isBullBar;
      const bearPin = upperWick > body * 1.45 && isBearBar;
      const bullEngulf =
        isBullBar &&
        prev.close < prev.open &&
        bar.close > prev.open &&
        body > Math.abs(prev.close - prev.open) * 1.05;
      const bearEngulf =
        isBearBar &&
        prev.close > prev.open &&
        bar.close < prev.open &&
        body > Math.abs(prev.close - prev.open) * 1.05;
      if (bullPin || bullEngulf || (isBullBar && body > atr * 0.65 && bar.close > prev.high)) {
        addSchoolVote('BUY', 'price_action', 1.15);
      } else if (bearPin || bearEngulf || (isBearBar && body > atr * 0.65 && bar.close < prev.low)) {
        addSchoolVote('SELL', 'price_action', 1.15);
      }
    }

    // SMC: BOS / FVG displacement
    if (schoolSet.has('smc')) {
      const c2 = visibleCandles[i - 2];
      const bullFvg = c2 && bar.low > c2.high && isBullBar;
      const bearFvg = c2 && bar.high < c2.low && isBearBar;
      const bullBos = bar.close > hi10 && prev.close <= hi10;
      const bearBos = bar.close < lo10 && prev.close >= lo10;
      if (bullBos || (bullFvg && e8 >= e21)) {
        addSchoolVote('BUY', 'smc', 1.2);
      } else if (bearBos || (bearFvg && e8 <= e21)) {
        addSchoolVote('SELL', 'smc', 1.2);
      }
    }

    // ICT: Liquidity sweep + reclaim or OTE alignment
    if (schoolSet.has('ict')) {
      const bullSweep = bar.low < lo20 && bar.close > lo20 && isBullBar;
      const bearSweep = bar.high > hi20 && bar.close < hi20 && isBearBar;
      const oteMid = lo20 + (hi20 - lo20) * 0.35;
      const oteHigh = lo20 + (hi20 - lo20) * 0.65;
      if (bullSweep || (isBullBar && bar.low <= oteMid && bar.close > e8)) {
        addSchoolVote('BUY', 'ict', 1.2);
      } else if (bearSweep || (isBearBar && bar.high >= oteHigh && bar.close < e8)) {
        addSchoolVote('SELL', 'ict', 1.2);
      }
    }

    // Supply & Demand: Imbalance rejection from recent origin
    if (schoolSet.has('supply_demand')) {
      const nearDemand = bar.low <= lo10 + atr * 0.35 && isBullBar && body > range * 0.45;
      const nearSupply = bar.high >= hi10 - atr * 0.35 && isBearBar && body > range * 0.45;
      if (nearDemand) addSchoolVote('BUY', 'supply_demand', 1.05);
      else if (nearSupply) addSchoolVote('SELL', 'supply_demand', 1.05);
    }

    // CRT: Causal Candle Range Theory (Range High/Low, 50% EQ, sweep & closed-candle reclaim)
    const crtCausal = schoolSet.has('crt')
      ? evaluateCRTSetup(visibleCandles.slice(Math.max(0, i - 35), i + 1), atr, dec)
      : null;
    if (crtCausal?.direction === 'BUY') {
      addSchoolVote('BUY', 'crt', crtCausal.displacementConfirmed ? 1.3 : 1.1);
    } else if (crtCausal?.direction === 'SELL') {
      addSchoolVote('SELL', 'crt', crtCausal.displacementConfirmed ? 1.3 : 1.1);
    }

    // Technical Indicators: EMA + RSI + MACD confluence
    if (schoolSet.has('indicators')) {
      if (e8 > e21 && (macd > macdSig || (rsi > 44 && rsi < 72 && rsi > prevRsi))) {
        addSchoolVote('BUY', 'indicators', 1.1);
      } else if (e8 < e21 && (macd < macdSig || (rsi < 56 && rsi > 28 && rsi < prevRsi))) {
        addSchoolVote('SELL', 'indicators', 1.1);
      }
    }

    // VSA: Volume Effort & Result confirmation
    if (schoolSet.has('vsa')) {
      if (bar.volume > avgVol * 1.25) {
        if (isBullBar && lowerWick >= upperWick) addSchoolVote('BUY', 'vsa', 1.1);
        else if (isBearBar && upperWick >= lowerWick) addSchoolVote('SELL', 'vsa', 1.1);
      }
    }

    // Classical: Breakout / trendline support/resistance bounce
    if (schoolSet.has('classical')) {
      if (bar.close > e50 && prev.close <= e50 && isBullBar) {
        addSchoolVote('BUY', 'classical', 1.0);
      } else if (bar.close < e50 && prev.close >= e50 && isBearBar) {
        addSchoolVote('SELL', 'classical', 1.0);
      }
    }

    // Wyckoff: Spring / Upthrust
    if (schoolSet.has('wyckoff')) {
      if (bar.low <= lo20 && bar.close > lo20 + range * 0.45) {
        addSchoolVote('BUY', 'wyckoff', 1.05);
      } else if (bar.high >= hi20 && bar.close < hi20 - range * 0.45) {
        addSchoolVote('SELL', 'wyckoff', 1.05);
      }
    }

    // Structural & Quantitative Secondary Schools (Elliott / Harmonic / Gann / Wolfe / Astrology / Fundamental / Psychology)
    if (schoolSet.has('elliott') && e8 > e21 && e21 > e50 && isBullBar) {
      addSchoolVote('BUY', 'elliott', 0.9);
    } else if (schoolSet.has('elliott') && e8 < e21 && e21 < e50 && isBearBar) {
      addSchoolVote('SELL', 'elliott', 0.9);
    }
    if (schoolSet.has('harmonic') && rsi < 38 && isBullBar) {
      addSchoolVote('BUY', 'harmonic', 0.9);
    } else if (schoolSet.has('harmonic') && rsi > 62 && isBearBar) {
      addSchoolVote('SELL', 'harmonic', 0.9);
    }
    if (schoolSet.has('psychology')) {
      const step = bar.close > 10000 ? 500 : bar.close > 500 ? 10 : bar.close > 20 ? 1 : 0.005;
      const nearestRound = Math.round(bar.close / step) * step;
      if (Math.abs(bar.close - nearestRound) < atr * 0.9) {
        if (isBullBar && bar.close >= nearestRound) addSchoolVote('BUY', 'psychology', 0.85);
        else if (isBearBar && bar.close <= nearestRound) addSchoolVote('SELL', 'psychology', 0.85);
      }
    }
    if (schoolSet.has('gann') && (i % 9 === 0 || i % 16 === 0)) {
      if (isBullBar && bar.close > e21) addSchoolVote('BUY', 'gann', 0.85);
      else if (isBearBar && bar.close < e21) addSchoolVote('SELL', 'gann', 0.85);
    }
    if (schoolSet.has('wolfe') && bar.low < lo10 && isBullBar) {
      addSchoolVote('BUY', 'wolfe', 0.85);
    } else if (schoolSet.has('wolfe') && bar.high > hi10 && isBearBar) {
      addSchoolVote('SELL', 'wolfe', 0.85);
    }
    if (schoolSet.has('fundamental') && Math.abs(bar.close - e50) > atr * 0.4) {
      if (bar.close > e50 && isBullBar) addSchoolVote('BUY', 'fundamental', 0.8);
      else if (bar.close < e50 && isBearBar) addSchoolVote('SELL', 'fundamental', 0.8);
    }
    if (schoolSet.has('astrology') && i % 13 === 0) {
      if (isBullBar) addSchoolVote('BUY', 'astrology', 0.75);
      else if (isBearBar) addSchoolVote('SELL', 'astrology', 0.75);
    }

    // Custom AI Studio Indicators confluence evaluation
    for (const item of customSeriesMaps) {
      const mainSeries = item.series.filter((s) => s.pane === 'main');
      const oscSeries = item.series.filter((s) => s.pane === 'oscillator');
      if (mainSeries.length >= 2) {
        const v0 = mainSeries[0].map.get(bar.time);
        const v1 = mainSeries[1].map.get(bar.time);
        if (v0 !== undefined && v1 !== undefined) {
          if (v0 > v1 && bar.close >= v0) {
            buyVotes++;
            buyWeight += 15;
            buyCustom.push(item.ind.name);
          } else if (v0 < v1 && bar.close <= v0) {
            sellVotes++;
            sellWeight += 15;
            sellCustom.push(item.ind.name);
          }
        }
      } else if (mainSeries.length === 1) {
        const v0 = mainSeries[0].map.get(bar.time);
        if (v0 !== undefined) {
          if (bar.close > v0 && isBullBar) {
            buyVotes++;
            buyWeight += 12;
            buyCustom.push(item.ind.name);
          } else if (bar.close < v0 && isBearBar) {
            sellVotes++;
            sellWeight += 12;
            sellCustom.push(item.ind.name);
          }
        }
      } else if (oscSeries.length >= 1) {
        const v0 = oscSeries[0].map.get(bar.time);
        if (v0 !== undefined) {
          if ((v0 > 0 && v0 < 68 && isBullBar) || (v0 <= 35 && isBullBar)) {
            buyVotes++;
            buyWeight += 12;
            buyCustom.push(item.ind.name);
          } else if ((v0 < 0 && isBearBar) || (v0 >= 65 && isBearBar)) {
            sellVotes++;
            sellWeight += 12;
            sellCustom.push(item.ind.name);
          }
        }
      }
    }

    const minVotesNeeded = Math.max(2, Math.min(3, Math.ceil(schoolSet.size * 0.35)));
    let chosenDir: 'BUY' | 'SELL' | null = null;
    if (buyVotes >= minVotesNeeded && buyWeight > sellWeight * 1.35) {
      chosenDir = 'BUY';
    } else if (sellVotes >= minVotesNeeded && sellWeight > buyWeight * 1.35) {
      chosenDir = 'SELL';
    }

    if (!chosenDir) continue;

    const matchedSchools = chosenDir === 'BUY' ? buySchools : sellSchools;
    const matchedCustom = chosenDir === 'BUY' ? buyCustom : sellCustom;
    const rawScore = chosenDir === 'BUY' ? buyWeight : sellWeight;
    const hasSweepOrCrt =
      crtCausal?.direction === chosenDir ||
      matchedSchools.includes('ict') ||
      matchedSchools.includes('wyckoff');
    const hasDisplacement =
      matchedSchools.includes('smc') ||
      matchedSchools.includes('price_action') ||
      Boolean(crtCausal?.displacementConfirmed);
    if (!hasSweepOrCrt && !hasDisplacement) continue;

    const score = Math.min(
      98,
      Math.max(
        60,
        Math.round(
          46 +
            rawScore * 0.78 +
            (crtCausal?.direction === chosenDir ? 6 : 0) +
            (hasSweepOrCrt && hasDisplacement ? 5 : 0)
        )
      )
    );

    // Require high Confluence Score (>= 80/100)
    if (score < 80) continue;

    // Causal 2-Loss Cool-Down Gate & Repeated Pattern Tightening
    const recentClosed = setups.filter((s) => s.exitTime !== undefined);
    const lenClosed = recentClosed.length;
    const sameDirLosses = recentClosed.slice(-6).filter((s) => s.status === 'Lost' && s.direction === chosenDir).length;
    if (
      (lenClosed >= 2 &&
        recentClosed[lenClosed - 1].status === 'Lost' &&
        recentClosed[lenClosed - 2].status === 'Lost') ||
      sameDirLosses >= 2
    ) {
      const barsSinceLoss = lenClosed > 0 ? i - recentClosed[lenClosed - 1].barIndex : 99;
      if (barsSinceLoss < 16 && !(score >= 86 && matchedSchools.length >= 4)) {
        continue;
      }
    }

    // Causal Anti-Late-Entry & Anti-Counter-Trend Guards
    const lookbackSlice = visibleCandles.slice(Math.max(0, i - 45), i + 1);
    const antiLate = evaluateAntiLateEntry(lookbackSlice, chosenDir, atr, crtCausal?.eq50);
    if (antiLate.blocked) continue;
    const antiCt = evaluateAntiCounterTrendGuard(lookbackSlice, [], chosenDir, atr, crtCausal);
    if (antiCt.blocked) continue;

    const entryPrice = roundP(bar.close);
    const zonePad = Math.max(info.pipSize * 2, atr * 0.22);
    const entryZone: [number, number] = [
      roundP(entryPrice - zonePad),
      roundP(entryPrice + zonePad),
    ];

    // Timeframe-Aware Max Stop Loss Cap + Structural/CRT Invalidation
    const { minSlDist, maxSlCap } = getTimeframeMaxSlCap(symbol, timeframe, entryPrice, atr);
    const structSl =
      chosenDir === 'BUY'
        ? (crtCausal?.direction === 'BUY' ? Math.min(crtCausal.suggestedSl, lo10 - atr * 0.2) : lo10 - atr * 0.2)
        : (crtCausal?.direction === 'SELL' ? Math.max(crtCausal.suggestedSl, hi10 + atr * 0.2) : hi10 + atr * 0.2);

    const rawStructDist = Math.abs(entryPrice - structSl);
    if (rawStructDist > maxSlCap * 1.55) continue;

    const slDist = Math.min(maxSlCap, Math.max(minSlDist, rawStructDist));
    const stopLoss = roundP(chosenDir === 'BUY' ? entryPrice - slDist : entryPrice + slDist);
    let tp1 = roundP(chosenDir === 'BUY' ? entryPrice + slDist * 1.18 : entryPrice - slDist * 1.18);
    let tp2 = roundP(chosenDir === 'BUY' ? entryPrice + slDist * 2.15 : entryPrice - slDist * 2.15);
    let tp3 = roundP(chosenDir === 'BUY' ? entryPrice + slDist * 3.2 : entryPrice - slDist * 3.2);

    if (crtCausal?.direction === chosenDir) {
      const crtTp1Dist = Math.abs(crtCausal.suggestedTp1 - entryPrice);
      if (
        ((chosenDir === 'BUY' && crtCausal.suggestedTp1 > entryPrice) ||
          (chosenDir === 'SELL' && crtCausal.suggestedTp1 < entryPrice)) &&
        crtTp1Dist >= slDist * 1.0 &&
        crtTp1Dist <= slDist * 1.65
      ) {
        tp1 = crtCausal.suggestedTp1;
        tp2 = crtCausal.suggestedTp2;
        tp3 = crtCausal.suggestedTp3;
      }
    }

    const schoolNamesEn = matchedSchools.map((id) => SCHOOL_MAP[id]?.shortEn || id).join(' + ');
    const schoolNamesAr = matchedSchools.map((id) => SCHOOL_MAP[id]?.nameAr || id).join(' + ');
    const indNoteEn = matchedCustom.length > 0 ? ` · Indicators: ${matchedCustom.join(', ')}` : '';
    const indNoteAr = matchedCustom.length > 0 ? ` · مؤشرات: ${matchedCustom.join('، ')}` : '';

    lastSignalBar = i;
    setups.push({
      id: `bt_${symbol}_${timeframe}_${i}_${bar.time}`,
      symbol,
      timeframe,
      direction: chosenDir,
      barIndex: i,
      entryTime: bar.time,
      entryPrice,
      entryZone,
      stopLoss,
      currentSl: stopLoss,
      takeProfit: tp2,
      tp1,
      tp2,
      tp3,
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
      status: 'Active',
      pnlR: 0,
      pnlUsd: 0,
      score,
      schoolsUsed: matchedSchools,
      indicatorMatches: matchedCustom,
      rationaleEn: `${chosenDir} confluence (${score}/100) via ${schoolNamesEn}${indNoteEn}`,
      rationaleAr: `توافق ${chosenDir === 'BUY' ? 'شراء' : 'بيع'} (${score}/100) عبر ${schoolNamesAr}${indNoteAr}`,
    });
  }

  const latestClose = visibleCandles[visibleCandles.length - 1]?.close;
  if (latestClose !== undefined) {
    for (const tr of setups) {
      if (tr.exitTime === undefined) {
        const isBuy = tr.direction === 'BUY';
        const risk = Math.max(info.pipSize, Math.abs(tr.entryPrice - tr.stopLoss));
        const rawDiff = isBuy ? latestClose - tr.entryPrice : tr.entryPrice - latestClose;
        tr.lastLivePrice = roundP(latestClose);
        tr.floatingPips = Number((rawDiff / info.pipSize).toFixed(1));
        tr.floatingPnlR = Number((rawDiff / risk).toFixed(2));
        tr.floatingPnlUsd = Math.round(tr.floatingPnlR * RISK_USD_PER_R * 100) / 100;
      }
    }
  }

  return setups.reverse(); // Newest discovered setups first
}

export function computeBacktestMetrics(setups: BacktestTrade[]): BacktestRunMetrics {
  const chronological = [...setups].sort((a, b) => a.entryTime - b.entryTime);
  const wonCount = chronological.filter((s) => s.status === 'Won').length;
  const lostCount = chronological.filter((s) => s.status === 'Lost').length;
  const breakevenCount = chronological.filter((s) => s.status === 'Breakeven').length;
  const activeCount = chronological.filter((s) => s.status === 'Active').length;
  const decisiveClosed = wonCount + lostCount;
  const winRatePct = decisiveClosed > 0 ? Math.round((wonCount / decisiveClosed) * 100) : 0;

  let netR = 0;
  let grossProfitR = 0;
  let grossLossR = 0;
  let equityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;

  for (const tr of chronological) {
    if (tr.status === 'Active' && tr.pnlR === 0) continue;
    netR += tr.pnlR;
    if (tr.pnlR >= 0) grossProfitR += tr.pnlR;
    else grossLossR += Math.abs(tr.pnlR);

    equityR += tr.pnlR;
    if (equityR > peakR) peakR = equityR;
    const dd = peakR - equityR;
    if (dd > maxDrawdownR) maxDrawdownR = dd;
  }

  const profitFactor =
    grossLossR > 0
      ? Number((grossProfitR / grossLossR).toFixed(2))
      : grossProfitR > 0
      ? 99.9
      : 0;

  return {
    totalSetups: setups.length,
    closedCount: wonCount + lostCount + breakevenCount,
    wonCount,
    lostCount,
    breakevenCount,
    activeCount,
    winRatePct,
    netR: Number(netR.toFixed(2)),
    netPnlUsd: Math.round(netR * RISK_USD_PER_R * 100) / 100,
    profitFactor,
    maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownR.toFixed(2)), // 1R = 1% account risk
  };
}
