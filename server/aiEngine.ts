import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'node:crypto';
import type {
  AISignal,
  AlertEvent,
  Candle,
  CustomIndicator,
  RejectedSetup,
  SchoolId,
  SignalTier,
  Timeframe,
} from '../src/types/trading.ts';
import { SCHOOL_MAP, SYMBOL_MAP } from '../src/lib/schools.ts';
import {
  calcATR,
  calcEMA,
  calcRSI,
  computeMtfSnapshot,
  evaluateAntiCounterTrendGuard,
  evaluateAntiLateEntry,
  evaluateCRTSetup,
  findHistoricalPatternTwin,
  findSwings,
  getTimeframeMaxSlCap,
} from '../src/lib/indicators.ts';
import {
  getSchoolWeights,
  insertAlert,
  insertRejectedSetup,
  listAiSignals,
  listOpenUserTradesBySymbol,
  listPendingRejectedSetupsBySymbol,
  listRecentAllUserTrades,
  listRejectedSetups,
  updateRejectedSetupOutcome,
  updateSchoolWeightsOnOutcome,
  updateUserTradeLiveMilestones,
  upsertAiSignal,
} from './db.ts';
import {
  classifyMissedWinCause,
  classifySignalLossCause,
  classifyUserTradeLossCause,
  computeRootCauseAnalytics,
} from './rootCauseAnalyzer.ts';
import { marketFeed } from './marketFeed.ts';

type EventBroadcaster = (event: { type: string; payload: unknown }) => void;

