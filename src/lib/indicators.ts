import type {
  AISignal,
  Candle,
  ChartOverlaysBundle,
  CustomIndicator,
  MtfSnapshotItem,
  OverlayLine,
  OverlayMarker,
  OverlaySeries,
  OverlaySeriesPoint,
  OverlayZone,
  PatternTwinMatch,
  SchoolId,
  Timeframe,
  TradeLevelLines,
  VolumeProfileLevel,
} from '../types/trading.ts';
import { SCHOOL_MAP, SYMBOL_MAP, TIMEFRAMES } from './schools.ts';

export function getTimeframeSeconds(tf: Timeframe): number {
  return TIMEFRAMES.find((t) => t.id === tf)?.seconds ?? 900;
}

export function calcSMA(candles: Candle[], period: number): OverlaySeriesPoint[] {
  const out: OverlaySeriesPoint[] = [];
  if (candles.length < period || period < 1) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      out.push({ time: candles[i].time, value: sum / period });
    }
  }
  return out;
}

export function calcEMA(candles: Candle[], period: number): OverlaySeriesPoint[] {
  const out: OverlaySeriesPoint[] = [];
  if (candles.length < period || period < 1) return out;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += candles[i].close;
  ema /= period;
  out.push({ time: candles[period - 1].time, value: ema });
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    out.push({ time: candles[i].time, value: ema });
  }
  return out;
}

export function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return candles[0] ? Math.max(candles[0].high - candles[0].low, 0.0001) : 1;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
}

export function calcRSI(candles: Candle[], period = 14): OverlaySeriesPoint[] {
  const out: OverlaySeriesPoint[] = [];
  if (candles.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  out.push({ time: candles[period].time, value: 100 - 100 / (1 + rs0) });

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  return out;
}

export function calcMACD(candles: Candle[], fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = calcEMA(candles, fast);
  const emaSlow = calcEMA(candles, slow);
  const slowMap = new Map(emaSlow.map((p) => [p.time, p.value]));
  const macdLine: OverlaySeriesPoint[] = [];
  for (const p of emaFast) {
    const s = slowMap.get(p.time);
    if (s !== undefined) {
      macdLine.push({ time: p.time, value: p.value - s });
    }
  }
  const signalLine: OverlaySeriesPoint[] = [];
  if (macdLine.length >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    let ema = macdLine.slice(0, signalPeriod).reduce((a, b) => a + b.value, 0) / signalPeriod;
    signalLine.push({ time: macdLine[signalPeriod - 1].time, value: ema });
    for (let i = signalPeriod; i < macdLine.length; i++) {
      ema = macdLine[i].value * k + ema * (1 - k);
      signalLine.push({ time: macdLine[i].time, value: ema });
    }
  }
  return { macdLine, signalLine };
}

export function calcVolumeProfile(candles: Candle[], bins = 24): VolumeProfileLevel[] {
  if (candles.length < 5) return [];
  const slice = candles.slice(-140);
  let minP = Infinity;
  let maxP = -Infinity;
  for (const c of slice) {
    if (c.low < minP) minP = c.low;
    if (c.high > maxP) maxP = c.high;
  }
  const span = maxP - minP;
  if (span <= 0 || !Number.isFinite(span)) return [];
  const step = span / bins;
  const buckets = new Array(bins).fill(0);

  for (const c of slice) {
    const mid = (c.high + c.low + c.close) / 3;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((mid - minP) / step)));
    buckets[idx] += Math.max(1, c.volume);
  }

  let pocIdx = 0;
  let totalVol = 0;
  for (let i = 0; i < bins; i++) {
    totalVol += buckets[i];
    if (buckets[i] > buckets[pocIdx]) pocIdx = i;
  }

  // Value area = 70% around POC
  let vaVol = buckets[pocIdx];
  let lo = pocIdx;
  let hi = pocIdx;
  const target = totalVol * 0.7;
  while (vaVol < target && (lo > 0 || hi < bins - 1)) {
    const leftVol = lo > 0 ? buckets[lo - 1] : -1;
    const rightVol = hi < bins - 1 ? buckets[hi + 1] : -1;
    if (rightVol >= leftVol && hi < bins - 1) {
      hi++;
      vaVol += buckets[hi];
    } else if (lo > 0) {
      lo--;
      vaVol += buckets[lo];
    } else {
      break;
    }
  }

  return buckets.map((vol, i) => ({
    price: minP + (i + 0.5) * step,
    volume: vol,
    isPoc: i === pocIdx,
    inValueArea: i >= lo && i <= hi,
  }));
}

export function findSwings(candles: Candle[], lookback = 3) {
  const highs: { index: number; time: number; price: number }[] = [];
  const lows: { index: number; time: number; price: number }[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isH = true;
    let isL = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isH = false;
      if (candles[j].low <= c.low) isL = false;
    }
    if (isH) highs.push({ index: i, time: c.time, price: c.high });
    if (isL) lows.push({ index: i, time: c.time, price: c.low });
  }
  return { highs, lows };
}

/**
 * Strict Overlay Sanity Check:
 * Verifies exact candle timestamp alignment & price bounds before drawing any AI overlay.
 * Rejects floating, malformed, NaN, or misaligned coordinates.
 */
export function validateAndSanitizeOverlays(
  candles: Candle[],
  timeframe: Timeframe,
  raw: Omit<ChartOverlaysBundle, 'sanityCheckedCount' | 'rejectedOverlayCount'>
): ChartOverlaysBundle {
  if (candles.length === 0) {
    return {
      zones: [],
      lines: [],
      markers: [],
      series: [],
      volumeProfile: [],
      tradeLevels: null,
      sanityCheckedCount: 0,
      rejectedOverlayCount: 0,
    };
  }

  const tfSec = getTimeframeSeconds(timeframe);
  const firstTime = candles[0].time;
  const lastTime = candles[candles.length - 1].time;
  const maxFutureTime = lastTime + tfSec * 24;

  let minP = Infinity;
  let maxP = -Infinity;
  for (const c of candles) {
    if (c.low < minP) minP = c.low;
    if (c.high > maxP) maxP = c.high;
  }
  const atr = calcATR(candles, 14);
  const lowBound = minP - atr * 12;
  const highBound = maxP + atr * 12;

  const validPrice = (p: number) => Number.isFinite(p) && p > 0 && p >= lowBound && p <= highBound;
  const validTime = (t: number) => Number.isFinite(t) && t >= firstTime - tfSec * 2 && t <= maxFutureTime;

  let checked = 0;
  let rejected = 0;

  const zones = raw.zones.filter((z) => {
    checked++;
    const ok =
      validTime(z.startTime) &&
      validTime(z.endTime) &&
      z.endTime >= z.startTime &&
      validPrice(z.topPrice) &&
      validPrice(z.bottomPrice) &&
      z.topPrice > z.bottomPrice;
    if (!ok) rejected++;
    return ok;
  });

  const lines = raw.lines.filter((l) => {
    checked++;
    const ok =
      l.points.length >= 2 &&
      l.points.every((pt) => validTime(pt.time) && validPrice(pt.price));
    if (!ok) rejected++;
    return ok;
  });

  const markers = raw.markers.filter((m) => {
    checked++;
    const ok = validTime(m.time) && validPrice(m.price);
    if (!ok) rejected++;
    return ok;
  });

  const series = raw.series.map((s) => ({
    ...s,
    data: s.data.filter((pt) => {
      checked++;
      const ok = validTime(pt.time) && (s.pane === 'oscillator' ? Number.isFinite(pt.value) : validPrice(pt.value));
      if (!ok) rejected++;
      return ok;
    }),
  }));

  let tradeLevels = raw.tradeLevels;
  if (tradeLevels) {
    checked++;
    const ok =
      validPrice(tradeLevels.entry) &&
      validPrice(tradeLevels.sl) &&
      validPrice(tradeLevels.tp1) &&
      validPrice(tradeLevels.tp2) &&
      validPrice(tradeLevels.tp3);
    if (!ok) {
      rejected++;
      tradeLevels = null;
    }
  }

  return {
    zones,
    lines,
    markers,
    series,
    volumeProfile: raw.volumeProfile,
    tradeLevels,
    sanityCheckedCount: checked,
    rejectedOverlayCount: rejected,
  };
}

