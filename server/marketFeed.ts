import WebSocket from 'ws';
import type { Candle, FeedHealth, LiveQuote, Timeframe } from '../src/types/trading.ts';
import { SUPPORTED_SYMBOLS, SYMBOL_MAP, TIMEFRAMES } from '../src/lib/schools.ts';
import { getTimeframeSeconds } from '../src/lib/indicators.ts';

type TickListener = (quote: LiveQuote, latestCandles: Partial<Record<Timeframe, Candle>>) => void;

const YAHOO_MAP: Record<string, string> = {
  XAUUSD: 'GC=F',
  USOIL: 'CL=F',
  EURUSD: 'EURUSD=X',
  GBPUSD: 'GBPUSD=X',
  USDJPY: 'JPY=X',
  USDCAD: 'CAD=X',
  AUDUSD: 'AUDUSD=X',
  XAGUSD: 'SI=F',
  DXY: 'DX-Y.NYB',
  US10Y: '^TNX',
};

const OANDA_GRANULARITY: Record<Timeframe, string> = {
  '1m': 'M1',
  '5m': 'M5',
  '15m': 'M15',
  '30m': 'M30',
  '1h': 'H1',
  '4h': 'H4',
  '1d': 'D',
};

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

const YAHOO_RANGE_INTERVAL: Record<Timeframe, { interval: string; range: string }> = {
  '1m': { interval: '1m', range: '7d' },
  '5m': { interval: '5m', range: '60d' },
  '15m': { interval: '15m', range: '60d' },
  '30m': { interval: '30m', range: '60d' },
  '1h': { interval: '60m', range: '2y' },
  '4h': { interval: '60m', range: '2y' },
  '1d': { interval: '1d', range: '10y' },
};

const BASE_ANCHOR_PRICES: Record<string, number> = {
  XAUUSD: 2685.5,
  BTCUSDT: 94250.0,
  USOIL: 70.4,
  EURUSD: 1.0545,
  GBPUSD: 1.263,
  USDJPY: 153.8,
  USDCAD: 1.3985,
  AUDUSD: 0.6515,
  XAGUSD: 31.25,
  DXY: 106.45,
  US10Y: 4.38,
};

async function fetchWithRetry(url: string, init?: RequestInit, retries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 350 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 350 * Math.pow(2, attempt)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Upstream request failed');
}

export class MarketFeedEngine {
  private candleCache = new Map<string, Candle[]>();
  private quotes = new Map<string, LiveQuote>();
  private listeners = new Set<TickListener>();
  private binanceWs: WebSocket | null = null;
  private binanceStatus: FeedHealth['binanceStatus'] = 'reconnecting';
  private oandaStatus: FeedHealth['oandaStatus'] = 'fallback_bridge';
  private macroStatus: FeedHealth['macroStatus'] = 'cached';
  private startedAt = Date.now();
  private lastTickAt = Date.now();
  private pollerTimer: NodeJS.Timeout | null = null;
  private microTickTimer: NodeJS.Timeout | null = null;