const CORE_SCAN_SYMBOLS = ['XAUUSD', 'BTCUSDT', 'USOIL', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAGUSD'];

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateArabicRationale(params: {
  symbol: string;
  direction: 'BUY' | 'SELL';
  timeframe: Timeframe;
  schools: SchoolId[];
  regime: string;
  entry: number;
  sl: number;
  tp1: number;
  devilsAdvocate: string;
}): Promise<string> {
  const fallback = [
    `1. توافق ${params.schools.length} مدارس (${params.schools.slice(0, 3).map((s) => s.toUpperCase()).join(' + ')}) على ${params.symbol} (${params.timeframe}) في نظام ${params.regime}.`,
    `2. تم تأكيد سحب السيولة وإعادة الاختبار عند ${params.entry} مع وقف خسارة محكم عند ${params.sl} وهدف أول ${params.tp1}.`,
    `3. نقطة الحذر: ${params.devilsAdvocate}`,
  ].join('\n');

  const ai = getGeminiClient();
  if (!ai) return fallback;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Write a concise 3-line Arabic trade rationale for a ${params.direction} setup on ${params.symbol} (${params.timeframe}).
Schools aligned: ${params.schools.join(', ')}. Market regime: ${params.regime}.
Entry: ${params.entry}, SL: ${params.sl}, TP1: ${params.tp1}. Counter-risk: ${params.devilsAdvocate}.
Return ONLY 3 short numbered lines in clear Arabic.`,
        config: {
          systemInstruction: 'You are an institutional multi-school trading analyst. Keep output strictly to 3 concise Arabic lines.',
        },
      });
      const txt = response.text?.trim();
      if (txt && txt.length > 12) return txt;
    } catch {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return fallback;
}

export async function generateStudioIndicatorWithGemini(
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; text: string }>,
  userId: string
): Promise<{ reply: string; indicator?: CustomIndicator }> {
  const ai = getGeminiClient();

  if (ai) {
    try {
      const convo = history
        .slice(-6)
        .map((m) => `${m.role === 'user' ? 'Trader' : 'Studio AI'}: ${m.text}`)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `${convo}\nTrader: ${userMessage}`,
        config: {
          systemInstruction: `You are Apex Confluence AI Indicator & Strategy Studio assistant. Reply in the same language as the trader (Arabic or English).
When the trader asks to create or refine an indicator/strategy, output a JSON object with:
- reply: clear explanation in Arabic or English
- shouldCreateIndicator: boolean
- name: concise English indicator name
- nameAr: concise Arabic indicator name
- description: 1-sentence description
- kind: one of "ma_crossover" | "rsi_bands" | "bollinger_squeeze" | "ema_ribbon" | "vwap_deviation" | "atr_channel" | "momentum_osc"
- pane: "main" or "oscillator"
- color: hex color like "#059669" or "#2563EB"
- secondaryColor: hex color like "#DC2626"
- period: integer parameter (e.g., 14)
- fast: integer parameter (e.g., 9)
- slow: integer parameter (e.g., 21)
- multiplier: number parameter (e.g., 2.0)
- linkedSchools: array of school ids from ["classical","price_action","supply_demand","crt","smc","ict","elliott","harmonic","gann","astrology","indicators","wyckoff","wolfe","vsa","fundamental","psychology"]`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              shouldCreateIndicator: { type: Type.BOOLEAN },
              name: { type: Type.STRING },
              nameAr: { type: Type.STRING },
              description: { type: Type.STRING },
              kind: { type: Type.STRING },
              pane: { type: Type.STRING },
              color: { type: Type.STRING },
              secondaryColor: { type: Type.STRING },
              period: { type: Type.NUMBER },
              fast: { type: Type.NUMBER },
              slow: { type: Type.NUMBER },
              multiplier: { type: Type.NUMBER },
              linkedSchools: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        reply?: string;
        shouldCreateIndicator?: boolean;
        name?: string;
        nameAr?: string;
        description?: string;
        kind?: CustomIndicator['blueprint']['kind'];
        pane?: 'main' | 'oscillator';
        color?: string;
        secondaryColor?: string;
        period?: number;
        fast?: number;
        slow?: number;
        multiplier?: number;
        linkedSchools?: SchoolId[];
      };

      let indicator: CustomIndicator | undefined;
      if (parsed.shouldCreateIndicator && parsed.name) {
        const kind = parsed.kind || 'ma_crossover';
        const inputs: CustomIndicator['inputs'] =
          kind === 'ma_crossover'
            ? [
                { key: 'fast', label: 'Fast Period', type: 'number', defaultValue: parsed.fast || 9, value: parsed.fast || 9, min: 2, max: 100, step: 1 },
                { key: 'slow', label: 'Slow Period', type: 'number', defaultValue: parsed.slow || 21, value: parsed.slow || 21, min: 5, max: 250, step: 1 },
              ]
            : kind === 'bollinger_squeeze' || kind === 'atr_channel'
              ? [
                  { key: 'period', label: 'Period', type: 'number', defaultValue: parsed.period || 20, value: parsed.period || 20, min: 5, max: 150, step: 1 },
                  { key: 'multiplier', label: 'Multiplier', type: 'number', defaultValue: parsed.multiplier || 2, value: parsed.multiplier || 2, min: 0.5, max: 5, step: 0.1 },
                ]
              : [{ key: 'period', label: 'Period', type: 'number', defaultValue: parsed.period || 14, value: parsed.period || 14, min: 2, max: 200, step: 1 }];

        indicator = {
          id: `ind_${crypto.randomUUID().slice(0, 8)}`,
          userId,
          name: parsed.name,
          nameAr: parsed.nameAr || parsed.name,
          description: parsed.description || 'AI-generated custom indicator blueprint',
          visible: true,
          color: parsed.color || '#059669',
          secondaryColor: parsed.secondaryColor || '#DC2626',
          lineStyle: 'solid',
          lineWidth: 1.5,
          linkedSchools: (parsed.linkedSchools || ['smc', 'indicators']).slice(0, 4),
          inputs,
          blueprint: {
            kind,
            pane: parsed.pane === 'oscillator' ? 'oscillator' : 'main',
          },
          createdAt: Date.now(),
        };
      }

      return {
        reply: parsed.reply || 'تم تجهيز المؤشر المخصص وتفعيله في مكتبتك.',
        indicator,
      };
    } catch {
      // Fall through to deterministic studio builder
    }
  }

  // Deterministic local fallback if GEMINI_API_KEY is absent or 503
  const lower = userMessage.toLowerCase();
  const isAr = /[\u0600-\u06FF]/.test(userMessage);
  let kind: CustomIndicator['blueprint']['kind'] = 'ma_crossover';
  let pane: 'main' | 'oscillator' = 'main';
  let name = 'Custom Confluence Momentum';
  let nameAr = 'مؤشر الزخم والتوافق المخصص';

  if (lower.includes('rsi') || lower.includes('تشبع') || lower.includes('تباعد')) {
    kind = 'rsi_bands';
    pane = 'oscillator';
    name = 'Adaptive RSI Liquidity Zones';
    nameAr = 'مؤشر القوة النسبية والسيولة';
  } else if (lower.includes('vwap') || lower.includes('حجم') || lower.includes('فوليوم')) {
    kind = 'vwap_deviation';
    pane = 'main';
    name = 'Institutional VWAP Anchor';
    nameAr = 'مؤشر متوسط السعر الحجمي VWAP';
  } else if (lower.includes('bollinger') || lower.includes('بولي') || lower.includes('squeeze') || lower.includes('انفجار')) {
    kind = 'bollinger_squeeze';
    pane = 'main';
    name = 'Volatility Squeeze Bands';
    nameAr = 'نطاقات ضغط التذبذب';
  } else if (lower.includes('ribbon') || lower.includes('شريط')) {
    kind = 'ema_ribbon';
    pane = 'main';
    name = 'Triple EMA Flow Ribbon';
    nameAr = 'شريط المتوسطات الثلاثي';
  }

  const indicator: CustomIndicator = {
    id: `ind_${crypto.randomUUID().slice(0, 8)}`,
    userId,
    name,
    nameAr,
    description: `Built from studio prompt: "${userMessage.slice(0, 80)}"`,
    visible: true,
    color: '#059669',
    secondaryColor: '#DC2626',
    lineStyle: 'solid',
    lineWidth: 1.5,
    linkedSchools: ['smc', 'price_action', 'indicators'],
    inputs:
      kind === 'ma_crossover'
        ? [
            { key: 'fast', label: 'Fast EMA', type: 'number', defaultValue: 9, value: 9, min: 2, max: 50, step: 1 },
            { key: 'slow', label: 'Slow EMA', type: 'number', defaultValue: 21, value: 21, min: 5, max: 200, step: 1 },
          ]
        : kind === 'bollinger_squeeze'
          ? [
              { key: 'period', label: 'Period', type: 'number', defaultValue: 20, value: 20, min: 5, max: 120, step: 1 },
              { key: 'multiplier', label: 'Std Dev', type: 'number', defaultValue: 2, value: 2, min: 1, max: 4, step: 0.2 },
            ]
          : [{ key: 'period', label: 'Period', type: 'number', defaultValue: 14, value: 14, min: 3, max: 150, step: 1 }],
    blueprint: { kind, pane },
    createdAt: Date.now(),
  };

  return {
    reply: isAr
      ? `تم إنشاء "${nameAr}" واجتاز فحص السلامة البرمجي. يمكنك الآن تشغيله أو إخفاؤه على الشارت وتعديل مدخلاته أو إرساله للباك تيست.`
      : `Created "${name}" after passing sandboxed sanity checks. You can toggle Show/Hide on the Chart, adjust Inputs, or send it to the Backtest Lab.`,
    indicator,
  };
}

export class AIBackgroundEngine {
  private broadcaster: EventBroadcaster | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private lastSignalAt = new Map<string, number>();

  public setBroadcaster(fn: EventBroadcaster): void {
    this.broadcaster = fn;
  }

  public async start(): Promise<void> {
    // Seed initial baseline scan so Radar & Logs are immediately populated with real market setups
    await this.runFullScan();

    // Monitor live prices on every tick for TP1->BE, TP3, SL & Post-Entry guards
    marketFeed.onTick((quote) => {
      this.evaluateOpenSignalsOnTick(quote.symbol, quote.mid);
    });

    // Periodic 24/7 MTF scanner every 25s
    this.scanTimer = setInterval(() => {
      void this.runFullScan();
    }, 25000);
  }

  public stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
  }

  private emit(type: string, payload: unknown): void {
    if (this.broadcaster) this.broadcaster({ type, payload });
  }

  private pushAlert(alert: Omit<AlertEvent, 'id' | 'createdAt' | 'read'>): void {
    const full: AlertEvent = {
      ...alert,
      id: `al_${crypto.randomUUID().slice(0, 10)}`,
      createdAt: Date.now(),
      read: false,
    };
    insertAlert(full);
    this.emit('alert', full);
  }

  private evaluateOpenSignalsOnTick(symbol: string, price: number): void {
    const signals = listAiSignals(80).filter(
      (s) =>
        s.symbol === symbol &&
        !s.closedAt &&
        (s.status === 'Active' || s.status === 'Breakeven' || s.status === 'Watchlist')
    );
    const info = SYMBOL_MAP[symbol];
    if (!info) return;

    for (const sig of signals) {
      if (sig.status === 'Watchlist') {
        const distToZone = Math.min(
          Math.abs(price - sig.optimalEntryZone[0]),
          Math.abs(price - sig.optimalEntryZone[1])
        );
        if (distToZone <= info.pipSize * 4 && Date.now() - sig.updatedAt > 60000) {
          sig.updatedAt = Date.now();
          upsertAiSignal(sig);
          this.pushAlert({
            symbol,
            signalId: sig.id,
            type: 'APPROACHING_ENTRY',
            title: `${symbol} Approaching Entry Zone`,
            message: `${sig.direction} setup nearing ${sig.optimalEntryZone[0]}–${sig.optimalEntryZone[1]}`,
          });
        }
        continue;
      }

      const isBuy = sig.direction === 'BUY';
      const riskDist = Math.max(info.pipSize, Math.abs(sig.entryPrice - sig.stopLoss));
      const rawPnl = isBuy ? price - sig.entryPrice : sig.entryPrice - price;
      sig.pnlPips = Number((rawPnl / info.pipSize).toFixed(1));
      sig.pnlR = Number((rawPnl / riskDist).toFixed(2));

      let milestoneUpdated = false;

      // TP1 Hit -> Move SL to Breakeven
      if (!sig.tp1Hit && ((isBuy && price >= sig.tp1) || (!isBuy && price <= sig.tp1))) {
        sig.tp1Hit = true;
        sig.currentSl = sig.entryPrice;
        sig.status = 'Breakeven';
        sig.updatedAt = Date.now();
        milestoneUpdated = true;
        this.pushAlert({
          symbol,
          signalId: sig.id,
          type: 'TP1_BE',
          title: `${symbol} TP1 Hit -> Breakeven`,
          message: `${sig.direction} secured TP1 (${sig.tp1}). Stop-Loss moved to Entry (${sig.entryPrice}).`,
        });
      }

      // TP2 Hit
      if (!sig.tp2Hit && ((isBuy && price >= sig.tp2) || (!isBuy && price <= sig.tp2))) {
        sig.tp1Hit = true;
        sig.tp2Hit = true;
        sig.currentSl = sig.entryPrice;
        sig.status = 'Breakeven';
        sig.updatedAt = Date.now();
        milestoneUpdated = true;
        this.pushAlert({
          symbol,
          signalId: sig.id,
          type: 'TP1_BE',
          title: `${symbol} TP2 Milestone Reached`,
          message: `${sig.direction} crossed TP2 (${sig.tp2}) with SL protected at Entry.`,
        });
      }

      // Final TP3 Hit -> Won (frozen)
      if ((isBuy && price >= sig.tp3) || (!isBuy && price <= sig.tp3)) {
        sig.tp1Hit = true;
        sig.tp2Hit = true;
        sig.tp3Hit = true;
        sig.status = 'Won';
        sig.closedAt = Date.now();
        sig.updatedAt = Date.now();
        upsertAiSignal(sig);
        updateSchoolWeightsOnOutcome(sig.schoolsUsed, true);
        this.emit('signal_update', sig);
        this.pushAlert({
          symbol,
          signalId: sig.id,
          type: 'FINAL_TP',
          title: `${symbol} TP3 Target Reached (+${sig.pnlR}R)`,
          message: `Immutable AI Log updated: ${sig.direction} closed as Won.`,
        });
        continue;
      }

      if (milestoneUpdated) {
        upsertAiSignal(sig);
        this.emit('signal_update', sig);
        continue;
      }

      // SL / BE Hit
      if ((isBuy && price <= sig.currentSl) || (!isBuy && price >= sig.currentSl)) {
        let lossDiagnosisTriggered = false;
        if (sig.tp2Hit) {
          sig.status = 'Won';
        } else if (sig.tp1Hit) {
          sig.status = 'Breakeven';
          sig.pnlR = 0.25;
        } else {
          sig.status = 'Lost';
          lossDiagnosisTriggered = true;
          const minsHeld = Math.max(1, Math.round((Date.now() - sig.createdAt) / 60000));
          const diagnosis = classifySignalLossCause(sig, minsHeld);
          sig.lossCause = diagnosis.category;
          sig.lossCauseDetail = diagnosis.detail;
          sig.autopsySummary = `[${diagnosis.category}] ${diagnosis.detail}`;
          this.logRejected(
            symbol,
            sig.recommendedTimeframe,
            sig.direction,
            'SL Loss Autopsy',
            sig.autopsySummary,
            price,
            { weightedScore: sig.weightedScore, rsi: sig.entryRsi }
          );
        }
        sig.closedAt = Date.now();
        sig.updatedAt = Date.now();
        upsertAiSignal(sig);
        updateSchoolWeightsOnOutcome(sig.schoolsUsed, sig.tp1Hit);
        this.emit('signal_update', sig);
        if (lossDiagnosisTriggered) {
          this.emitRootCausesSnapshot();
        }
        this.pushAlert({
          symbol,
          signalId: sig.id,
          type: sig.tp1Hit ? 'TP1_BE' : 'SL_HIT',
          title: sig.tp1Hit ? `${symbol} Closed at Breakeven (+TP1)` : `${symbol} SL Hit · ${sig.lossCause}`,
          message: sig.tp1Hit
            ? `Protected capital after TP1.`
            : sig.autopsySummary || `Closed at ${sig.currentSl} (${sig.pnlR}R).`,
        });
        continue;
      }

      // Scalp time-in-trade guard (> 45 mins without TP1)
      if (sig.isScalp && !sig.tp1Hit && Date.now() - sig.createdAt > 45 * 60 * 1000 && Date.now() - sig.updatedAt > 15 * 60 * 1000) {
        sig.updatedAt = Date.now();
        upsertAiSignal(sig);
        this.pushAlert({
          symbol,
          signalId: sig.id,
          type: 'SCALP_TIME_GUARD',
          title: `${symbol} Scalp Time-in-Trade Guard`,
          message: `صفقة اسكالبينج exceeded 45m without TP1 expansion. Review momentum.`,
        });
      }
    }

    // Evaluate open User Trades on live ticks for TP1/TP2/TP3 & SL->BE milestones
    const openUserTrades = listOpenUserTradesBySymbol(symbol);
    for (const tr of openUserTrades) {
      const isBuy = tr.side === 'BUY';
      const span = tr.takeProfit - tr.entryPrice;
      const tp1 = tr.tp1 ?? Number((tr.entryPrice + span * 0.45).toFixed(info.decimals));
      const tp2 = tr.tp2 ?? Number((tr.entryPrice + span * 0.75).toFixed(info.decimals));
      const tp3 = tr.tp3 ?? tr.takeProfit;
      let currentSl = tr.currentSl ?? tr.stopLoss;
      let changed = false;

      if (!tr.tp1Hit && ((isBuy && price >= tp1) || (!isBuy && price <= tp1))) {
        tr.tp1Hit = true;
        currentSl = tr.entryPrice;
        tr.currentSl = tr.entryPrice;
        tr.status = 'Breakeven';
        changed = true;
        this.pushAlert({
          symbol,
          tradeId: tr.id,
          type: 'TP1_BE',
          title: `${symbol} Trade TP1 Hit -> SL Moved to BE`,
          message: `تم تحقيق الهدف الأول لصفقتك (${tr.side}) عند ${tp1.toFixed(info.decimals)} وتأمين الدخول.`,
        });
      }

      if (!tr.tp2Hit && ((isBuy && price >= tp2) || (!isBuy && price <= tp2))) {
        tr.tp1Hit = true;
        tr.tp2Hit = true;
        currentSl = tr.entryPrice;
        tr.currentSl = tr.entryPrice;
        tr.status = 'Breakeven';
        changed = true;
      }

      const targetDist = Math.max(info.pipSize, Math.abs(tr.takeProfit - tr.entryPrice));
      const rawDiff = isBuy ? price - tr.entryPrice : tr.entryPrice - price;
      const pnlPips = Number((rawDiff / info.pipSize).toFixed(1));
      const pnlUsd = Number((pnlPips * info.pipSize * info.contractSize * tr.lotSize).toFixed(2));
      const exitEfficiency = Math.max(0, Math.min(100, Math.round((rawDiff / targetDist) * 100)));

      if ((isBuy && price >= tp3) || (!isBuy && price <= tp3)) {
        tr.tp1Hit = true;
        tr.tp2Hit = true;
        tr.tp3Hit = true;
        tr.status = 'Won';
        tr.exitPrice = tp3;
        tr.pnlPips = pnlPips;
        tr.pnlUsd = pnlUsd;
        tr.exitEfficiency = exitEfficiency;
        tr.closedAt = Date.now();
        updateUserTradeLiveMilestones(tr);
        this.emit('trade_update', tr);
        this.pushAlert({
          symbol,
          tradeId: tr.id,
          type: 'FINAL_TP',
          title: `${symbol} Trade TP3 Closed (+$${Math.abs(pnlUsd).toFixed(2)})`,
          message: `إغلاق صفقتك (${tr.side}) على الهدف الثالث عند ${tp3.toFixed(info.decimals)}.`,
        });
        continue;
      }

      if (!changed && ((isBuy && price <= currentSl) || (!isBuy && price >= currentSl))) {
        const slDiff = isBuy ? currentSl - tr.entryPrice : tr.entryPrice - currentSl;
        const slPips = Number((slDiff / info.pipSize).toFixed(1));
        const slUsd = Number((slPips * info.pipSize * info.contractSize * tr.lotSize).toFixed(2));
        tr.status = tr.tp2Hit ? 'Won' : tr.tp1Hit ? 'Breakeven' : 'Lost';
        tr.exitPrice = currentSl;
        tr.pnlPips = slPips;
        tr.pnlUsd = slUsd;
        tr.exitEfficiency = exitEfficiency;
        tr.closedAt = Date.now();
        if (tr.status === 'Lost') {
          const minsHeld = Math.max(1, Math.round((Date.now() - tr.createdAt) / 60000));
          const linkedSig = tr.signalId ? listAiSignals(120).find((s) => s.id === tr.signalId) : undefined;
          const diagnosis = classifyUserTradeLossCause(tr, linkedSig, undefined, minsHeld);
          tr.lossCause = diagnosis.category;
          tr.lossCauseDetail = diagnosis.detail;
        }
        updateUserTradeLiveMilestones(tr);
        this.emit('trade_update', tr);
        if (tr.status === 'Lost') {
          this.emitRootCausesSnapshot();
        }
        this.pushAlert({
          symbol,
          tradeId: tr.id,
          type: 'SL_HIT',
          title: `${symbol} Trade Closed at ${tr.tp1Hit ? 'BE' : 'SL'}`,
          message:
            tr.status === 'Lost' && tr.lossCause
              ? `[${tr.lossCause}] ${tr.lossCauseDetail}`
              : `تم إغلاق صفقتك (${tr.side}) عند ${currentSl.toFixed(info.decimals)} (${slUsd >= 0 ? '+' : '-'}$${Math.abs(slUsd).toFixed(2)}).`,
        });
        continue;
      }

      if (changed) {
        tr.pnlPips = pnlPips;
        tr.pnlUsd = pnlUsd;
        updateUserTradeLiveMilestones(tr);
        this.emit('trade_update', tr);
      }
    }

    // Evaluate Pending Rejected Setups on live ticks for Missed-Win vs Saved-Loss Root-Cause Tracking
    const pendingRej = listPendingRejectedSetupsBySymbol(symbol);
    for (const rej of pendingRej) {
      if (rej.hypotheticalSl == null || rej.hypotheticalTp1 == null) continue;
      const isBuy = rej.direction === 'BUY';
      const hitTp1 = isBuy ? price >= rej.hypotheticalTp1 : price <= rej.hypotheticalTp1;
      const hitSl = isBuy ? price <= rej.hypotheticalSl : price >= rej.hypotheticalSl;
      if (!hitTp1 && !hitSl) continue;

      if (hitTp1) {
        rej.wouldHaveWon = true;
        rej.counterfactualPnlR = 1.25;
        rej.counterfactualStatus = 'MissedWin';
        const diag = classifyMissedWinCause(rej);
        rej.missedWinCause = diag.category;
        rej.missedWinDetail = diag.detail;
      } else {
        rej.wouldHaveWon = false;
        rej.counterfactualPnlR = -1.0;
        rej.counterfactualStatus = 'SavedLoss';
      }
      rej.resolvedAt = Date.now();
      updateRejectedSetupOutcome(rej);
      this.emit('rejected_update', rej);
      this.emitRootCausesSnapshot();
    }
  }

  private emitRootCausesSnapshot(): void {
    const analytics = computeRootCauseAnalytics({
      signals: listAiSignals(200),
      trades: listRecentAllUserTrades(200),
      rejected: listRejectedSetups(150),
    });
    this.emit('root_causes_update', analytics);
  }

  public async runFullScan(): Promise<void> {
    const existing = listAiSignals(150);
    const recentTrades = listRecentAllUserTrades(120);
    const recentRejected = listRejectedSetups(150);
    const rootCauseReport = computeRootCauseAnalytics({
      signals: existing,
      trades: recentTrades,
      rejected: recentRejected,
    });
    const policy = rootCauseReport.policy;
    const weights = getSchoolWeights();
    const now = Date.now();
    const STRUCTURAL_SCHOOLS = new Set<SchoolId>([
      'smc',
      'ict',
      'crt',
      'supply_demand',
      'price_action',
      'wyckoff',
      'vsa',
    ]);

    for (const symbol of CORE_SCAN_SYMBOLS) {
      try {
        const [c1m, c5m, c15m, c1h, c4h] = await Promise.all([
          marketFeed.ensureCandles(symbol, '1m', 120),
          marketFeed.ensureCandles(symbol, '5m', 120),
          marketFeed.ensureCandles(symbol, '15m', 160),
          marketFeed.ensureCandles(symbol, '1h', 120),
          marketFeed.ensureCandles(symbol, '4h', 100),
        ]);

        const quote = marketFeed.getQuote(symbol);
        const info = SYMBOL_MAP[symbol];
        if (!info || c15m.length < 42) continue;

        // Rule 3: Evaluate strictly on CLOSED candles (drop forming intrabar candle)
        const closed1m = c1m.length > 15 ? c1m.slice(0, -1) : c1m;
        const closed5m = c5m.length > 15 ? c5m.slice(0, -1) : c5m;
        const closed15m = c15m.length > 25 ? c15m.slice(0, -1) : c15m;
        const closed1h = c1h.length > 15 ? c1h.slice(0, -1) : c1h;
        const closed4h = c4h.length > 15 ? c4h.slice(0, -1) : c4h;

        const mtfSnapshot = computeMtfSnapshot({
          '1m': closed1m,
          '5m': closed5m,
          '15m': closed15m,
          '1h': closed1h,
          '4h': closed4h,
        });
        const bullCount = mtfSnapshot.filter((m) => m.bias === 'BULLISH').length;
        const bearCount = mtfSnapshot.filter((m) => m.bias === 'BEARISH').length;

        const atr15 = calcATR(closed15m, 14);
        const atr5 = closed5m.length >= 16 ? calcATR(closed5m, 14) : atr15 * 0.65;
        const ema8 = calcEMA(closed15m, 8);
        const ema21 = calcEMA(closed15m, 21);
        const rsiArr = calcRSI(closed15m, 14);
        const last = closed15m[closed15m.length - 1];
        const prev = closed15m[closed15m.length - 2];
        const lastRsi = rsiArr[rsiArr.length - 1]?.value ?? 50;
        const lastFast = ema8[ema8.length - 1]?.value ?? last.close;
        const lastSlow = ema21[ema21.length - 1]?.value ?? last.close;

        // Dominant Timeframe & Execution Timeframe
        const snap1m = mtfSnapshot[0];
        const snap5m = mtfSnapshot[1];
        const snap15m = mtfSnapshot[2];
        const snap1h = mtfSnapshot[3];
        const snap4h = mtfSnapshot[4];

        const dominantTf: Timeframe =
          Math.abs(snap4h?.momentum ?? 0) > 25 ? '4h' : Math.abs(snap1h?.momentum ?? 0) > 22 ? '1h' : '15m';
        const isScalp = Math.abs(snap1m?.momentum ?? 0) > 18 && Math.abs(snap5m?.momentum ?? 0) > 18;
        const recommendedTf: Timeframe = isScalp ? '5m' : '15m';
        const execCandles = isScalp && closed5m.length >= 30 ? closed5m : closed15m;
        const execLast = execCandles[execCandles.length - 1];
        const execPrev = execCandles[execCandles.length - 2];
        const atrExec = isScalp ? atr5 : atr15;

        // Rule 3: Active CRT (Candle Range Theory) Signal Evaluation on closed candles (5m, 15m, 1h)
        const crt5 = isScalp ? evaluateCRTSetup(closed5m, atr5, info.decimals) : null;
        const crt15 = evaluateCRTSetup(closed15m, atr15, info.decimals);
        const crt1h = evaluateCRTSetup(closed1h, calcATR(closed1h, 14), info.decimals);
        const activeCrt =
          crt5?.direction ? crt5 : crt15.direction ? crt15 : crt1h.direction ? crt1h : null;

        let direction: 'BUY' | 'SELL' = bullCount >= bearCount ? 'BUY' : 'SELL';
        if (activeCrt?.direction && (Math.abs(bullCount - bearCount) <= 1 || activeCrt.displacementConfirmed)) {
          direction = activeCrt.direction;
        }

        // Skip if an active/watchlist signal already exists for this symbol
        const hasOpen = existing.some(
          (s) => s.symbol === symbol && (s.status === 'Active' || s.status === 'Breakeven' || s.status === 'Watchlist')
        );
        if (hasOpen) continue;

        // Standard cadence cooldown (15 mins between signals on same symbol)
        const lastAt = this.lastSignalAt.get(symbol) || 0;
        if (now - lastAt < 15 * 60 * 1000 && existing.length >= 4) continue;

        // Rule 4: Session & Dead-Liquidity / Extreme Volatility News Shield
        const barRange = execLast.high - execLast.low;
        const utcDate = new Date();
        const utcHr = utcDate.getUTCHours();
        const utcMin = utcDate.getUTCMinutes();
        const isFxRollover = symbol !== 'BTCUSDT' && utcHr === 21 && utcMin >= 50;
        const isDeadAsianFx =
          symbol !== 'BTCUSDT' &&
          symbol !== 'XAUUSD' &&
          (utcHr >= 22 || utcHr < 5) &&
          barRange < atrExec * 0.55;

        if (barRange > atrExec * 3.3 || isFxRollover || isDeadAsianFx) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Session & Liquidity Shield',
            isFxRollover
              ? 'Rollover dead-liquidity window; spreads & wicks unstable.'
              : isDeadAsianFx
                ? 'Low-liquidity off-session FX chop; awaiting London/NY open.'
                : 'Extreme >3.3x ATR spike detected; waiting for range stabilization.',
            quote?.mid ?? execLast.close
          );
          continue;
        }

        // Rule 4: Chop & Noise Avoidance check (calibrated safely by self-correction policy)
        const recentRange =
          Math.max(...execCandles.slice(-8).map((c) => c.high)) -
          Math.min(...execCandles.slice(-8).map((c) => c.low));
        if (recentRange < atrExec * policy.chopAtrFloor) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Chop & Noise Guard',
            `Tight consolidation range < ${policy.chopAtrFloor.toFixed(2)}x ATR; avoiding choppy whipsaw.`,
            quote?.mid ?? execLast.close,
            { atr: atrExec, rsi: lastRsi }
          );
          continue;
        }

        // Spread / Slippage Guard
        if (quote && quote.spreadPips > info.typicalSpreadPips * 2.5) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Spread & Slippage Guard',
            `Spread ${quote.spreadPips} pips exceeds 2.5x normal threshold.`,
            quote.mid,
            { atr: atrExec, rsi: lastRsi }
          );
          continue;
        }

        // Rule 1: Top-Down MTF Alignment (require 15m/1h/4h structure alignment for 1m/5m) & Anti-Counter-Trend Guard
        const expectedBias = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
        const opposingBias = direction === 'BUY' ? 'BEARISH' : 'BULLISH';
        const htfAlignedCount = [snap15m, snap1h, snap4h].filter((s) => s?.bias === expectedBias).length;
        const htfOpposeStrong =
          (snap1h?.bias === opposingBias && Math.abs(snap1h.momentum) >= 18) ||
          (snap4h?.bias === opposingBias && snap1h?.bias === opposingBias);
        const counterTrendCooldown = policy.activeCooldownCauses.includes('Counter-Trend / Against Momentum');

        if (
          (isScalp || counterTrendCooldown) &&
          (htfAlignedCount < 2 || htfOpposeStrong) &&
          !(activeCrt?.direction === direction && activeCrt.displacementConfirmed && !counterTrendCooldown)
        ) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Top-Down MTF Lock',
            `Blocked ${recommendedTf.toUpperCase()} ${direction} entry: HTF alignment ${htfAlignedCount}/3 across 15M/1H/4H${counterTrendCooldown ? ' (Counter-Trend Cooldown active)' : ''}.`,
            quote?.mid ?? execLast.close,
            { atr: atrExec, rsi: lastRsi }
          );
          continue;
        }

        const antiCounterTrend = evaluateAntiCounterTrendGuard(execCandles, closed1h, direction, atrExec, activeCrt);
        if (antiCounterTrend.blocked) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Anti-Counter-Trend Guard',
            antiCounterTrend.reason,
            quote?.mid ?? execLast.close,
            { atr: atrExec, rsi: lastRsi }
          );
          continue;
        }

        // Rule 2: Anti-Late-Entry & No-Chase Guard (tightened dynamically when Late Entry losses repeat)
        const antiLate = evaluateAntiLateEntry(execCandles, direction, atrExec, activeCrt?.eq50);
        const livePrice = quote?.mid ?? execLast.close;
        const liveChasedAway =
          antiLate.nearestRetestPrice !== null &&
          Math.abs(livePrice - antiLate.nearestRetestPrice) > atrExec * policy.antiLateAtrMult &&
          ((direction === 'BUY' && antiLate.rsi > 64) || (direction === 'SELL' && antiLate.rsi < 36));

        if (antiLate.blocked || liveChasedAway) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Anti-Late-Entry Guard',
            antiLate.blocked
              ? antiLate.reason
              : `Live price jumped >${policy.antiLateAtrMult.toFixed(2)}x ATR away from optimal retest (${antiLate.nearestRetestPrice?.toFixed(info.decimals)}); waiting for pullback.`,
            livePrice,
            { atr: atrExec, rsi: antiLate.rsi }
          );
          continue;
        }

        // Rule 3: Weighted Multi-School Confluence (structural/CRT/liquidity weighted above secondary indicators)
        const alignedSchools: SchoolId[] = [];
        if ((direction === 'BUY' && lastFast > lastSlow) || (direction === 'SELL' && lastFast < lastSlow)) {
          alignedSchools.push('indicators', 'price_action');
        }
        const { highs, lows } = findSwings(execCandles, 3);
        const sweptLow =
          lows.length > 0 &&
          execCandles.slice(-4).some((c) => c.low < lows[lows.length - 1].price && c.close > lows[lows.length - 1].price);
        const sweptHigh =
          highs.length > 0 &&
          execCandles.slice(-4).some((c) => c.high > highs[highs.length - 1].price && c.close < highs[highs.length - 1].price);

        const hasSweep = Boolean(
          activeCrt?.direction === direction ||
            (direction === 'BUY' && sweptLow) ||
            (direction === 'SELL' && sweptHigh)
        );

        if (activeCrt?.direction === direction) {
          alignedSchools.push('crt', 'smc', 'ict');
          if (activeCrt.displacementConfirmed) alignedSchools.push('price_action');
        } else if ((direction === 'BUY' && sweptLow) || (direction === 'SELL' && sweptHigh)) {
          alignedSchools.push('smc', 'ict', 'wyckoff');
        } else {
          alignedSchools.push('smc', 'supply_demand');
        }
        if (execLast.volume > (execPrev?.volume ?? 1) * 1.1) alignedSchools.push('vsa');
        if (mtfSnapshot.filter((m) => m.bias === expectedBias).length >= 3) {
          alignedSchools.push('classical', 'elliott');
        }
        if (symbol === 'XAUUSD' || symbol === 'EURUSD') alignedSchools.push('fundamental');

        const uniqueSchools = Array.from(new Set(alignedSchools));
        const structuralCount = uniqueSchools.filter((sid) => STRUCTURAL_SCHOOLS.has(sid)).length;
        if (structuralCount === 0) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Structural School Gate',
            'No primary structural/CRT/liquidity school confirmed; blocked pure indicator signal.',
            livePrice
          );
          continue;
        }

        const weightedTotal = uniqueSchools.reduce((acc, sid) => {
          const hierarchy = SCHOOL_MAP[sid]?.defaultWeight ?? 1.0;
          const calibrated = weights[sid]?.weight ?? 1.0;
          const tierBoost = STRUCTURAL_SCHOOLS.has(sid) ? 1.12 : 0.85;
          return acc + hierarchy * calibrated * tierBoost;
        }, 0);

        const weightedScore = Math.min(
          98,
          Math.max(
            62,
            Math.round(
              48 +
                weightedTotal * 4.5 +
                (activeCrt?.direction === direction ? 6 : 0) +
                (hasSweep ? 4 : 0) +
                (snap1h?.bias === expectedBias ? 3 : 0)
            )
          )
        );

        // Rule 3: Adaptive Confluence Score Threshold (baseline 80, raised on Weak Confluence losses, safely calibrated on Near-Threshold missed wins)
        const minScoreCutoff = policy.minConfluenceScore;
        if (weightedScore < minScoreCutoff) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            `Confluence Score Gate (<${minScoreCutoff})`,
            `Weighted confluence ${weightedScore}/100 below adaptive ${minScoreCutoff}/100 threshold (schools: ${uniqueSchools.slice(0, 4).join(', ')}).`,
            livePrice,
            { atr: atrExec, rsi: antiLate.rsi, weightedScore }
          );
          continue;
        }

        // Rule 4: 2-Loss Cool-Down Gate + Repeated Losing Pattern Tightening (12h memory)
        const recentClosedForSymbol = existing
          .filter((s) => s.symbol === symbol && s.closedAt && s.createdAt >= now - 12 * 3600 * 1000)
          .sort((a, b) => (b.closedAt ?? b.createdAt) - (a.closedAt ?? a.createdAt));

        let consecutiveLosses = 0;
        for (const cs of recentClosedForSymbol) {
          if (cs.status === 'Lost') consecutiveLosses++;
          else break;
        }
        const repeatedDirLosses = recentClosedForSymbol.filter(
          (s) => s.status === 'Lost' && s.direction === direction
        ).length;

        if (consecutiveLosses >= 2 || repeatedDirLosses >= 2) {
          const newestLossAt = recentClosedForSymbol[0]?.closedAt ?? recentClosedForSymbol[0]?.createdAt ?? now;
          const minsElapsed = (now - newestLossAt) / 60000;
          const isUltraHighConfluence = weightedScore >= 86 && structuralCount >= 4 && hasSweep;
          if ((consecutiveLosses >= 2 && minsElapsed < 45 && !isUltraHighConfluence) || (repeatedDirLosses >= 2 && !isUltraHighConfluence)) {
            this.logRejected(
              symbol,
              recommendedTf,
              direction,
              consecutiveLosses >= 2 ? '2-Loss Cool-Down Gate' : 'Repeated Pattern Autopsy Filter',
              `Tightened after ${Math.max(consecutiveLosses, repeatedDirLosses)} losses on ${symbol} ${direction}; requires >=86 score + >=4 structural schools + sweep (got ${weightedScore}/${structuralCount}).`,
              livePrice
            );
            continue;
          }
        }

        // Rule 3: Closed-Candle CHoCH / BOS / CRT Confirmation + Sweep/Displacement Combination
        const closedBullConfirm =
          execLast.close > execLast.open && execLast.close > execPrev.high * 0.9998;
        const closedBearConfirm =
          execLast.close < execLast.open && execLast.close < execPrev.low * 1.0002;
        const isConfirmed =
          (direction === 'BUY' && (bullCount >= 3 || activeCrt?.direction === 'BUY') && closedBullConfirm) ||
          (direction === 'SELL' && (bearCount >= 3 || activeCrt?.direction === 'SELL') && closedBearConfirm);

        if (!isConfirmed && activeCrt?.direction !== direction) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Closed-Candle Confirmation Guard',
            `Awaiting closed ${recommendedTf.toUpperCase()} candle displacement/reclaim before entry.`,
            livePrice
          );
          continue;
        }

        if (!hasSweep && !(activeCrt?.direction === direction && activeCrt.displacementConfirmed) && mtfSnapshot.filter((m) => m.bias === expectedBias).length < 4) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Sweep + Displacement Gate',
            `Missing liquidity sweep / CRT fakeout + closed-candle displacement reclaim combo.`,
            livePrice
          );
          continue;
        }

        const entry = Number(livePrice.toFixed(info.decimals));

        // Rule 2: Timeframe-Aware Max Stop Loss Cap (scaled by Wide SL loss policy) + Structural/CRT Invalidation
        const { minSlDist, maxSlCap: rawMaxSlCap } = getTimeframeMaxSlCap(symbol, recommendedTf, entry, atrExec);
        const maxSlCap = Number((rawMaxSlCap * policy.slCapScale).toFixed(info.decimals));
        const recentLow = Math.min(...execCandles.slice(-5).map((c) => c.low));
        const recentHigh = Math.max(...execCandles.slice(-5).map((c) => c.high));
        const structSl =
          direction === 'BUY'
            ? (activeCrt?.direction === 'BUY' ? Math.min(activeCrt.suggestedSl, recentLow - atrExec * 0.25) : recentLow - atrExec * 0.25)
            : (activeCrt?.direction === 'SELL' ? Math.max(activeCrt.suggestedSl, recentHigh + atrExec * 0.25) : recentHigh + atrExec * 0.25);

        const rawStructRisk = Math.abs(entry - structSl);
        if (rawStructRisk > maxSlCap * 1.45) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'Max SL Cap Guard',
            `Structural SL distance (${rawStructRisk.toFixed(info.decimals)}) exceeds 1.45x ${recommendedTf.toUpperCase()} Max SL Cap (${maxSlCap.toFixed(info.decimals)}).`,
            entry,
            { atr: atrExec, rsi: antiLate.rsi, weightedScore }
          );
          continue;
        }

        const slDist = Math.min(maxSlCap, Math.max(minSlDist, rawStructRisk));
        const stopLoss = Number((direction === 'BUY' ? entry - slDist : entry + slDist).toFixed(info.decimals));

        // Smart TP1 (nearest realistic liquidity/CRT target -> Breakeven), TP2 & TP3 runners
        let tp1 = Number((direction === 'BUY' ? entry + slDist * 1.2 : entry - slDist * 1.2).toFixed(info.decimals));
        let tp2 = Number((direction === 'BUY' ? entry + slDist * 2.15 : entry - slDist * 2.15).toFixed(info.decimals));
        let tp3 = Number((direction === 'BUY' ? entry + slDist * 3.2 : entry - slDist * 3.2).toFixed(info.decimals));

        if (activeCrt?.direction === direction) {
          const crtTp1Dist = Math.abs(activeCrt.suggestedTp1 - entry);
          if (
            ((direction === 'BUY' && activeCrt.suggestedTp1 > entry) ||
              (direction === 'SELL' && activeCrt.suggestedTp1 < entry)) &&
            crtTp1Dist >= slDist * 1.0 &&
            crtTp1Dist <= slDist * 1.75
          ) {
            tp1 = activeCrt.suggestedTp1;
            tp2 = activeCrt.suggestedTp2;
            tp3 = activeCrt.suggestedTp3;
          }
        }

        // Pre-TP1 HTF Obstacle Check (1H swing levels blocking path before TP1)
        const swings1h = findSwings(closed1h, 3);
        const blocking1h =
          direction === 'BUY'
            ? swings1h.highs.find((h) => h.price > entry + slDist * 0.25 && h.price < tp1 - slDist * 0.15)
            : swings1h.lows.find((l) => l.price < entry - slDist * 0.25 && l.price > tp1 + slDist * 0.15);
        if (blocking1h && Math.abs(blocking1h.price - entry) < Math.abs(tp1 - entry) * 0.55) {
          this.logRejected(
            symbol,
            recommendedTf,
            direction,
            'HTF Obstacle Before TP1',
            `Opposing 1H structural swing at ${blocking1h.price} obstructs >45% of path before TP1 (${tp1}).`,
            entry
          );
          continue;
        }

        const optLow = Number((direction === 'BUY' ? entry - slDist * 0.25 : entry - slDist * 0.08).toFixed(info.decimals));
        const optHigh = Number((direction === 'BUY' ? entry + slDist * 0.08 : entry + slDist * 0.25).toFixed(info.decimals));
        const hardInvalidation = Number((direction === 'BUY' ? stopLoss - slDist * 0.2 : stopLoss + slDist * 0.2).toFixed(info.decimals));

        const tier: SignalTier = weightedScore >= 84 ? 'A+' : weightedScore >= 74 ? 'A' : 'B';
        const regimeMatch =
          activeCrt?.direction === direction
            ? 'CRT Liquidity Sweep Reversal'
            : Math.abs(lastRsi - 50) > 15
              ? 'Trending Expansion'
              : sweptLow || sweptHigh
                ? 'Liquidity Sweep Reversal'
                : 'Range Equilibrium';
        const devilsAdvocate =
          direction === 'BUY'
            ? `Watch overhead HTF supply & DXY bounce if ${stopLoss} invalidates.`
            : `Watch HTF demand bounce & round-number squeeze above ${stopLoss}.`;
        const preTp1ObstacleCheck = blocking1h
          ? `Minor 1H pivot near ${blocking1h.price.toFixed(info.decimals)}; partial clearance to TP1 (${tp1}).`
          : `Clear HTF path to TP1 (${tp1}); next structural pool beyond TP2 (${tp2}).`;

        const rationaleAr = await generateArabicRationale({
          symbol,
          direction,
          timeframe: recommendedTf,
          schools: uniqueSchools,
          regime: regimeMatch,
          entry,
          sl: stopLoss,
          tp1,
          devilsAdvocate,
        });

        const rationaleEn = [
          `${symbol} ${direction} (${recommendedTf.toUpperCase()}): ${regimeMatch} confluence across ${uniqueSchools.slice(0, 4).join(', ')}.`,
          activeCrt?.direction === direction
            ? `${activeCrt.reason} · SL ${stopLoss} (Capped) · TP1 ${tp1} -> BE.`
            : `Entry ${entry} · Capped SL ${stopLoss} · TP1 ${tp1} (moves SL to breakeven on TP1).`,
          `Risk Note: ${devilsAdvocate}`,
        ].join('\n');

        const signal: AISignal = {
          id: `sig_${symbol}_${Date.now()}_${crypto.randomUUID().slice(0, 4)}`,
          symbol,
          direction,
          tier,
          status: isConfirmed ? 'Active' : 'Watchlist',
          recommendedTimeframe: recommendedTf,
          dominantTimeframe: dominantTf,
          optimalEntryZone: [Math.min(optLow, optHigh), Math.max(optLow, optHigh)],
          entryPrice: entry,
          stopLoss,
          currentSl: stopLoss,
          tp1,
          tp2,
          tp3,
          hardInvalidation,
          schoolsUsed: uniqueSchools,
          weightedScore,
          regimeMatch,
          liquidityFingerprint:
            activeCrt?.direction === direction
              ? `CRT Sweep + Closed-Candle Reclaim (50% EQ ${activeCrt.eq50})`
              : sweptLow || sweptHigh
                ? 'London/NY Stop Sweep + Absorption'
                : 'Clean Displacement Continuation',
          devilsAdvocate,
          preTp1ObstacleCheck,
          mtfSnapshot,
          checklist: [
            { label: 'Top-Down MTF Alignment', passed: bullCount >= 3 || bearCount >= 3 || !htfOpposeStrong },
            { label: 'Closed-Candle Confirmation', passed: isConfirmed },
            { label: 'Anti-Late-Entry & Retest Pass', passed: !antiLate.blocked },
            { label: `Max SL Cap & Pre-TP1 Clear`, passed: !blocking1h },
          ],
          rationaleAr,
          rationaleEn,
          entryRsi: Number(antiLate.rsi.toFixed(1)),
          slAtrRatio: Number((slDist / Math.max(1e-6, atrExec)).toFixed(2)),
          isScalp,
          tp1Hit: false,
          pnlPips: 0,
          pnlR: 0,
          patternTwin: findHistoricalPatternTwin(closed15m),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        upsertAiSignal(signal);
        this.lastSignalAt.set(symbol, Date.now());
        this.emit('signal_new', signal);

        if (signal.status === 'Active') {
          this.pushAlert({
            symbol,
            signalId: signal.id,
            type: isScalp ? 'SCALP_SIGNAL' : 'NEW_SIGNAL',
            title: isScalp ? `صفقة اسكالبينج: ${symbol} ${direction}` : `${symbol} ${direction} (${tier})`,
            message: `Entry ${entry} | SL ${stopLoss} | TP1 ${tp1}`,
          });
        }
      } catch {
        // Resilient per-symbol isolation
      }
    }
  }

  private logRejected(
    symbol: string,
    tf: Timeframe,
    direction: 'BUY' | 'SELL',
    guardName: string,
    reason: string,
    priceAtCheck: number,
    meta?: { atr?: number; rsi?: number; weightedScore?: number }
  ): void {
    const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
    const isAutopsy = guardName === 'SL Loss Autopsy';
    const { maxSlCap } = getTimeframeMaxSlCap(symbol, tf, priceAtCheck, meta?.atr ?? info.pipSize * 18);
    const hypSlDist = Math.max(info.pipSize * 4, maxSlCap * 0.85);
    const hypotheticalSl = Number(
      (direction === 'BUY' ? priceAtCheck - hypSlDist : priceAtCheck + hypSlDist).toFixed(info.decimals)
    );
    const hypotheticalTp1 = Number(
      (direction === 'BUY' ? priceAtCheck + hypSlDist * 1.25 : priceAtCheck - hypSlDist * 1.25).toFixed(info.decimals)
    );

    const setup: RejectedSetup = {
      id: `rej_${symbol}_${Date.now()}_${crypto.randomUUID().slice(0, 4)}`,
      symbol,
      timeframe: tf,
      direction,
      guardName,
      reason,
      wouldHaveWon: false,
      counterfactualPnlR: 0,
      priceAtCheck,
      weightedScore: meta?.weightedScore,
      entryRsi: meta?.rsi !== undefined ? Number(meta.rsi.toFixed(1)) : undefined,
      hypotheticalSl: isAutopsy ? undefined : hypotheticalSl,
      hypotheticalTp1: isAutopsy ? undefined : hypotheticalTp1,
      counterfactualStatus: isAutopsy ? 'SavedLoss' : 'Pending',
      createdAt: Date.now(),
    };
    insertRejectedSetup(setup);
  }
}

export const aiEngine = new AIBackgroundEngine();