export function getTimeframeMaxSlCap(
  symbol: string,
  timeframe: Timeframe,
  entryPrice: number,
  atr: number
): { minSlDist: number; maxSlCap: number } {
  const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
  const tfAtrMult =
    timeframe === '1m'
      ? 1.35
      : timeframe === '5m'
        ? 1.55
        : timeframe === '15m'
          ? 1.75
          : timeframe === '30m'
            ? 1.95
            : timeframe === '1h'
              ? 2.2
              : 2.5;
  const tfPctCap =
    timeframe === '1m'
      ? 0.0018
      : timeframe === '5m'
        ? 0.0028
        : timeframe === '15m'
          ? 0.0042
          : timeframe === '30m'
            ? 0.0058
            : timeframe === '1h'
              ? 0.0085
              : 0.015;
  const minSlDist = Math.max(info.pipSize * (timeframe === '1m' ? 4 : timeframe === '5m' ? 6 : 8), atr * 0.65);
  const priceCap = Math.max(minSlDist * 1.4, entryPrice * tfPctCap);
  const maxSlCap = Math.max(minSlDist * 1.25, Math.min(atr * tfAtrMult, priceCap));
  return { minSlDist, maxSlCap };
}

export interface AntiLateEntryResult {
  blocked: boolean;
  reason: string;
  nearestRetestPrice: number | null;
  rsi: number;
}

/**
 * Anti-Late-Entry & No-Chase Guard (منع الدخول المتأخر):
 * Blocks immediate entries after an extended impulse when price is far from optimal
 * retest zones (FVG, Order Block / Demand-Supply, POC, or CRT 50% EQ) OR when RSI(14)
 * is overextended (>70 for BUY / <30 for SELL) without a prior controlled pullback.
 */
export function evaluateAntiLateEntry(
  candles: Candle[],
  direction: 'BUY' | 'SELL',
  atrInput?: number,
  eq50?: number
): AntiLateEntryResult {
  if (candles.length < 22) {
    return { blocked: false, reason: 'Insufficient history', nearestRetestPrice: null, rsi: 50 };
  }
  const atr = atrInput && atrInput > 0 ? atrInput : calcATR(candles, 14);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const ema8 = calcEMA(candles, 8);
  const lastFast = ema8[ema8.length - 1]?.value ?? last.close;
  const rsiArr = calcRSI(candles, 14);
  const rsi = rsiArr[rsiArr.length - 1]?.value ?? 50;
  const prevRsi = rsiArr[rsiArr.length - 2]?.value ?? rsi;

  // Check if there was a recent pullback in the last 3 bars (so we don't block valid retest continuations)
  const recentPullback =
    direction === 'BUY'
      ? candles.slice(-4, -1).some((c) => c.close < c.open || c.low <= lastFast + atr * 0.25)
      : candles.slice(-4, -1).some((c) => c.close > c.open || c.high >= lastFast - atr * 0.25);

  if (direction === 'BUY' && rsi > 70 && (!recentPullback || prevRsi > 70)) {
    return {
      blocked: true,
      reason: `RSI(14) overbought at ${rsi.toFixed(1)} (>70) without fresh pullback; waiting for controlled retest.`,
      nearestRetestPrice: lastFast,
      rsi,
    };
  }
  if (direction === 'SELL' && rsi < 30 && (!recentPullback || prevRsi < 30)) {
    return {
      blocked: true,
      reason: `RSI(14) oversold at ${rsi.toFixed(1)} (<30) without fresh pullback; waiting for controlled retest.`,
      nearestRetestPrice: lastFast,
      rsi,
    };
  }

  // Gather active retest anchor prices: FVG midpoints, Order Block / S&D origins, Volume Profile POC, CRT 50% EQ
  const zoneCandidates: number[] = [];
  if (eq50 && Number.isFinite(eq50)) zoneCandidates.push(eq50);

  const vp = calcVolumeProfile(candles, 20);
  const poc = vp.find((v) => v.isPoc);
  if (poc) zoneCandidates.push(poc.price);

  const scanStart = Math.max(2, candles.length - 36);
  for (let i = scanStart; i < candles.length - 1; i++) {
    const c1 = candles[i - 2];
    const base = candles[i - 1];
    const c3 = candles[i];
    if (direction === 'BUY') {
      if (c3.low > c1.high + atr * 0.1) zoneCandidates.push((c3.low + c1.high) / 2); // Bullish FVG
      if (c3.close - c3.open > atr * 1.0) zoneCandidates.push(Math.max(base.open, base.close)); // Bullish OB / Demand
    } else {
      if (c3.high < c1.low - atr * 0.1) zoneCandidates.push((c1.low + c3.high) / 2); // Bearish FVG
      if (c3.open - c3.close > atr * 1.0) zoneCandidates.push(Math.min(base.open, base.close)); // Bearish OB / Supply
    }
  }

  let nearestZone: number | null = null;
  let minZoneDist = Infinity;
  for (const zp of zoneCandidates) {
    const d = Math.abs(last.close - zp);
    if (d < minZoneDist) {
      minZoneDist = d;
      nearestZone = zp;
    }
  }

  const distFromEma = Math.abs(last.close - lastFast);
  const sixBarLow = Math.min(...candles.slice(Math.max(0, candles.length - 6)).map((c) => c.low));
  const sixBarHigh = Math.max(...candles.slice(Math.max(0, candles.length - 6)).map((c) => c.high));
  const chasingExtreme =
    (direction === 'BUY' && (last.close > prev.high || distFromEma > atr * 1.75) && (last.close - sixBarLow) > atr * 2.45) ||
    (direction === 'SELL' && (last.close < prev.low || distFromEma > atr * 1.75) && (sixBarHigh - last.close) > atr * 2.45);

  if (chasingExtreme && distFromEma > atr * 1.4 && (nearestZone === null || minZoneDist > atr * 1.3)) {
    return {
      blocked: true,
      reason: `Extended ${direction} impulse (>1.4x ATR from EMA8 & >1.3x ATR from FVG/OB/POC/EQ); awaiting pullback.`,
      nearestRetestPrice: nearestZone ?? lastFast,
      rsi,
    };
  }

  return { blocked: false, reason: 'Within valid pullback/retest zone', nearestRetestPrice: nearestZone ?? lastFast, rsi };
}

export interface AntiCounterTrendResult {
  blocked: boolean;
  reason: string;
}

/**
 * Anti-Counter-Trend & Zone-Touch Guard:
 * Prevents SELL trades against strong bullish impulses or just on touching CRT Range High / Supply
 * without a closed-candle bearish CHoCH/MSB; and prevents BUY trades against strong bearish impulses
 * or directly into HTF resistance without confirmed bullish structural reversal (CHoCH/MSB).
 */