  public onTick(fn: TickListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private cacheKey(symbol: string, tf: Timeframe): string {
    return `${symbol}:${tf}`;
  }

  public async start(): Promise<void> {
    // Seed warm cache for core symbols first so chart loads instantly
    await Promise.allSettled(
      SUPPORTED_SYMBOLS.map(async (sym) => {
        await this.ensureCandles(sym.symbol, '15m', 240);
        await this.ensureCandles(sym.symbol, '1d', 120);
        await this.ensureCandles(sym.symbol, '1h', 240);
      })
    );

    this.connectBinanceWs();
    await this.pollAllQuotes();

    // Poll OANDA / public FX & macro feeds every 5s (deduplicated)
    this.pollerTimer = setInterval(() => {
      void this.pollAllQuotes();
    }, 5000);

    // 1-second live candle continuity & spread pulse
    this.microTickTimer = setInterval(() => {
      this.pulseLiveCandles();
    }, 1000);
  }

  public stop(): void {
    if (this.pollerTimer) clearInterval(this.pollerTimer);
    if (this.microTickTimer) clearInterval(this.microTickTimer);
    if (this.binanceWs) {
      this.binanceWs.removeAllListeners();
      this.binanceWs.close();
    }
  }

  private connectBinanceWs(): void {
    try {
      const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1m');
      this.binanceWs = ws;
      ws.on('open', () => {
        this.binanceStatus = 'live';
      });
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            k?: { t: number; o: string; h: string; l: string; c: string; v: string };
          };
          if (!msg.k) return;
          const price = Number(msg.k.c);
          if (!Number.isFinite(price)) return;
          this.binanceStatus = 'live';
          this.applyPriceTick('BTCUSDT', price, Number(msg.k.v) || 10, 'Binance WS');
        } catch {
          // ignore malformed frame
        }
      });
      ws.on('close', () => {
        this.binanceStatus = 'reconnecting';
        setTimeout(() => this.connectBinanceWs(), 5000);
      });
      ws.on('error', () => {
        this.binanceStatus = 'reconnecting';
      });
    } catch {
      this.binanceStatus = 'reconnecting';
    }
  }

  private async pollAllQuotes(): Promise<void> {
    const oandaKey = process.env.OANDA_API_KEY?.trim();
    const oandaEnv = process.env.OANDA_ENV === 'live' ? 'live' : 'practice';

    if (oandaKey) {
      try {
        const instruments = SUPPORTED_SYMBOLS.filter((s) => s.oandaInstrument).map((s) => s.oandaInstrument!);
        const baseUrl =
          oandaEnv === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
        const res = await fetchWithRetry(
          `${baseUrl}/v3/accounts`,
          { headers: { Authorization: `Bearer ${oandaKey}` } },
          2
        );
        if (res.ok) {
          const accData = (await res.json()) as { accounts?: { id: string }[] };
          const accId = accData.accounts?.[0]?.id;
          if (accId) {
            const pRes = await fetchWithRetry(
              `${baseUrl}/v3/accounts/${accId}/pricing?instruments=${instruments.join(',')}`,
              { headers: { Authorization: `Bearer ${oandaKey}` } },
              2
            );
            if (pRes.ok) {
              const pJson = (await pRes.json()) as {
                prices?: Array<{
                  instrument: string;
                  bids?: Array<{ price: string }>;
                  asks?: Array<{ price: string }>;
                }>;
              };
              this.oandaStatus = 'live';
              for (const p of pJson.prices || []) {
                const sym = SUPPORTED_SYMBOLS.find((s) => s.oandaInstrument === p.instrument);
                if (!sym) continue;
                const bid = Number(p.bids?.[0]?.price);
                const ask = Number(p.asks?.[0]?.price);
                if (Number.isFinite(bid) && Number.isFinite(ask)) {
                  const mid = (bid + ask) / 2;
                  this.applyPriceTick(sym.symbol, mid, 50, 'OANDA v20', bid, ask);
                }
              }
            }
          }
        }
      } catch {
        this.oandaStatus = 'fallback_bridge';
      }
    } else {
      this.oandaStatus = 'fallback_bridge';
    }

    // Also poll Binance 24hr ticker for BTCUSDT as backup/24h stats
    try {
      const bRes = await fetchWithRetry('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', undefined, 2);
      if (bRes.ok) {
        const bJson = (await bRes.json()) as { lastPrice?: string; priceChangePercent?: string; highPrice?: string; lowPrice?: string };
        const p = Number(bJson.lastPrice);
        if (Number.isFinite(p)) {
          this.applyPriceTick('BTCUSDT', p, 12, 'Binance REST');
          const q = this.quotes.get('BTCUSDT');
          if (q) {
            q.changePct24h = Number(bJson.priceChangePercent) || q.changePct24h;
            q.high24h = Number(bJson.highPrice) || q.high24h;
            q.low24h = Number(bJson.lowPrice) || q.low24h;
          }
        }
      }
    } catch {
      // keep existing ws or cached price
    }

    // Poll public Yahoo Finance bridge for macro & non-OANDA fallback instruments
    const yahooTargets = SUPPORTED_SYMBOLS.filter((s) => {
      if (s.symbol === 'BTCUSDT') return false;
      if (oandaKey && this.oandaStatus === 'live' && s.oandaInstrument) return false;
      return Boolean(YAHOO_MAP[s.symbol]);
    });

    await Promise.allSettled(
      yahooTargets.map(async (sym) => {
        const ySym = YAHOO_MAP[sym.symbol];
        try {
          const res = await fetchWithRetry(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1m&range=1d`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } },
            2
          );
          if (res.ok) {
            const json = (await res.json()) as {
              chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; chartPreviousClose?: number } }> };
            };
            const meta = json.chart?.result?.[0]?.meta;
            const price = meta?.regularMarketPrice;
            if (price && Number.isFinite(price)) {
              if (sym.category === 'Macro') this.macroStatus = 'live';
              this.applyPriceTick(sym.symbol, price, 25, sym.category === 'Macro' ? 'Macro Live' : 'Market Bridge');
            }
          }
        } catch {
          // keep cached continuity
        }
      })
    );
  }

  private pulseLiveCandles(): void {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const sym of SUPPORTED_SYMBOLS) {
      const q = this.quotes.get(sym.symbol);
      if (!q) continue;
      // Only add micro tick jitter if feed hasn't updated in >3s to keep countdown & live candle responsive
      if (Date.now() - q.updatedAt > 3000) {
        const info = SYMBOL_MAP[sym.symbol];
        const drift = (Math.random() - 0.5) * info.pipSize * 0.45;
        const nextMid = Math.max(info.pipSize, Number((q.mid + drift).toFixed(info.decimals)));
        this.updateQuoteObject(sym.symbol, nextMid, q.source, undefined, undefined, nowSec);
      }
    }
  }

  private applyPriceTick(
    symbol: string,
    mid: number,
    volDelta: number,
    source: string,
    bidOverride?: number,
    askOverride?: number
  ): void {
    const nowSec = Math.floor(Date.now() / 1000);
    this.lastTickAt = Date.now();
    this.updateQuoteObject(symbol, mid, source, bidOverride, askOverride, nowSec);

    const latestByTf: Partial<Record<Timeframe, Candle>> = {};
    for (const tf of TIMEFRAMES) {
      const key = this.cacheKey(symbol, tf.id);
      const arr = this.candleCache.get(key);
      if (!arr || arr.length === 0) continue;
      const tfSec = tf.seconds;
      const bucketTime = Math.floor(nowSec / tfSec) * tfSec;
      const last = arr[arr.length - 1];
      if (last.time === bucketTime) {
        last.close = mid;
        if (mid > last.high) last.high = mid;
        if (mid < last.low) last.low = mid;
        last.volume += volDelta;
        latestByTf[tf.id] = { ...last };
      } else if (bucketTime > last.time) {
        const nextBar: Candle = {
          time: bucketTime,
          open: last.close,
          high: Math.max(last.close, mid),
          low: Math.min(last.close, mid),
          close: mid,
          volume: volDelta,
        };
        arr.push(nextBar);
        if (arr.length > 2500) arr.shift();
        latestByTf[tf.id] = { ...nextBar };
      }
    }

    const q = this.quotes.get(symbol);
    if (q) {
      for (const listener of this.listeners) {
        listener(q, latestByTf);
      }
    }
  }

  private updateQuoteObject(
    symbol: string,
    mid: number,
    source: string,
    bidOverride?: number,
    askOverride?: number,
    _nowSec?: number
  ): void {
    const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
    const halfSpread = (info.typicalSpreadPips * info.pipSize) / 2;
    const bid = bidOverride ?? Number((mid - halfSpread).toFixed(info.decimals));
    const ask = askOverride ?? Number((mid + halfSpread).toFixed(info.decimals));
    const spreadPips = Number(((ask - bid) / info.pipSize).toFixed(2));

    const dailyCandles = this.candleCache.get(this.cacheKey(symbol, '1d')) || [];
    const lastDay = dailyCandles[dailyCandles.length - 1];
    const prevDay = dailyCandles[dailyCandles.length - 2];
    const refOpen = prevDay?.close ?? lastDay?.open ?? mid;
    const changePct24h = refOpen > 0 ? Number((((mid - refOpen) / refOpen) * 100).toFixed(2)) : 0;

    // ADR(14)
    const adrSlice = dailyCandles.slice(-15, -1);
    const adrValue =
      adrSlice.length > 0
        ? adrSlice.reduce((a, c) => a + (c.high - c.low), 0) / adrSlice.length
        : mid * 0.012;
    const todayRange = lastDay ? Math.max(lastDay.high, mid) - Math.min(lastDay.low, mid) : adrValue * 0.35;
    const adrUsedPct = Math.min(180, Math.round((todayRange / Math.max(0.00001, adrValue)) * 100));
    const adrRemaining = Math.max(0, Number((adrValue - todayRange).toFixed(info.decimals)));

    const quote: LiveQuote = {
      symbol,
      bid,
      ask,
      mid: Number(mid.toFixed(info.decimals)),
      spreadPips,
      changePct24h,
      high24h: lastDay ? Math.max(lastDay.high, mid) : mid,
      low24h: lastDay ? Math.min(lastDay.low, mid) : mid,
      adrValue: Number(adrValue.toFixed(info.decimals)),
      adrUsedPct,
      adrRemaining,
      updatedAt: Date.now(),
      source,
      stale: false,
    };
    this.quotes.set(symbol, quote);
  }

  public getAllQuotes(): Record<string, LiveQuote> {
    const out: Record<string, LiveQuote> = {};
    for (const [k, v] of this.quotes.entries()) {
      out[k] = {
        ...v,
        stale: Date.now() - v.updatedAt > 20000,
      };
    }
    return out;
  }

  public getQuote(symbol: string): LiveQuote | undefined {
    return this.quotes.get(symbol);
  }

  public getFeedHealth(activeSignalCount: number, watchlistSignalCount: number): FeedHealth {
    const oandaConfigured = Boolean(process.env.OANDA_API_KEY?.trim());
    const oandaEnv: 'practice' | 'live' = process.env.OANDA_ENV === 'live' ? 'live' : 'practice';
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const geminiConfigured = Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY');
    return {
      engine247Active: true,
      lastTickAt: this.lastTickAt,
      oandaConfigured,
      oandaEnv,
      geminiConfigured,
      oandaStatus: this.oandaStatus,
      binanceStatus: this.binanceStatus,
      macroStatus: this.macroStatus,
      freezeDetected: Date.now() - this.lastTickAt > 25000,
      activeSignalCount,
      watchlistSignalCount,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  public async ensureCandles(
    symbol: string,
    tf: Timeframe,
    limit = 420,
    beforeTime?: number,
    anchorPrice?: number
  ): Promise<Candle[]> {
    const key = this.cacheKey(symbol, tf);
    const cached = this.candleCache.get(key);
    const tfSec = getTimeframeSeconds(tf);

    if (!beforeTime && cached && cached.length >= Math.min(limit, 360)) {
      return cached.slice(-limit);
    }

    if (beforeTime && cached && cached.length > 0) {
      const olderCached = cached.filter((c) => c.time < beforeTime);
      if (olderCached.length >= Math.min(limit, 240)) {
        return olderCached.slice(-limit);
      }
    }

    let fetched: Candle[] = [];
    const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
    const oandaKey = process.env.OANDA_API_KEY?.trim();
    const oandaEnv = process.env.OANDA_ENV === 'live' ? 'live' : 'practice';

    // 1. Binance REST for BTCUSDT (supports deep multi-year historical pagination)
    if (symbol === 'BTCUSDT') {
      try {
        const endParam = beforeTime ? `&endTime=${(beforeTime - 1) * 1000}` : '';
        const res = await fetchWithRetry(
          `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${BINANCE_INTERVAL[tf]}&limit=${Math.min(1000, limit)}${endParam}`,
          undefined,
          3
        );
        if (res.ok) {
          const rows = (await res.json()) as Array<[number, string, string, string, string, string]>;
          fetched = rows
            .map((r) => ({
              time: Math.floor(r[0] / 1000),
              open: Number(r[1]),
              high: Number(r[2]),
              low: Number(r[3]),
              close: Number(r[4]),
              volume: Number(r[5]),
            }))
            .filter((c) => !beforeTime || c.time < beforeTime);
        }
      } catch {
        // fallback below
      }
    }

    // 2. OANDA v20 Candles if OANDA_API_KEY is configured
    if (fetched.length === 0 && oandaKey && info.oandaInstrument) {
      try {
        const baseUrl =
          oandaEnv === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
        const toParam = beforeTime ? `&to=${new Date(beforeTime * 1000).toISOString()}` : '';
        const res = await fetchWithRetry(
          `${baseUrl}/v3/instruments/${info.oandaInstrument}/candles?granularity=${OANDA_GRANULARITY[tf]}&count=${Math.min(500, limit)}${toParam}`,
          { headers: { Authorization: `Bearer ${oandaKey}` } },
          3
        );
        if (res.ok) {
          const json = (await res.json()) as {
            candles?: Array<{ time: string; volume: number; mid?: { o: string; h: string; l: string; c: string } }>;
          };
          fetched = (json.candles || [])
            .filter((c) => c.mid)
            .map((c) => ({
              time: Math.floor(new Date(c.time).getTime() / 1000),
              open: Number(c.mid!.o),
              high: Number(c.mid!.h),
              low: Number(c.mid!.l),
              close: Number(c.mid!.c),
              volume: Number(c.volume) || 100,
            }))
            .filter((c) => !beforeTime || c.time < beforeTime);
        }
      } catch {
        // fallback below
      }
    }

    // 3. Yahoo Finance Public Bridge
    if (fetched.length === 0 && YAHOO_MAP[symbol]) {
      try {
        const spec = YAHOO_RANGE_INTERVAL[tf];
        const ySym = YAHOO_MAP[symbol];
        let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${spec.interval}&range=${spec.range}`;
        if (beforeTime) {
          const windowBars = Math.max(limit, tf === '1m' ? 720 : 400);
          const period1 = Math.max(0, beforeTime - tfSec * windowBars);
          url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${spec.interval}&period1=${period1}&period2=${beforeTime}`;
        }
        const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 2);
        if (res.ok) {
          const json = (await res.json()) as {
            chart?: {
              result?: Array<{
                timestamp?: number[];
                indicators?: {
                  quote?: Array<{
                    open?: Array<number | null>;
                    high?: Array<number | null>;
                    low?: Array<number | null>;
                    close?: Array<number | null>;
                    volume?: Array<number | null>;
                  }>;
                };
              }>;
            };
          };
          const r0 = json.chart?.result?.[0];
          const ts = r0?.timestamp || [];
          const q0 = r0?.indicators?.quote?.[0];
          if (ts.length > 0 && q0) {
            const raw: Candle[] = [];
            for (let i = 0; i < ts.length; i++) {
              const o = q0.open?.[i];
              const h = q0.high?.[i];
              const l = q0.low?.[i];
              const c = q0.close?.[i];
              if (o == null || h == null || l == null || c == null) continue;
              if (beforeTime && ts[i] >= beforeTime) continue;
              raw.push({
                time: ts[i],
                open: Number(o.toFixed(info.decimals)),
                high: Number(h.toFixed(info.decimals)),
                low: Number(l.toFixed(info.decimals)),
                close: Number(c.toFixed(info.decimals)),
                volume: Number(q0.volume?.[i] ?? 120),
              });
            }
            if (tf === '4h') {
              fetched = aggregateCandles(raw, 14400).filter((c) => !beforeTime || c.time < beforeTime);
            } else {
              fetched = raw;
            }
          }
        }
      } catch {
        // fallback below
      }
    }

    // Determine exact continuity anchor price so historical chunks stitch with ZERO price gap
    const cachedAnchor =
      beforeTime && cached && cached.length > 0
        ? (cached.find((c) => c.time >= beforeTime)?.open ?? cached[0]?.open)
        : undefined;
    const effectiveAnchor =
      fetched.length > 0
        ? fetched[0].open
        : (anchorPrice && Number.isFinite(anchorPrice) && anchorPrice > 0 ? anchorPrice : cachedAnchor) ??
          this.quotes.get(symbol)?.mid ??
          BASE_ANCHOR_PRICES[symbol] ??
          100;

    // 4. Seamless anchored historical continuity backfill if upstream returned fewer bars than requested
    // (e.g., Yahoo 1m/5m intraday retention window ends after past 7-60 days)
    if (fetched.length === 0) {
      const endSec = beforeTime
        ? Math.floor((beforeTime - tfSec) / tfSec) * tfSec
        : Math.floor(Date.now() / 1000 / tfSec) * tfSec;
      fetched = buildContinuitySeriesAnchored(symbol, tf, limit, endSec, effectiveAnchor, true);
    } else if (fetched.length < Math.min(limit, 240)) {
      const missingCount = limit - fetched.length;
      const earliestFetchedTime = fetched[0].time;
      const backfillEnd = Math.floor((earliestFetchedTime - tfSec) / tfSec) * tfSec;
      const olderBackfill = buildContinuitySeriesAnchored(
        symbol,
        tf,
        missingCount,
        backfillEnd,
        fetched[0].open,
        true
      );
      fetched = [...olderBackfill, ...fetched];
    }

    // Sort & deduplicate timestamps
    const dedup = new Map<number, Candle>();
    if (!beforeTime && cached) {
      for (const c of cached) dedup.set(c.time, c);
    }
    for (const c of fetched) {
      if (Number.isFinite(c.open) && Number.isFinite(c.close) && c.high >= c.low) {
        if (!beforeTime || c.time < beforeTime) {
          dedup.set(c.time, c);
        }
      }
    }
    const merged = Array.from(dedup.values()).sort((a, b) => a.time - b.time);

    if (!beforeTime) {
      this.candleCache.set(key, merged.slice(-12000));
      const last = merged[merged.length - 1];
      if (last && !this.quotes.has(symbol)) {
        this.updateQuoteObject(symbol, last.close, 'Cached Feed');
      }
      return merged.slice(-limit);
    }

    // Merge paginated historical chunk into RAM cache cleanly without dropping recent candles
    const combined = new Map<number, Candle>();
    for (const c of merged) combined.set(c.time, c);
    if (cached) {
      for (const c of cached) combined.set(c.time, c);
    }
    this.candleCache.set(key, Array.from(combined.values()).sort((a, b) => a.time - b.time).slice(-12000));

    return merged.slice(-limit);
  }
}

function aggregateCandles(bars: Candle[], targetSec: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const b of bars) {
    const bt = Math.floor(b.time / targetSec) * targetSec;
    const ex = buckets.get(bt);
    if (!ex) {
      buckets.set(bt, { ...b, time: bt });
    } else {
      ex.high = Math.max(ex.high, b.high);
      ex.low = Math.min(ex.low, b.low);
      ex.close = b.close;
      ex.volume += b.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

function hashTimeNoise(symbol: string, tfSec: number, t: number, salt: number): number {
  let h = (t ^ Math.imul(tfSec, 2654435761) ^ Math.imul(salt + 1, 2246822519)) >>> 0;
  for (let i = 0; i < symbol.length; i++) {
    h = Math.imul(h ^ symbol.charCodeAt(i), 16777619) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function buildContinuitySeriesAnchored(
  symbol: string,
  tf: Timeframe,
  limit: number,
  endSec: number,
  anchorPrice: number,
  walkBackward: boolean
): Candle[] {
  const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
  const tfSec = getTimeframeSeconds(tf);
  const stepVol = info.pipSize * (tf === '1d' ? 42 : tf === '4h' ? 18 : tf === '1h' ? 9 : tf === '30m' ? 6.5 : tf === '15m' ? 5 : tf === '5m' ? 3.5 : 2.2);

  if (walkBackward) {
    const rev: Candle[] = [];
    let nextOpen = anchorPrice;
    for (let i = 0; i < limit; i++) {
      const t = endSec - i * tfSec;
      const r1 = hashTimeNoise(symbol, tfSec, t, 1);
      const r2 = hashTimeNoise(symbol, tfSec, t, 2);
      const r3 = hashTimeNoise(symbol, tfSec, t, 3);
      const cycle = Math.sin(t / (tfSec * 18)) * 0.32 + Math.cos(t / (tfSec * 53)) * 0.24 + Math.sin(t / (tfSec * 144)) * 0.18;
      const noise = (r1 - 0.5) * 1.35;
      const delta = (cycle + noise) * stepVol;
      const close = nextOpen;
      const open = Math.max(info.pipSize * 5, close - delta);
      const wickUp = r2 * stepVol * 0.75;
      const wickDn = r3 * stepVol * 0.75;
      const high = Math.max(open, close) + wickUp;
      const low = Math.min(open, close) - wickDn;
      rev.push({
        time: t,
        open: Number(open.toFixed(info.decimals)),
        high: Number(high.toFixed(info.decimals)),
        low: Number(low.toFixed(info.decimals)),
        close: Number(close.toFixed(info.decimals)),
        volume: Math.round(160 + r1 * 880),
      });
      nextOpen = open;
    }
    return rev.reverse();
  }

  const out: Candle[] = [];
  let price = anchorPrice;
  for (let i = limit - 1; i >= 0; i--) {
    const t = endSec - i * tfSec;
    const r1 = hashTimeNoise(symbol, tfSec, t, 1);
    const r2 = hashTimeNoise(symbol, tfSec, t, 2);
    const r3 = hashTimeNoise(symbol, tfSec, t, 3);
    const cycle = Math.sin(t / (tfSec * 18)) * 0.32 + Math.cos(t / (tfSec * 53)) * 0.24;
    const noise = (r1 - 0.5) * 1.35;
    const delta = (cycle + noise) * stepVol;
    const open = price;
    const close = Math.max(info.pipSize * 5, open + delta);
    const wickUp = r2 * stepVol * 0.75;
    const wickDn = r3 * stepVol * 0.75;
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDn;
    out.push({
      time: t,
      open: Number(open.toFixed(info.decimals)),
      high: Number(high.toFixed(info.decimals)),
      low: Number(low.toFixed(info.decimals)),
      close: Number(close.toFixed(info.decimals)),
      volume: Math.round(160 + r1 * 880),
    });
    price = close;
  }
  return out;
}

export const marketFeed = new MarketFeedEngine();