export function evaluateAntiCounterTrendGuard(
  execCandles: Candle[],
  htfCandles: Candle[],
  direction: 'BUY' | 'SELL',
  atrExec: number,
  crt?: CRTSetupResult | null
): AntiCounterTrendResult {
  if (execCandles.length < 18) {
    return { blocked: false, reason: 'Insufficient candles' };
  }
  const atr = atrExec > 0 ? atrExec : calcATR(execCandles, 14);
  const last = execCandles[execCandles.length - 1];
  const prev = execCandles[execCandles.length - 2];
  const ema8 = calcEMA(execCandles, 8);
  const ema21 = calcEMA(execCandles, 21);
  const fast = ema8[ema8.length - 1]?.value ?? last.close;
  const slow = ema21[ema21.length - 1]?.value ?? last.close;

  const recent4 = execCandles.slice(-4);
  const netMove4 = last.close - recent4[0].open;
  const swings = findSwings(execCandles.slice(0, -1), 2);
  const latestSwingHigh = swings.highs[swings.highs.length - 1]?.price ?? Math.max(...execCandles.slice(-10, -1).map((c) => c.high));
  const latestSwingLow = swings.lows[swings.lows.length - 1]?.price ?? Math.min(...execCandles.slice(-10, -1).map((c) => c.low));

  // HTF impulse & opposing resistance/support check
  let htfBullImpulse = false;
  let htfBearImpulse = false;
  let htfNearResistance = false;
  let htfNearSupport = false;
  if (htfCandles.length >= 22) {
    const htfAtr = calcATR(htfCandles, 14);
    const htfEma8 = calcEMA(htfCandles, 8);
    const htfEma21 = calcEMA(htfCandles, 21);
    const hf = htfEma8[htfEma8.length - 1]?.value ?? htfCandles[htfCandles.length - 1].close;
    const hs = htfEma21[htfEma21.length - 1]?.value ?? htfCandles[htfCandles.length - 1].close;
    const htfLast = htfCandles[htfCandles.length - 1];
    htfBullImpulse = hf > hs && htfLast.close > htfLast.open && (htfLast.close - htfLast.open) > htfAtr * 0.45;
    htfBearImpulse = hf < hs && htfLast.close < htfLast.open && (htfLast.open - htfLast.close) > htfAtr * 0.45;

    const htfSwings = findSwings(htfCandles, 3);
    htfNearResistance = htfSwings.highs.some((h) => h.price > last.close && h.price - last.close < htfAtr * 0.65);
    htfNearSupport = htfSwings.lows.some((l) => l.price < last.close && last.close - l.price < htfAtr * 0.65);
  }

  if (direction === 'SELL') {
    const strongBullImpulse = (fast > slow && netMove4 > atr * 1.25) || htfBullImpulse;
    const bearishChochMsb =
      last.close < last.open &&
      (last.close < latestSwingLow || (last.close < prev.low && (prev.open - last.close) > atr * 0.45));
    const crtTouchOnly =
      crt &&
      last.high >= crt.crtHigh - atr * 0.35 &&
      !bearishChochMsb &&
      crt.direction !== 'SELL';

    if (crtTouchOnly) {
      return {
        blocked: true,
        reason: `Blocked SELL on CRT Range High / Supply touch (${crt.crtHigh}) without closed-candle bearish CHoCH/MSB.`,
      };
    }
    if (strongBullImpulse && !bearishChochMsb) {
      return {
        blocked: true,
        reason: 'Blocked counter-trend SELL against strong bullish impulse without closed-candle CHoCH/MSB.',
      };
    }
    if (htfNearSupport && !bearishChochMsb) {
      return {
        blocked: true,
        reason: 'Blocked SELL directly into HTF Demand/Support without confirmed bearish break of structure.',
      };
    }
  } else {
    const strongBearImpulse = (fast < slow && netMove4 < -atr * 1.25) || htfBearImpulse;
    const bullishChochMsb =
      last.close > last.open &&
      (last.close > latestSwingHigh || (last.close > prev.high && (last.close - prev.open) > atr * 0.45));
    const crtTouchOnly =
      crt &&
      last.low <= crt.crtLow + atr * 0.35 &&
      !bullishChochMsb &&
      crt.direction !== 'BUY';

    if (crtTouchOnly) {
      return {
        blocked: true,
        reason: `Blocked BUY on CRT Range Low / Demand touch (${crt.crtLow}) without closed-candle bullish CHoCH/MSB.`,
      };
    }
    if (strongBearImpulse && !bullishChochMsb) {
      return {
        blocked: true,
        reason: 'Blocked counter-trend BUY against strong bearish impulse without closed-candle CHoCH/MSB.',
      };
    }
    if (htfNearResistance && !bullishChochMsb) {
      return {
        blocked: true,
        reason: 'Blocked BUY directly into opposing HTF Resistance/Liquidity without confirmed bullish CHoCH/MSB.',
      };
    }
  }

  return { blocked: false, reason: 'Structure & MTF alignment verified' };
}

export interface CRTSetupResult {
  direction: 'BUY' | 'SELL' | null;
  crtHigh: number;
  crtLow: number;
  eq50: number;
  sweepTime: number | null;
  sweepPrice: number | null;
  displacementConfirmed: boolean;
  suggestedSl: number;
  suggestedTp1: number;
  suggestedTp2: number;
  suggestedTp3: number;
  reason: string;
}

/**
 * Active Candle Range Theory (CRT) Quantitative Engine (Strictly Causal on passed slice).
 * Evaluates prior CRT Range High/Low + 50% EQ, detects liquidity sweep/fakeout outside range,
 * confirms displacement + closed-candle CHoCH/BOS reclaim back inside the CRT range,
 * and computes CRT-derived SL & TP1(50% EQ) / TP2(Opposite Range) / TP3(Expansion).
 */
export function evaluateCRTSetup(candles: Candle[], atrInput?: number, decimals = 2): CRTSetupResult {
  if (candles.length < 24) {
    const lastC = candles[candles.length - 1]?.close ?? 0;
    return {
      direction: null,
      crtHigh: lastC,
      crtLow: lastC,
      eq50: lastC,
      sweepTime: null,
      sweepPrice: null,
      displacementConfirmed: false,
      suggestedSl: lastC,
      suggestedTp1: lastC,
      suggestedTp2: lastC,
      suggestedTp3: lastC,
      reason: 'Insufficient candles for CRT range',
    };
  }

  const atr = atrInput && atrInput > 0 ? atrInput : calcATR(candles, 14);
  const roundP = (v: number) => Number(v.toFixed(decimals));

  // Reference CRT macro candle range block formed BEFORE the recent 5 execution candles
  const rangeLookback = Math.min(32, candles.length - 6);
  const rangeSlice = candles.slice(candles.length - 5 - rangeLookback, candles.length - 5);
  const execSlice = candles.slice(-5);
  const last = execSlice[execSlice.length - 1];
  const prev = execSlice[execSlice.length - 2];

  const crtHigh = Math.max(...rangeSlice.map((c) => c.high));
  const crtLow = Math.min(...rangeSlice.map((c) => c.low));
  const crtSpan = Math.max(atr * 0.8, crtHigh - crtLow);
  const eq50 = (crtHigh + crtLow) / 2;

  // Check bullish CRT: sweep below CRT Range Low + closed reclaim inside range + displacement
  let bullSweepBar: Candle | null = null;
  let lowestSweep = crtLow;
  for (let i = 0; i < execSlice.length - 1; i++) {
    const c = execSlice[i];
    if (c.low < crtLow) {
      if (!bullSweepBar || c.low < lowestSweep) {
        bullSweepBar = c;
        lowestSweep = c.low;
      }
    }
  }
  const bullReclaimClosed =
    bullSweepBar !== null &&
    last.close > crtLow &&
    last.close > last.open &&
    last.close > Math.max(prev.open, prev.close) * 0.9999;
  const bullDirectTurtleSoup =
    last.low < crtLow &&
    last.close > crtLow &&
    last.close > last.open &&
    (last.close - last.open) > atr * 0.35;

  // Check bearish CRT: sweep above CRT Range High + closed reclaim inside range + displacement
  let bearSweepBar: Candle | null = null;
  let highestSweep = crtHigh;
  for (let i = 0; i < execSlice.length - 1; i++) {
    const c = execSlice[i];
    if (c.high > crtHigh) {
      if (!bearSweepBar || c.high > highestSweep) {
        bearSweepBar = c;
        highestSweep = c.high;
      }
    }
  }
  const bearReclaimClosed =
    bearSweepBar !== null &&
    last.close < crtHigh &&
    last.close < last.open &&
    last.close < Math.min(prev.open, prev.close) * 1.0001;
  const bearDirectTurtleSoup =
    last.high > crtHigh &&
    last.close < crtHigh &&
    last.close < last.open &&
    (last.open - last.close) > atr * 0.35;

  if (bullReclaimClosed || bullDirectTurtleSoup) {
    const sweepC = bullSweepBar || last;
    const sweepExtreme = Math.min(lowestSweep, last.low);
    const sl = roundP(sweepExtreme - atr * 0.35);
    const risk = Math.max(atr * 0.6, last.close - sl);
    const tp1 = roundP(Math.max(eq50, last.close + risk * 1.05));
    const tp2 = roundP(Math.max(crtHigh, tp1 + risk * 0.9));
    const tp3 = roundP(Math.max(crtHigh + crtSpan * 0.382, tp2 + risk * 1.05));
    return {
      direction: 'BUY',
      crtHigh: roundP(crtHigh),
      crtLow: roundP(crtLow),
      eq50: roundP(eq50),
      sweepTime: sweepC.time,
      sweepPrice: roundP(sweepExtreme),
      displacementConfirmed: (last.close - last.open) > atr * 0.35,
      suggestedSl: sl,
      suggestedTp1: tp1,
      suggestedTp2: tp2,
      suggestedTp3: tp3,
      reason: `Bullish CRT sweep below ${roundP(crtLow)} & closed reclaim targeting 50% EQ (${roundP(eq50)}) -> CRT High (${roundP(crtHigh)})`,
    };
  }

  if (bearReclaimClosed || bearDirectTurtleSoup) {
    const sweepC = bearSweepBar || last;
    const sweepExtreme = Math.max(highestSweep, last.high);
    const sl = roundP(sweepExtreme + atr * 0.35);
    const risk = Math.max(atr * 0.6, sl - last.close);
    const tp1 = roundP(Math.min(eq50, last.close - risk * 1.05));
    const tp2 = roundP(Math.min(crtLow, tp1 - risk * 0.9));
    const tp3 = roundP(Math.min(crtLow - crtSpan * 0.382, tp2 - risk * 1.05));
    return {
      direction: 'SELL',
      crtHigh: roundP(crtHigh),
      crtLow: roundP(crtLow),
      eq50: roundP(eq50),
      sweepTime: sweepC.time,
      sweepPrice: roundP(sweepExtreme),
      displacementConfirmed: (last.open - last.close) > atr * 0.35,
      suggestedSl: sl,
      suggestedTp1: tp1,
      suggestedTp2: tp2,
      suggestedTp3: tp3,
      reason: `Bearish CRT sweep above ${roundP(crtHigh)} & closed reclaim targeting 50% EQ (${roundP(eq50)}) -> CRT Low (${roundP(crtLow)})`,
    };
  }

  return {
    direction: null,
    crtHigh: roundP(crtHigh),
    crtLow: roundP(crtLow),
    eq50: roundP(eq50),
    sweepTime: null,
    sweepPrice: null,
    displacementConfirmed: false,
    suggestedSl: roundP(last.close),
    suggestedTp1: roundP(eq50),
    suggestedTp2: roundP(last.close >= eq50 ? crtLow : crtHigh),
    suggestedTp3: roundP(last.close >= eq50 ? crtLow - crtSpan * 0.35 : crtHigh + crtSpan * 0.35),
    reason: 'Price inside CRT range equilibrium without sweep trigger',
  };
}

export function buildSchoolOverlays(
  candles: Candle[],
  timeframe: Timeframe,
  activeSchools: SchoolId[],
  activeSignal: AISignal | null,
  showTradeLines = true
): ChartOverlaysBundle {
  if (candles.length < 20) {
    return validateAndSanitizeOverlays(candles, timeframe, {
      zones: [],
      lines: [],
      markers: [],
      series: [],
      volumeProfile: [],
      tradeLevels: null,
    });
  }

  const tfSec = getTimeframeSeconds(timeframe);
  const last = candles[candles.length - 1];
  const atr = calcATR(candles, 14);
  const { highs, lows } = findSwings(candles, 3);
  const schoolSet = new Set(activeSchools);

  const zones: OverlayZone[] = [];
  const lines: OverlayLine[] = [];
  const markers: OverlayMarker[] = [];
  const series: OverlaySeries[] = [];
  let volumeProfile: VolumeProfileLevel[] = [];

  const recentEnd = last.time + tfSec * 8;

  // 1. Classical Technical Analysis (S/R levels + Trendlines)
  if (schoolSet.has('classical')) {
    const lastH = highs[highs.length - 1];
    const prevH = highs[highs.length - 2];
    const lastL = lows[lows.length - 1];
    const prevL = lows[lows.length - 2];
    if (lastH) {
      lines.push({
        id: 'cl-res',
        school: 'classical',
        label: 'Classical Resistance',
        points: [{ time: lastH.time, price: lastH.price }, { time: recentEnd, price: lastH.price }],
        color: SCHOOL_MAP.classical.color,
        lineWidth: 1.5,
        dashed: true,
      });
    }
    if (lastL) {
      lines.push({
        id: 'cl-sup',
        school: 'classical',
        label: 'Classical Support',
        points: [{ time: lastL.time, price: lastL.price }, { time: recentEnd, price: lastL.price }],
        color: SCHOOL_MAP.classical.color,
        lineWidth: 1.5,
        dashed: true,
      });
    }
    if (prevL && lastL && lastL.time > prevL.time) {
      lines.push({
        id: 'cl-tl-up',
        school: 'classical',
        label: 'Trendline',
        points: [{ time: prevL.time, price: prevL.price }, { time: lastL.time, price: lastL.price }],
        color: '#374151',
        lineWidth: 1.5,
        extendRight: true,
      });
    } else if (prevH && lastH && lastH.time > prevH.time) {
      lines.push({
        id: 'cl-tl-dn',
        school: 'classical',
        label: 'Trendline',
        points: [{ time: prevH.time, price: prevH.price }, { time: lastH.time, price: lastH.price }],
        color: '#374151',
        lineWidth: 1.5,
        extendRight: true,
      });
    }
  }

  // 2. Price Action (Engulfing, Pin bars, Displacement) — spaced >= 5 bars apart to prevent clutter
  if (schoolSet.has('price_action')) {
    const startIdx = Math.max(2, candles.length - 45);
    let lastPaIdx = -10;
    for (let i = startIdx; i < candles.length - 1; i++) {
      if (i - lastPaIdx < 5) continue;
      const c = candles[i];
      const prev = candles[i - 1];
      const body = Math.abs(c.close - c.open);
      const range = Math.max(0.00001, c.high - c.low);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);

      if (lowerWick > body * 2.1 && lowerWick > range * 0.55) {
        markers.push({
          id: `pa-pin-bull-${i}`,
          school: 'price_action',
          time: c.time,
          price: c.low,
          label: 'Pin',
          position: 'below',
          color: '#059669',
          shape: 'arrowUp',
        });
        lastPaIdx = i;
      } else if (upperWick > body * 2.1 && upperWick > range * 0.55) {
        markers.push({
          id: `pa-pin-bear-${i}`,
          school: 'price_action',
          time: c.time,
          price: c.high,
          label: 'Pin',
          position: 'above',
          color: '#DC2626',
          shape: 'arrowDown',
        });
        lastPaIdx = i;
      } else if (c.close > c.open && prev.close < prev.open && c.close > prev.open && c.open <= prev.close && body > atr * 0.75) {
        markers.push({
          id: `pa-eng-bull-${i}`,
          school: 'price_action',
          time: c.time,
          price: c.low,
          label: 'Engulf',
          position: 'below',
          color: '#0F766E',
          shape: 'arrowUp',
        });
        lastPaIdx = i;
      }
    }
  }

  // 3. Supply & Demand Zones (deduplicate overlapping zones)
  const overlapsExistingZone = (top: number, bot: number) =>
    zones.some((z) => {
      const ov = Math.min(top, z.topPrice) - Math.max(bot, z.bottomPrice);
      const minH = Math.max(0.00001, Math.min(top - bot, z.topPrice - z.bottomPrice));
      return ov > minH * 0.45;
    });

  if (schoolSet.has('supply_demand')) {
    const startIdx = Math.max(2, candles.length - 70);
    let demandFound = 0;
    let supplyFound = 0;
    for (let i = candles.length - 3; i >= startIdx; i--) {
      const base = candles[i - 1];
      const imp = candles[i];
      const impBody = imp.close - imp.open;
      if (impBody > atr * 1.15 && demandFound < 2) {
        const top = Math.max(base.open, base.close);
        const bot = base.low;
        if (!overlapsExistingZone(top, bot)) {
          zones.push({
            id: `sd-dem-${i}`,
            school: 'supply_demand',
            label: 'Demand Zone',
            startTime: base.time,
            endTime: recentEnd,
            topPrice: top,
            bottomPrice: bot,
            color: '#059669',
            fillAlpha: 0.12,
          });
          demandFound++;
        }
      } else if (impBody < -atr * 1.15 && supplyFound < 2) {
        const top = base.high;
        const bot = Math.min(base.open, base.close);
        if (!overlapsExistingZone(top, bot)) {
          zones.push({
            id: `sd-sup-${i}`,
            school: 'supply_demand',
            label: 'Supply Zone',
            startTime: base.time,
            endTime: recentEnd,
            topPrice: top,
            bottomPrice: bot,
            color: '#DC2626',
            fillAlpha: 0.12,
          });
          supplyFound++;
        }
      }
    }
  }

  // 4. Candle Range Theory (CRT)
  if (schoolSet.has('crt')) {
    const crtEval = evaluateCRTSetup(candles, atr, 4);
    const rangeSlice = candles.slice(-36, -5);
    if (rangeSlice.length > 5) {
      const startT = rangeSlice[0].time;
      lines.push(
        {
          id: 'crt-h',
          school: 'crt',
          label: 'CRT Range High',
          points: [{ time: startT, price: crtEval.crtHigh }, { time: recentEnd, price: crtEval.crtHigh }],
          color: '#7C3AED',
          lineWidth: 1.5,
          dashed: true,
        },
        {
          id: 'crt-eq',
          school: 'crt',
          label: 'CRT 50% EQ',
          points: [{ time: startT, price: crtEval.eq50 }, { time: recentEnd, price: crtEval.eq50 }],
          color: '#7C3AED',
          lineWidth: 1,
          dashed: true,
        },
        {
          id: 'crt-l',
          school: 'crt',
          label: 'CRT Range Low',
          points: [{ time: startT, price: crtEval.crtLow }, { time: recentEnd, price: crtEval.crtLow }],
          color: '#7C3AED',
          lineWidth: 1.5,
          dashed: true,
        }
      );
      if (crtEval.direction && crtEval.sweepTime && crtEval.sweepPrice) {
        markers.push({
          id: `crt-sweep-${crtEval.direction}`,
          school: 'crt',
          time: crtEval.sweepTime,
          price: crtEval.sweepPrice,
          label: crtEval.direction === 'BUY' ? 'CRT Sweep + Reclaim ↑' : 'CRT Sweep + Reclaim ↓',
          position: crtEval.direction === 'BUY' ? 'below' : 'above',
          color: '#7C3AED',
          shape: crtEval.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
        });
      }
    }
  }

  // 5. Smart Money Concepts (SMC): BOS, CHoCH, Order Blocks, FVG (capped & decluttered)
  if (schoolSet.has('smc')) {
    let fvgCount = 0;
    for (let i = candles.length - 2; i >= Math.max(2, candles.length - 50) && fvgCount < 3; i--) {
      const c1 = candles[i - 2];
      const c3 = candles[i];
      if (c3.low > c1.high + atr * 0.18 && !overlapsExistingZone(c3.low, c1.high)) {
        zones.push({
          id: `smc-fvg-bull-${i}`,
          school: 'smc',
          label: 'Bullish FVG',
          startTime: c1.time,
          endTime: recentEnd,
          topPrice: c3.low,
          bottomPrice: c1.high,
          color: '#059669',
          fillAlpha: 0.14,
          dashed: true,
        });
        fvgCount++;
      } else if (c3.high < c1.low - atr * 0.18 && !overlapsExistingZone(c1.low, c3.high)) {
        zones.push({
          id: `smc-fvg-bear-${i}`,
          school: 'smc',
          label: 'Bearish FVG',
          startTime: c1.time,
          endTime: recentEnd,
          topPrice: c1.low,
          bottomPrice: c3.high,
          color: '#DC2626',
          fillAlpha: 0.14,
          dashed: true,
        });
        fvgCount++;
      }
    }
    const recentH = highs[highs.length - 1];
    const recentL = lows[lows.length - 1];
    if (recentH && last.close > recentH.price) {
      lines.push({
        id: 'smc-bos-up',
        school: 'smc',
        label: 'BOS ↑',
        points: [{ time: recentH.time, price: recentH.price }, { time: last.time, price: recentH.price }],
        color: '#059669',
        lineWidth: 1.5,
      });
    } else if (recentL && last.close < recentL.price) {
      lines.push({
        id: 'smc-bos-dn',
        school: 'smc',
        label: 'CHoCH / BOS ↓',
        points: [{ time: recentL.time, price: recentL.price }, { time: last.time, price: recentL.price }],
        color: '#DC2626',
        lineWidth: 1.5,
      });
    }
  }

  // 6. ICT: PDH/PDL/PrevClose + OTE 0.618-0.786 + Killzones
  if (schoolSet.has('ict')) {
    const prevWindow = candles.slice(-96, -24);
    if (prevWindow.length > 5) {
      const pdh = Math.max(...prevWindow.map((c) => c.high));
      const pdl = Math.min(...prevWindow.map((c) => c.low));
      const prevClose = prevWindow[prevWindow.length - 1].close;
      const startT = prevWindow[0].time;
      lines.push(
        {
          id: 'ict-pdh',
          school: 'ict',
          label: 'PDH',
          points: [{ time: startT, price: pdh }, { time: recentEnd, price: pdh }],
          color: '#DC2626',
          lineWidth: 1.2,
          dashed: true,
        },
        {
          id: 'ict-pdl',
          school: 'ict',
          label: 'PDL',
          points: [{ time: startT, price: pdl }, { time: recentEnd, price: pdl }],
          color: '#059669',
          lineWidth: 1.2,
          dashed: true,
        },
        {
          id: 'ict-prevc',
          school: 'ict',
          label: 'Prev Close',
          points: [{ time: startT, price: prevClose }, { time: recentEnd, price: prevClose }],
          color: '#6B7280',
          lineWidth: 1,
          dashed: true,
        }
      );
      // OTE zone
      const oteHigh = pdl + (pdh - pdl) * 0.382;
      const oteLow = pdl + (pdh - pdl) * 0.214;
      zones.push({
        id: 'ict-ote',
        school: 'ict',
        label: 'ICT OTE (0.618–0.786)',
        startTime: prevWindow[prevWindow.length - 1].time,
        endTime: recentEnd,
        topPrice: oteHigh,
        bottomPrice: oteLow,
        color: '#DC2626',
        fillAlpha: 0.08,
      });
    }
    // Killzone markers
    for (let i = Math.max(0, candles.length - 60); i < candles.length; i++) {
      const hr = new Date(candles[i].time * 1000).getUTCHours();
      if (hr === 7 || hr === 12) {
        markers.push({
          id: `ict-kz-${i}`,
          school: 'ict',
          time: candles[i].time,
          price: candles[i].high,
          label: hr === 7 ? 'LDN KZ' : 'NY KZ',
          position: 'above',
          color: '#DC2626',
          shape: 'label',
        });
      }
    }
  }

  // 7. Elliott Wave Theory (1-2-3-4-5 Impulse / ABC)
  if (schoolSet.has('elliott')) {
    const pivots = [...highs.map((h) => ({ ...h, type: 'H' })), ...lows.map((l) => ({ ...l, type: 'L' }))]
      .sort((a, b) => a.time - b.time)
      .slice(-6);
    if (pivots.length >= 4) {
      const labels = ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)'];
      lines.push({
        id: 'ew-wave',
        school: 'elliott',
        label: 'Elliott Wave Count',
        points: pivots.map((p) => ({ time: p.time, price: p.price })),
        color: '#2563EB',
        lineWidth: 1.8,
      });
      pivots.forEach((p, idx) => {
        markers.push({
          id: `ew-pt-${idx}`,
          school: 'elliott',
          time: p.time,
          price: p.price,
          label: labels[idx] || String(idx),
          position: p.type === 'H' ? 'above' : 'below',
          color: '#2563EB',
          shape: 'label',
        });
      });
    }
  }

  // 8. Harmonic Patterns (XABCD)
  if (schoolSet.has('harmonic')) {
    const pivots = [...highs, ...lows].sort((a, b) => a.time - b.time).slice(-5);
    if (pivots.length === 5) {
      lines.push({
        id: 'harm-xabcd',
        school: 'harmonic',
        label: 'Harmonic XABCD',
        points: pivots.map((p) => ({ time: p.time, price: p.price })),
        color: '#9333EA',
        lineWidth: 1.6,
        dashed: true,
      });
      const tags = ['X', 'A', 'B', 'C', 'D (PRZ)'];
      pivots.forEach((p, idx) => {
        markers.push({
          id: `harm-pt-${idx}`,
          school: 'harmonic',
          time: p.time,
          price: p.price,
          label: tags[idx],
          position: idx % 2 === 0 ? 'below' : 'above',
          color: '#9333EA',
          shape: 'label',
        });
      });
    }
  }

  // 9. Gann Theory (Angles & Square of 9)
  if (schoolSet.has('gann')) {
    const anchor = lows[lows.length - 1] || candles[Math.max(0, candles.length - 30)];
    if (anchor) {
      const barsForward = Math.max(10, Math.round((recentEnd - anchor.time) / tfSec));
      const slope1x1 = atr * 0.35;
      lines.push(
        {
          id: 'gann-1x1',
          school: 'gann',
          label: 'Gann 1x1',
          points: [
            { time: anchor.time, price: anchor.price },
            { time: recentEnd, price: anchor.price + slope1x1 * barsForward * 0.4 },
          ],
          color: '#B45309',
          lineWidth: 1.3,
        },
        {
          id: 'gann-2x1',
          school: 'gann',
          label: 'Gann 2x1',
          points: [
            { time: anchor.time, price: anchor.price },
            { time: recentEnd, price: anchor.price + slope1x1 * barsForward * 0.8 },
          ],
          color: '#D97706',
          lineWidth: 1,
          dashed: true,
        }
      );
      // Square of 9 key degree level
      const sqRoot = Math.sqrt(last.close);
      const sqUp = Math.pow(sqRoot + 0.125, 2);
      const sqDn = Math.pow(Math.max(0.1, sqRoot - 0.125), 2);
      if (sqUp < last.close + atr * 8) {
        lines.push({
          id: 'gann-sq9-up',
          school: 'gann',
          label: 'Sq9 +45°',
          points: [{ time: candles[Math.max(0, candles.length - 20)].time, price: sqUp }, { time: recentEnd, price: sqUp }],
          color: '#B45309',
          lineWidth: 1,
          dashed: true,
        });
      }
      if (sqDn > last.close - atr * 8) {
        lines.push({
          id: 'gann-sq9-dn',
          school: 'gann',
          label: 'Sq9 -45°',
          points: [{ time: candles[Math.max(0, candles.length - 20)].time, price: sqDn }, { time: recentEnd, price: sqDn }],
          color: '#B45309',
          lineWidth: 1,
          dashed: true,
        });
      }
    }
  }

  // 10. Financial Astrology (Lunar Cycle Turning Windows)
  if (schoolSet.has('astrology')) {
    const synodicMonth = 29.530588 * 86400;
    const knownNewMoon = 1704974220; // Jan 11 2024 UTC
    for (let i = Math.max(0, candles.length - 80); i < candles.length; i += 12) {
      const phase = ((candles[i].time - knownNewMoon) % synodicMonth) / synodicMonth;
      const normPhase = phase < 0 ? phase + 1 : phase;
      if (normPhase < 0.06 || Math.abs(normPhase - 0.5) < 0.06) {
        markers.push({
          id: `astro-lunar-${i}`,
          school: 'astrology',
          time: candles[i].time,
          price: candles[i].high,
          label: normPhase < 0.2 ? '● New Moon Window' : '○ Full Moon Window',
          position: 'above',
          color: '#6D28D9',
          shape: 'label',
        });
        break;
      }
    }
  }

  // 11. Technical Indicators (MA 5 / 10 / 50 + RSI / MACD)
  if (schoolSet.has('indicators')) {
    series.push(
      {
        id: 'ind-ma5',
        school: 'indicators',
        name: 'MA 5',
        color: '#0284C7',
        lineWidth: 1.2,
        pane: 'main',
        data: calcEMA(candles, 5),
      },
      {
        id: 'ind-ma10',
        school: 'indicators',
        name: 'MA 10',
        color: '#D97706',
        lineWidth: 1.3,
        pane: 'main',
        data: calcEMA(candles, 10),
      },
      {
        id: 'ind-ma50',
        school: 'indicators',
        name: 'MA 50',
        color: '#111827',
        lineWidth: 1.6,
        pane: 'main',
        data: calcEMA(candles, 50),
      },
      {
        id: 'ind-rsi14',
        school: 'indicators',
        name: 'RSI (14)',
        color: '#0284C7',
        lineWidth: 1.4,
        pane: 'oscillator',
        data: calcRSI(candles, 14),
      }
    );
  }

  // 12. Wyckoff Method (Spring / UTAD / Trading Range)
  if (schoolSet.has('wyckoff')) {
    const trSlice = candles.slice(-50, -5);
    if (trSlice.length > 10) {
      const trHigh = Math.max(...trSlice.map((c) => c.high));
      const trLow = Math.min(...trSlice.map((c) => c.low));
      zones.push({
        id: 'wyck-tr',
        school: 'wyckoff',
        label: 'Wyckoff Accumulation/Dist TR',
        startTime: trSlice[0].time,
        endTime: recentEnd,
        topPrice: trHigh,
        bottomPrice: trLow,
        color: '#0D9488',
        fillAlpha: 0.05,
        dashed: true,
      });
      const lastFew = candles.slice(-6);
      const springBar = lastFew.find((c) => c.low < trLow && c.close > trLow);
      if (springBar) {
        markers.push({
          id: 'wyck-spring',
          school: 'wyckoff',
          time: springBar.time,
          price: springBar.low,
          label: 'Spring',
          position: 'below',
          color: '#0D9488',
          shape: 'arrowUp',
        });
      }
    }
  }

  // 13. Wolfe Waves (1-2-3-4-5 + EPA Target)
  if (schoolSet.has('wolfe')) {
    const pivots = [...highs, ...lows].sort((a, b) => a.time - b.time).slice(-5);
    if (pivots.length === 5) {
      lines.push({
        id: 'wolfe-14',
        school: 'wolfe',
        label: 'Wolfe EPA Line (1–4)',
        points: [
          { time: pivots[0].time, price: pivots[0].price },
          { time: pivots[3].time, price: pivots[3].price },
        ],
        color: '#E11D48',
        lineWidth: 1.4,
        extendRight: true,
      });
    }
  }

  // 14. Volume Spread Analysis (VSA) & Volume Profile POC/VAH/VAL
  if (schoolSet.has('vsa')) {
    volumeProfile = calcVolumeProfile(candles, 24);
    const poc = volumeProfile.find((v) => v.isPoc);
    if (poc) {
      lines.push({
        id: 'vsa-poc',
        school: 'vsa',
        label: 'POC',
        points: [{ time: candles[Math.max(0, candles.length - 80)].time, price: poc.price }, { time: recentEnd, price: poc.price }],
        color: '#DC2626',
        lineWidth: 1.5,
      });
    }
    // Stopping volume / absorption bar
    const avgVol = candles.slice(-30).reduce((a, b) => a + b.volume, 0) / 30;
    for (let i = Math.max(1, candles.length - 25); i < candles.length; i++) {
      const c = candles[i];
      const spread = c.high - c.low;
      if (c.volume > avgVol * 1.8 && spread < atr * 0.7) {
        markers.push({
          id: `vsa-abs-${i}`,
          school: 'vsa',
          time: c.time,
          price: c.close >= c.open ? c.low : c.high,
          label: 'Absorption',
          position: c.close >= c.open ? 'below' : 'above',
          color: '#374151',
          shape: 'circle',
        });
      }
    }
  }

  // 15 & 16. Fundamental & Psychology (Round number psychological liquidity levels)
  if (schoolSet.has('psychology') || schoolSet.has('fundamental')) {
    const step = last.close > 10000 ? 500 : last.close > 500 ? 10 : last.close > 20 ? 1 : 0.005;
    const roundLevel = Math.round(last.close / step) * step;
    lines.push({
      id: 'psych-round',
      school: 'psychology',
      label: `Psych Level (${roundLevel})`,
      points: [{ time: candles[Math.max(0, candles.length - 30)].time, price: roundLevel }, { time: recentEnd, price: roundLevel }],
      color: '#D97706',
      lineWidth: 1,
      dashed: true,
    });
  }

  let tradeLevels: TradeLevelLines | null = null;
  if (showTradeLines && activeSignal && (activeSignal.status === 'Active' || activeSignal.status === 'Breakeven' || activeSignal.status === 'Watchlist')) {
    tradeLevels = {
      signalId: activeSignal.id,
      direction: activeSignal.direction,
      entry: activeSignal.entryPrice,
      optimalZoneHigh: activeSignal.optimalEntryZone[1],
      optimalZoneLow: activeSignal.optimalEntryZone[0],
      sl: activeSignal.currentSl,
      be: activeSignal.tp1Hit ? activeSignal.entryPrice : undefined,
      tp1: activeSignal.tp1,
      tp2: activeSignal.tp2,
      tp3: activeSignal.tp3,
      tp1Hit: activeSignal.tp1Hit,
      tp2Hit: activeSignal.tp2Hit,
      tp3Hit: activeSignal.tp3Hit,
      invalidation: activeSignal.hardInvalidation,
    };
  }

  return validateAndSanitizeOverlays(candles, timeframe, {
    zones,
    lines,
    markers,
    series,
    volumeProfile,
    tradeLevels,
  });
}

/**
 * Sandboxed Custom Indicator Evaluator (safe arithmetic + technical series, no eval/Function)
 */
export function evaluateCustomIndicator(candles: Candle[], ind: CustomIndicator): OverlaySeries[] {
  if (!ind.visible || candles.length < 10) return [];
  const getNum = (key: string, fallback: number) => {
    const found = ind.inputs.find((i) => i.key === key);
    const n = Number(found?.value ?? found?.defaultValue ?? fallback);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const out: OverlaySeries[] = [];
  const bp = ind.blueprint;

  if (bp.kind === 'ma_crossover') {
    const fast = getNum('fast', 9);
    const slow = getNum('slow', 21);
    out.push(
      {
        id: `${ind.id}-fast`,
        school: 'custom',
        name: `${ind.name} (${fast})`,
        color: ind.color,
        lineWidth: ind.lineWidth,
        dashed: ind.lineStyle !== 'solid',
        pane: 'main',
        data: calcEMA(candles, fast),
      },
      {
        id: `${ind.id}-slow`,
        school: 'custom',
        name: `${ind.name} (${slow})`,
        color: ind.secondaryColor || '#DC2626',
        lineWidth: ind.lineWidth,
        dashed: true,
        pane: 'main',
        data: calcEMA(candles, slow),
      }
    );
  } else if (bp.kind === 'rsi_bands') {
    const len = getNum('period', 14);
    out.push({
      id: `${ind.id}-rsi`,
      school: 'custom',
      name: `${ind.name} (${len})`,
      color: ind.color,
      lineWidth: ind.lineWidth,
      pane: 'oscillator',
      data: calcRSI(candles, len),
    });
  } else if (bp.kind === 'bollinger_squeeze' || bp.kind === 'atr_channel') {
    const period = getNum('period', 20);
    const mult = getNum('multiplier', 2);
    const sma = calcSMA(candles, period);
    const upper: OverlaySeriesPoint[] = [];
    const lower: OverlaySeriesPoint[] = [];
    for (let i = period - 1; i < candles.length; i++) {
      const slice = candles.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b.close, 0) / period;
      const variance = slice.reduce((a, b) => a + Math.pow(b.close - mean, 2), 0) / period;
      const dev = Math.sqrt(variance) * mult;
      upper.push({ time: candles[i].time, value: mean + dev });
      lower.push({ time: candles[i].time, value: mean - dev });
    }
    out.push(
      { id: `${ind.id}-mid`, school: 'custom', name: `${ind.name} Mid`, color: ind.color, lineWidth: 1.2, pane: 'main', data: sma },
      { id: `${ind.id}-up`, school: 'custom', name: `${ind.name} Upper`, color: ind.secondaryColor || ind.color, lineWidth: 1, dashed: true, pane: 'main', data: upper },
      { id: `${ind.id}-dn`, school: 'custom', name: `${ind.name} Lower`, color: ind.secondaryColor || ind.color, lineWidth: 1, dashed: true, pane: 'main', data: lower }
    );
  } else if (bp.kind === 'vwap_deviation') {
    let cumPv = 0;
    let cumVol = 0;
    const pts: OverlaySeriesPoint[] = [];
    const windowStart = Math.max(0, candles.length - 120);
    for (let i = windowStart; i < candles.length; i++) {
      const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
      const v = Math.max(1, candles[i].volume);
      cumPv += typical * v;
      cumVol += v;
      pts.push({ time: candles[i].time, value: cumPv / cumVol });
    }
    out.push({
      id: `${ind.id}-vwap`,
      school: 'custom',
      name: ind.name,
      color: ind.color,
      lineWidth: ind.lineWidth,
      pane: 'main',
      data: pts,
    });
  } else if (bp.kind === 'ema_ribbon') {
    const base = getNum('period', 8);
    [base, base * 2, base * 3].forEach((p, idx) => {
      out.push({
        id: `${ind.id}-rib-${idx}`,
        school: 'custom',
        name: `${ind.name} (${p})`,
        color: idx === 0 ? ind.color : ind.secondaryColor || '#6B7280',
        lineWidth: 1.2,
        pane: 'main',
        data: calcEMA(candles, p),
      });
    });
  } else {
    const period = getNum('period', 14);
    const { macdLine } = calcMACD(candles, Math.max(3, Math.round(period * 0.8)), Math.max(6, period * 2), 9);
    out.push({
      id: `${ind.id}-osc`,
      school: 'custom',
      name: ind.name,
      color: ind.color,
      lineWidth: ind.lineWidth,
      pane: bp.pane || 'oscillator',
      data: bp.pane === 'main' ? calcEMA(candles, period) : macdLine,
    });
  }

  return out;
}

export function findHistoricalPatternTwin(candles: Candle[]): PatternTwinMatch | undefined {
  if (candles.length < 60) return undefined;
  const segLen = 12;
  const current = candles.slice(-segLen);
  const norm = (arr: Candle[]) => {
    const lo = Math.min(...arr.map((c) => c.low));
    const hi = Math.max(...arr.map((c) => c.high));
    const span = Math.max(0.00001, hi - lo);
    return arr.map((c) => (c.close - lo) / span);
  };
  const curVec = norm(current);
  let bestScore = -1;
  let bestIdx = -1;

  for (let i = 0; i < candles.length - segLen * 2 - 4; i++) {
    const candVec = norm(candles.slice(i, i + segLen));
    let diff = 0;
    for (let j = 0; j < segLen; j++) diff += Math.abs(curVec[j] - candVec[j]);
    const sim = Math.max(0, 100 - (diff / segLen) * 140);
    if (sim > bestScore) {
      bestScore = sim;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return undefined;
  const anchorClose = candles[bestIdx + segLen - 1].close;
  const futureSlice = candles.slice(bestIdx + segLen, bestIdx + segLen + 10);
  const futureClose = futureSlice[futureSlice.length - 1]?.close ?? anchorClose;
  const atr = calcATR(candles.slice(0, bestIdx + segLen), 14);
  const moveR = Number(((futureClose - anchorClose) / Math.max(0.00001, atr)).toFixed(2));
  return {
    historicalTime: candles[bestIdx + segLen - 1].time,
    similarityPct: Math.min(97, Math.max(64, Math.round(bestScore))),
    outcome: Math.abs(moveR) >= 0.6 ? 'Won' : 'Lost',
    moveR,
    summary: `Fractal sequence matched ${Math.min(97, Math.max(64, Math.round(bestScore)))}% similarity with prior structural sweep & expansion.`,
  };
}

export function calculateLotSize(
  symbol: string,
  accountBalance: number,
  riskPct: number,
  entry: number,
  sl: number
): { lots: number; riskUsd: number; slPips: number } {
  const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
  const riskUsd = (accountBalance * riskPct) / 100;
  const dist = Math.abs(entry - sl);
  const slPips = Math.max(1, dist / info.pipSize);
  const pipValuePerLot = info.pipSize * info.contractSize;
  const rawLots = riskUsd / Math.max(0.01, slPips * pipValuePerLot);
  const lots = Math.max(0.01, Math.min(50, Math.round(rawLots * 100) / 100));
  return {
    lots,
    riskUsd: Math.round(riskUsd * 100) / 100,
    slPips: Math.round(slPips * 10) / 10,
  };
}

export function computeMtfSnapshot(candlesByTf: Partial<Record<Timeframe, Candle[]>>): MtfSnapshotItem[] {
  const tfs: Timeframe[] = ['1m', '5m', '15m', '1h', '4h'];
  return tfs.map((tf) => {
    const arr = candlesByTf[tf] || [];
    if (arr.length < 15) {
      return { timeframe: tf, bias: 'NEUTRAL', structure: 'RANGE', momentum: 0 };
    }
    const emaFast = calcEMA(arr, 8);
    const emaSlow = calcEMA(arr, 21);
    const lastFast = emaFast[emaFast.length - 1]?.value ?? arr[arr.length - 1].close;
    const lastSlow = emaSlow[emaSlow.length - 1]?.value ?? arr[arr.length - 1].close;
    const rsi = calcRSI(arr, 14);
    const lastRsi = rsi[rsi.length - 1]?.value ?? 50;
    const bias = lastFast > lastSlow * 1.0002 ? 'BULLISH' : lastFast < lastSlow * 0.9998 ? 'BEARISH' : 'NEUTRAL';
    const { highs, lows } = findSwings(arr, 3);
    const lastClose = arr[arr.length - 1].close;
    const prevHigh = highs[highs.length - 1]?.price ?? lastClose;
    const prevLow = lows[lows.length - 1]?.price ?? lastClose;
    const structure = lastClose > prevHigh || lastClose < prevLow ? 'BOS' : Math.abs(lastRsi - 50) > 14 ? 'CHoCH' : 'RANGE';
    const momentum = Math.round((lastRsi - 50) * 2);
    return { timeframe: tf, bias, structure, momentum };
  });
}
